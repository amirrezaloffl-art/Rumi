// IndexedDB wrapper + JSON import/export with schema versioning.
// Exposes window.DB.
//
// Sync-safe rules (v3):
//  - every record has a unique numeric `id` (time-based, so two devices never collide)
//    and an `updatedAt` stamp; the newest stamp wins when devices merge.
//  - hard deletes leave a tombstone so the delete reaches other devices.
//  - product stock is never stored: it is derived from stock moves (opening balance,
//    manual adjustments) minus the units in active orders. Two devices selling the
//    same product offline therefore always add up correctly.

(function () {
  'use strict';

  var DB_NAME = 'appavet';
  var DB_VERSION = 3;
  var SCHEMA_VERSION = 3; // bump when JSON shape changes; add a step in upgradeData()

  // Stores that hold user records (exported, synced, merged).
  var STORES = ['orders', 'customers', 'products', 'expenses', 'funding', 'stockMoves'];
  // Meta keys that travel with the data (others are per-device preferences).
  var SYNCED_META = ['settings'];

  var dbPromise = null;
  var writeSeq = 0;
  var listeners = [];
  var lastId = 0;

  function nowIso() { return new Date().toISOString(); }
  function isRecordStore(s) { return STORES.indexOf(s) !== -1; }

  // Unique, increasing, JSON-safe integer ids (µs-ish resolution + random tail).
  function newId() {
    var id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    if (id <= lastId) id = lastId + 1;
    lastId = id;
    return id;
  }

  function emitChange(store) {
    listeners.forEach(function (fn) { try { fn(store); } catch (e) { console.error(e); } });
  }
  function onChange(fn) { listeners.push(fn); }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('orders')) {
          var s = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
          s.createIndex('date', 'date', { unique: false });
          s.createIndex('customerId', 'customerId', { unique: false });
        }
        if (!db.objectStoreNames.contains('customers')) {
          var c = db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
          c.createIndex('nameLower', 'nameLower', { unique: false });
        }
        if (!db.objectStoreNames.contains('products')) {
          var p = db.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
          p.createIndex('nameLower', 'nameLower', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('funding')) db.createObjectStore('funding', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('stockMoves')) db.createObjectStore('stockMoves', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    }).then(function (db) {
      return migrateInPlace(db).then(function () { return db; });
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }
  function txDone(t) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error('Transaction aborted')); };
    });
  }
  function rawAll(db, store) { return reqToPromise(db.transaction([store]).objectStore(store).getAll()); }

  function all(store) { return open().then(function (db) { return rawAll(db, store); }); }
  function get(store, id) {
    return open().then(function (db) { return reqToPromise(db.transaction([store]).objectStore(store).get(id)); });
  }

  // Stamp a record before a local write.
  function stamp(store, value) {
    var t = nowIso();
    if (value.id == null) value.id = newId();
    if (!value.createdAt) value.createdAt = t;
    value.updatedAt = t;
    if (store === 'products') delete value.stock; // derived, never stored
    return value;
  }

  function put(store, value) {
    if (isRecordStore(store)) stamp(store, value);
    writeSeq++;
    return open().then(function (db) {
      var t = db.transaction([store], 'readwrite');
      t.objectStore(store).put(value);
      return txDone(t);
    }).then(function () {
      if (isRecordStore(store)) emitChange(store);
      return value.id;
    });
  }
  function add(store, value) {
    if (isRecordStore(store)) stamp(store, value);
    writeSeq++;
    return open().then(function (db) {
      var t = db.transaction([store], 'readwrite');
      t.objectStore(store).add(value);
      return txDone(t);
    }).then(function () {
      if (isRecordStore(store)) emitChange(store);
      return value.id;
    });
  }
  // Hard delete. Leaves a tombstone so other devices drop the record too.
  function del(store, id) {
    writeSeq++;
    return open().then(function (db) {
      var t = db.transaction([store, 'meta'], 'readwrite');
      t.objectStore(store).delete(id);
      if (isRecordStore(store)) {
        var ms = t.objectStore('meta');
        var r = ms.get('tombstones');
        r.onsuccess = function () {
          var tomb = (r.result && r.result.value) || {};
          (tomb[store] = tomb[store] || {})[id] = nowIso();
          ms.put({ key: 'tombstones', value: tomb });
        };
      }
      return txDone(t);
    }).then(function () { if (isRecordStore(store)) emitChange(store); });
  }

  // ==== Stock (derived) ====
  function stockLines(order) {
    return (Array.isArray(order.products) ? order.products : [])
      .concat(Array.isArray(order.gifts) ? order.gifts : []);
  }
  // Map productId -> on-hand units = Σ stock moves − Σ qty in active (non-archived) orders.
  function computeStock(orders, moves) {
    var s = {};
    (moves || []).forEach(function (m) {
      if (m.archived || m.productId == null) return;
      s[m.productId] = (s[m.productId] || 0) + (Number(m.delta) || 0);
    });
    (orders || []).forEach(function (o) {
      if (o.archived) return;
      stockLines(o).forEach(function (l) {
        if (l.productId == null) return;
        s[l.productId] = (s[l.productId] || 0) - (Number(l.qty) || 0);
      });
    });
    return s;
  }
  // Record a manual stock change (catalog edit) as a move, so concurrent edits add up.
  function adjustStock(productId, delta, note) {
    delta = Number(delta) || 0;
    if (!delta) return Promise.resolve();
    return add('stockMoves', { productId: productId, delta: delta, note: note || 'Manual adjustment' });
  }

  // ==== Orders ====
  function nameKey(s) { return String(s || '').trim().toLowerCase(); }

  // Product identity ignores how a name was typed: Persian/Arabic/Latin digits,
  // Arabic ي/ك vs Persian ی/ک, half-spaces (ZWNJ), spaces, diacritics and case.
  // «تشویقی ۱۰۰ گرمی» and «تشویقی 100 گرمی» are the same product.
  function productKey(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[\u064A\u0649]/g, '\u06CC')          // ي ى -> ی
      .replace(/\u0643/g, '\u06A9')                   // ك -> ک
      .replace(/\u0629/g, '\u0647')                   // ة -> ه
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')    // diacritics, hamza above (هٔ), tatweel
      .replace(/[\s\u200B-\u200F\u00A0\u2066-\u2069_\-]+/g, ''); // spaces, ZWNJ, direction marks
  }

  // One transaction: upsert customer + products, assign order number, compute profit, save.
  function saveOrder(order) {
    writeSeq++;
    var t0 = nowIso();
    return open().then(function (db) {
      var t = db.transaction(['orders', 'customers', 'products'], 'readwrite');
      var os = t.objectStore('orders'), cs = t.objectStore('customers'), ps = t.objectStore('products');
      var done = txDone(t);
      var custP = reqToPromise(cs.getAll()), prodP = reqToPromise(ps.getAll()), ordP = reqToPromise(os.getAll());
      return Promise.all([custP, prodP, ordP]).then(function (rs) {
        var customers = rs[0], products = rs[1], orders = rs[2];

        // 1) customer (match an active customer by name)
        var ck = nameKey(order.customerName);
        var cust = customers.filter(function (c) { return c.nameLower === ck && !c.archived; })[0];
        if (cust) {
          var changed = false;
          ['phone1', 'phone2', 'email', 'address', 'postalCode'].forEach(function (f) {
            if (order[f] && cust[f] !== order[f]) { cust[f] = order[f]; changed = true; }
          });
          if (changed) { cust.updatedAt = t0; cs.put(cust); }
        } else {
          cust = {
            id: newId(), name: String(order.customerName || '').trim(), nameLower: ck,
            phone1: order.phone1 || '', phone2: order.phone2 || '', email: order.email || '',
            address: order.address || '', postalCode: order.postalCode || '', createdAt: t0, updatedAt: t0
          };
          cs.put(cust);
          customers.push(cust);
        }
        order.customerId = cust.id;

        // 2) products. A line is the catalog product it was picked from (productId), or
        //    the product whose name matches once spelling differences are ignored.
        //    Only a genuinely new name adds a product to the catalog.
        //    A price you change on a line becomes the catalog price; saving an old order
        //    without touching its prices leaves today's catalog prices alone.
        //    Gift lines carry no sellPrice, so they never change a product's sell price.
        var prevOrder = order.id != null ? orders.filter(function (o) { return o.id === order.id; })[0] : null;
        var prevLines = {};
        if (prevOrder) {
          (prevOrder.products || []).forEach(function (l) { if (l.productId != null) prevLines['p' + l.productId] = l; });
          (prevOrder.gifts || []).forEach(function (l) { if (l.productId != null && !prevLines['g' + l.productId]) prevLines['g' + l.productId] = l; });
        }
        function findProduct(line) {
          var p = null;
          if (line.productId != null) p = products.filter(function (x) { return x.id === line.productId && !x.archived; })[0] || null;
          if (!p) {
            var key = productKey(line.name);
            if (key) p = products.filter(function (x) { return !x.archived && productKey(x.name) === key; })[0] || null;
          }
          return p;
        }
        function applyLine(line, isGift) {
          var p = findProduct(line);
          if (p) {
            var prev = prevLines[(isGift ? 'g' : 'p') + p.id];
            var ch = false;
            var costChanged = !prev || Number(prev.costPrice) !== Number(line.costPrice);
            var sellChanged = !isGift && (!prev || Number(prev.sellPrice) !== Number(line.sellPrice));
            if (costChanged && Number.isFinite(line.costPrice) && p.defaultCost !== line.costPrice) { p.defaultCost = line.costPrice; ch = true; }
            if (sellChanged && Number.isFinite(line.sellPrice) && p.defaultSell !== line.sellPrice) { p.defaultSell = line.sellPrice; ch = true; }
            if (ch) { p.updatedAt = t0; delete p.stock; ps.put(p); }
            line.name = p.name; // one spelling everywhere (invoice, reports)
          } else {
            p = {
              id: newId(), name: String(line.name || '').trim(), nameLower: nameKey(line.name),
              defaultCost: Number.isFinite(line.costPrice) ? line.costPrice : 0,
              defaultSell: Number.isFinite(line.sellPrice) ? line.sellPrice : 0,
              createdAt: t0, updatedAt: t0
            };
            ps.put(p);
            products.push(p);
          }
          line.productId = p.id;
        }
        (order.products || []).forEach(function (l) { applyLine(l, false); });
        (order.gifts || []).forEach(function (l) { applyLine(l, true); });

        // 3) profit (shipping excluded), order number, stamps
        order.profit = orderProfitOf(order);
        if (order.id == null) {
          order.id = newId();
          order.no = orders.reduce(function (m, o) { return Math.max(m, Number(o.no) || 0); }, 0) + 1;
          order.createdAt = t0;
        } else {
          var prev = orders.filter(function (o) { return o.id === order.id; })[0];
          if (prev) {
            order.no = prev.no;
            order.createdAt = prev.createdAt || t0;
            if (prev.archived) { order.archived = prev.archived; order.archivedAt = prev.archivedAt; }
          }
          if (!order.createdAt) order.createdAt = t0;
        }
        order.updatedAt = t0;
        os.put(order);
        return done;
      });
    }).then(function () {
      emitChange('orders');
      return order.id;
    });
  }

  function orderProfitOf(o) {
    var profit = 0;
    (o.products || []).forEach(function (l) { profit += (Number(l.sellPrice) - Number(l.costPrice)) * Number(l.qty); });
    // Gifts are given away free, so their cost comes straight out of profit.
    (o.gifts || []).forEach(function (g) { profit -= Number(g.costPrice) * Number(g.qty); });
    return profit - (Number(o.discount) || 0) - (Number(o.loss) || 0);
  }

  // Archive = soft delete. Stock comes back automatically because archived orders
  // are excluded from the stock calculation.
  function archiveOrder(id) {
    return get('orders', id).then(function (o) {
      if (!o) return;
      o.archived = true; o.archivedAt = nowIso();
      return put('orders', o);
    });
  }
  function restoreOrder(id) {
    return get('orders', id).then(function (o) {
      if (!o) return;
      o.archived = false; delete o.archivedAt;
      return put('orders', o);
    });
  }
  function deleteOrder(id) { return del('orders', id); }

  // ==== Duplicate products ====
  // Groups of active products whose names are the same once spelling is ignored.
  function findDuplicateProducts(products) {
    var groups = {};
    (products || []).forEach(function (p) {
      if (p.archived) return;
      var k = productKey(p.name);
      if (k) (groups[k] = groups[k] || []).push(p);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; }).filter(function (g) { return g.length > 1; });
  }
  // Merge each group into its oldest product: orders and stock moves are pointed at it
  // (so sales history and stock add up), it takes the most recently used prices, and the
  // extra entries are removed (with tombstones, so synced devices drop them too).
  function mergeDuplicateProducts() {
    writeSeq++;
    var t0 = nowIso(), merged = 0;
    return open().then(function (db) {
      var t = db.transaction(['products', 'orders', 'stockMoves', 'meta'], 'readwrite');
      var done = txDone(t);
      var ps = t.objectStore('products'), os = t.objectStore('orders'), ms = t.objectStore('stockMoves'), meta = t.objectStore('meta');
      return Promise.all([reqToPromise(ps.getAll()), reqToPromise(os.getAll()), reqToPromise(ms.getAll()), reqToPromise(meta.get('tombstones'))]).then(function (rs) {
        var groups = findDuplicateProducts(rs[0]);
        var tomb = (rs[3] && rs[3].value) || {};
        var to = {}; // duplicate id -> kept product
        groups.forEach(function (g) {
          g.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id - b.id; });
          var keep = g[0];
          var latest = g.slice().sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); })[0];
          keep.defaultCost = latest.defaultCost; keep.defaultSell = latest.defaultSell;
          g.slice(1).forEach(function (d) {
            if (!keep.expireDate && d.expireDate) keep.expireDate = d.expireDate;
            to[d.id] = keep;
            ps.delete(d.id);
            (tomb.products = tomb.products || {})[d.id] = t0;
            merged++;
          });
          keep.updatedAt = t0; delete keep.stock;
          ps.put(keep);
        });
        rs[1].forEach(function (o) {
          var ch = false;
          stockLines(o).forEach(function (l) {
            var k = l.productId != null && to[l.productId];
            if (k) { l.productId = k.id; l.name = k.name; ch = true; }
          });
          if (ch) { o.updatedAt = t0; os.put(o); }
        });
        rs[2].forEach(function (m) {
          var k = to[m.productId];
          if (k) { m.productId = k.id; m.updatedAt = t0; ms.put(m); }
        });
        meta.put({ key: 'tombstones', value: tomb });
        return done;
      });
    }).then(function () { if (merged) emitChange('products'); return merged; });
  }

  // ==== Meta ====
  function getMetaRec(key) { return get('meta', key); }
  function getMeta(key) { return getMetaRec(key).then(function (r) { return r ? r.value : null; }); }
  function setMeta(key, value) {
    var synced = SYNCED_META.indexOf(key) !== -1;
    var rec = { key: key, value: value };
    if (synced) { rec.updatedAt = nowIso(); writeSeq++; }
    return open().then(function (db) {
      var t = db.transaction(['meta'], 'readwrite');
      t.objectStore('meta').put(rec);
      return txDone(t);
    }).then(function () { if (synced) emitChange('meta'); });
  }

  // ==== Schema upgrades (pure: work on a plain export object) ====
  function upgradeData(data) {
    var v = Number(data.schemaVersion || 0);
    STORES.forEach(function (s) { if (!Array.isArray(data[s])) data[s] = []; });
    if (v < 3) {
      var t = nowIso();
      STORES.forEach(function (s) {
        data[s].forEach(function (r) { if (!r.updatedAt) r.updatedAt = r.createdAt || t; });
      });
      data.orders.forEach(function (o) { if (o.no == null) o.no = o.id; });
      // Turn stored stock into an opening-balance move: opening = stored + units already
      // taken by active orders, so the derived figure equals what the catalog showed.
      var used = computeStock(data.orders, []);
      data.products.forEach(function (p) {
        // Products from before stock tracking have no value; the old app showed them as 0.
        var opening = (Number(p.stock) || 0) - (used[p.id] || 0);
        if (opening) data.stockMoves.push({ id: newId(), productId: p.id, delta: opening, note: 'Opening balance', createdAt: t, updatedAt: t });
        delete p.stock;
      });
      data.schemaVersion = 3;
    }
    if (!data.tombstones || typeof data.tombstones !== 'object') data.tombstones = {};
    return data;
  }

  function migrateInPlace(db) {
    return reqToPromise(db.transaction(['meta']).objectStore('meta').get('schema')).then(function (r) {
      if (r && r.value >= SCHEMA_VERSION) return;
      return Promise.all(STORES.map(function (s) { return rawAll(db, s); })).then(function (rs) {
        var data = { schemaVersion: 2 };
        STORES.forEach(function (s, i) { data[s] = rs[i]; });
        var hasAny = STORES.some(function (s) { return data[s].length; });
        if (hasAny) upgradeData(data);
        var t = db.transaction(STORES.concat(['meta']), 'readwrite');
        if (hasAny) STORES.forEach(function (s) { data[s].forEach(function (rec) { t.objectStore(s).put(rec); }); });
        t.objectStore('meta').put({ key: 'schema', value: SCHEMA_VERSION });
        return txDone(t);
      });
    });
  }

  // ==== Export / Import ====
  function sortById(a, b) { return (a.id || 0) - (b.id || 0); }
  function exportAll() {
    return open().then(function (db) {
      return Promise.all(STORES.map(function (s) { return rawAll(db, s); }).concat([
        reqToPromise(db.transaction(['meta']).objectStore('meta').get('settings')),
        reqToPromise(db.transaction(['meta']).objectStore('meta').get('tombstones'))
      ]));
    }).then(function (rs) {
      var out = { appavet: true, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso() };
      STORES.forEach(function (s, i) { out[s] = rs[i].slice().sort(sortById); });
      var st = rs[STORES.length], tb = rs[STORES.length + 1];
      out.settings = st ? { value: st.value, updatedAt: st.updatedAt || '' } : null;
      out.tombstones = (tb && tb.value) || {};
      return out;
    });
  }

  function migrate(data) {
    if (!data || data.appavet !== true) throw new Error('Not a Rumi / Appavet backup file.');
    if (data.encrypted) throw new Error('This file is encrypted. Use Settings → Cloud sync to connect to it.');
    var v = Number(data.schemaVersion || 0);
    if (v > SCHEMA_VERSION) {
      throw new Error('Export was made by a newer version (' + v +
                      ') than this app supports (' + SCHEMA_VERSION + '). Please update the app first.');
    }
    return upgradeData(data);
  }

  // Write a full dataset in ONE transaction (used by sync and by import).
  // Not counted as a local edit, so it doesn't trigger another push by itself.
  function applyData(data) {
    return open().then(function (db) {
      var t = db.transaction(STORES.concat(['meta']), 'readwrite');
      STORES.forEach(function (s) {
        var os = t.objectStore(s);
        os.clear();
        (data[s] || []).forEach(function (r) { os.put(r); });
      });
      var ms = t.objectStore('meta');
      ms.put({ key: 'tombstones', value: data.tombstones || {} });
      if (data.settings && data.settings.value) ms.put({ key: 'settings', value: data.settings.value, updatedAt: data.settings.updatedAt || '' });
      return txDone(t);
    });
  }

  // mode: 'replace' (file becomes the truth, also on synced devices) or
  //       'merge' (add the file's records alongside, with fresh ids and remapped links).
  function importAll(data, mode) {
    data = migrate(JSON.parse(JSON.stringify(data)));
    var t = nowIso();
    return exportAll().then(function (cur) {
      var next;
      if (mode === 'replace') {
        next = { tombstones: cur.tombstones || {} };
        STORES.forEach(function (s) {
          var keep = {};
          data[s].forEach(function (r) { r.updatedAt = t; keep[r.id] = true; });
          // Anything here that isn't in the file is deleted everywhere.
          cur[s].forEach(function (r) {
            if (!keep[r.id]) (next.tombstones[s] = next.tombstones[s] || {})[r.id] = t;
          });
          // Records in the file must not stay tombstoned.
          if (next.tombstones[s]) data[s].forEach(function (r) { delete next.tombstones[s][r.id]; });
          next[s] = data[s];
        });
        next.settings = data.settings && data.settings.value ? { value: data.settings.value, updatedAt: t } : cur.settings;
      } else {
        next = cur;
        var map = { customers: {}, products: {} };
        ['customers', 'products'].forEach(function (s) {
          data[s].forEach(function (r) {
            var nid = newId(); map[s][r.id] = nid;
            r.id = nid; r.updatedAt = t;
            next[s].push(r);
          });
        });
        var maxNo = cur.orders.reduce(function (m, o) { return Math.max(m, Number(o.no) || 0); }, 0);
        data.orders.slice().sort(function (a, b) { return (Number(a.no) || 0) - (Number(b.no) || 0); }).forEach(function (o) {
          o.id = newId(); o.no = ++maxNo; o.updatedAt = t;
          o.customerId = o.customerId != null ? map.customers[o.customerId] : undefined;
          if (o.customerId == null) delete o.customerId;
          stockLines(o).forEach(function (l) { l.productId = l.productId != null ? map.products[l.productId] : undefined; if (l.productId == null) delete l.productId; });
          next.orders.push(o);
        });
        data.stockMoves.forEach(function (m) {
          if (map.products[m.productId] == null) return;
          m.id = newId(); m.productId = map.products[m.productId]; m.updatedAt = t;
          next.stockMoves.push(m);
        });
        ['expenses', 'funding'].forEach(function (s) {
          data[s].forEach(function (r) { r.id = newId(); r.updatedAt = t; next[s].push(r); });
        });
      }
      writeSeq++;
      return applyData(next);
    }).then(function () {
      emitChange('import');
      return setMeta('lastBackup', nowIso());
    });
  }

  // Wipe = delete everything here AND on synced devices (tombstones).
  function wipeAll() {
    var t = nowIso();
    return exportAll().then(function (cur) {
      var next = { tombstones: cur.tombstones || {}, settings: null };
      STORES.forEach(function (s) {
        cur[s].forEach(function (r) { (next.tombstones[s] = next.tombstones[s] || {})[r.id] = t; });
        next[s] = [];
      });
      writeSeq++;
      return applyData(next);
    }).then(function () { emitChange('wipe'); });
  }

  window.DB = {
    STORES: STORES,
    open: open,
    all: all,
    get: get,
    put: put,
    add: add,
    del: del,
    newId: newId,
    saveOrder: saveOrder,
    deleteOrder: deleteOrder,
    archiveOrder: archiveOrder,
    restoreOrder: restoreOrder,
    computeStock: computeStock,
    productKey: productKey,
    findDuplicateProducts: findDuplicateProducts,
    mergeDuplicateProducts: mergeDuplicateProducts,
    adjustStock: adjustStock,
    getMeta: getMeta,
    getMetaRec: getMetaRec,
    setMeta: setMeta,
    exportAll: exportAll,
    importAll: importAll,
    applyData: applyData,
    upgradeData: upgradeData,
    wipeAll: wipeAll,
    onChange: onChange,
    writeSeq: function () { return writeSeq; },
    SCHEMA_VERSION: SCHEMA_VERSION
  };
})();
