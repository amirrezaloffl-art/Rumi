// Rumi main app logic. Vanilla JS, hash-based routing, no external deps.

(function () {
  'use strict';

  var J = window.Jalali;
  var DB = window.DB;

  var BUCKETS = [
    { key: 'personal',  label: 'Personal income',    pct: 0.50, color: 'var(--cat-1)' },
    { key: 'wholesale', label: 'Wholesale increase', pct: 0.30, color: 'var(--cat-3)' },
    { key: 'tax',       label: 'Emergency & tax',    pct: 0.20, color: 'var(--cat-4)' }
  ];

  // Business + financial configuration (persisted under meta key 'settings').
  var DEFAULT_SETTINGS = {
    company: { name: 'Rumi', address: '', phone: '', taxId: '', invoiceNote: '' },
    finance: { currencySymbol: 'T', currencyPosition: 'suffix', decimals: 0, taxRate: 9, monthlyRevenueGoal: 0 },
    inventory: { lowStockLevel: 5 },
    allocation: { personal: 50, wholesale: 30, tax: 20 },
    expenseCategories: ['Rent', 'Salaries', 'Utilities', 'Supplies', 'Inventory purchase', 'Marketing', 'Transport', 'Other'],
    fundingSources: ['Owner contribution', 'Loan', 'Other']
  };

  var ROUTES = ['dashboard','orders','calendar','profits','expenses','reports','catalog','customers','contact','archive','settings'];

  // ====== State ======
  var state = {
    calMode: 'jalali',              // 'jalali' | 'gregorian'  -> persisted via meta
    calCursor: new Date(),          // first-of-month cursor for calendar nav
    calSelected: null,              // ISO of the day shown in the calendar agenda panel
    chartGran: 'week',              // 'week' | 'month'
    profitPeriod: 'month',          // 'day' | 'week' | 'month' | 'year'
    expensePeriod: 'month',         // 'day' | 'week' | 'month' | 'year' | 'all'
    editingExpenseId: null,
    reportPeriod: 'month',          // 'month' | 'year' | 'all'  (calendar periods for reports)
    ordersView: 'cards',            // 'cards' | 'list'
    ordersSort: 'recent',           // 'recent' | 'totalDesc' | 'profitDesc'
    ordersStatus: '',               // '' | 'unpaid' | 'notsent' | 'paid' | 'sent'
    customersSort: 'spentDesc',     // contacts page sort
    customersFilter: 'all',         // 'all' | 'buyers' | 'leads'
    catalogView: 'list',            // 'list' | 'cards'
    catalogSort: 'name',            // name | stockAsc | stockDesc | recent | expiry | value
    catalogQuery: '',               // catalog search text (kept across saves / redraws)
    catalogOpen: {},                // product id -> true while its details are expanded
    customersQuery: '',             // contacts search text (kept across saves / redraws)
    formCalMode: 'jalali',          // for order form date input
    editingOrderId: null,
    editingCustomerId: null,
    confirmCb: null,
    lastBackup: null,               // ISO timestamp of last export/import (from meta)
    settings: null,                 // business/financial config (from meta 'settings')
    cache: { orders: [], customers: [], products: [], expenses: [], funding: [], archive: [] }
  };

  // Deep-ish merge of saved settings over defaults so new keys always exist.
  function mergeSettings(saved) {
    var s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (saved && typeof saved === 'object') {
      ['company', 'finance', 'inventory', 'allocation'].forEach(function (grp) {
        if (saved[grp] && typeof saved[grp] === 'object') {
          // Legacy 4-bucket allocation (had "storefront") → drop it and use the new 3-bucket default.
          if (grp === 'allocation' && ('storefront' in saved[grp])) return;
          for (var k in saved[grp]) if (saved[grp][k] != null) s[grp][k] = saved[grp][k];
        }
      });
      if (Array.isArray(saved.expenseCategories) && saved.expenseCategories.length) s.expenseCategories = saved.expenseCategories.slice();
      if (Array.isArray(saved.fundingSources) && saved.fundingSources.length) s.fundingSources = saved.fundingSources.slice();
    }
    return s;
  }
  function applySettings() {
    var a = state.settings.allocation;
    BUCKETS.forEach(function (b) { if (a[b.key] != null) b.pct = (num(a[b.key]) || 0) / 100; });
  }

  // ====== Utilities ======
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') for (var ev in attrs.on) n.addEventListener(ev, attrs.on[ev]);
      else if (k === 'data') for (var d in attrs.data) n.dataset[d] = attrs.data[d];
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function groupThousands(intStr) {
    var parts = [];
    while (intStr.length > 3) { parts.unshift(intStr.slice(-3)); intStr = intStr.slice(0, -3); }
    parts.unshift(intStr);
    return parts.join(',');
  }
  // Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to Latin 0-9.
  function toEnglishDigits(str) {
    if (str == null) return str;
    return String(str)
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  }
  // Read a number from a field or a record. Accepts Persian/Arabic digits, thousands
  // separators (1,250,000 / ۱٬۲۵۰٬۰۰۰) and the Arabic decimal mark. Same results as
  // Number() for real numbers, '' and null.
  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return v === null ? 0 : NaN;
    if (typeof v === 'boolean') return v ? 1 : 0;
    var s = toEnglishDigits(String(v)).replace(/[\s,٬']/g, '').replace(/٫/g, '.');
    return s === '' ? 0 : Number(s);
  }
  // Group thousands in a number field once the user leaves it (1250000 → 1,250,000).
  function formatNumInput(inp) {
    var raw = String(inp.value || '').trim();
    if (!raw) return;
    var n = num(raw);
    if (!isFinite(n)) return;
    var neg = n < 0, parts = String(Math.abs(n)).split('.');
    inp.value = (neg ? '-' : '') + groupThousands(parts[0]) + (parts[1] ? '.' + parts[1] : '');
  }
  // Sequential order number shown to the user (#12). Internal ids are long and unique per device.
  function orderNo(o) { return o && o.no != null ? o.no : (o ? o.id : ''); }

  function fmtMoney(n) {
    if (n == null || isNaN(n)) n = 0;
    var fin = (state.settings && state.settings.finance) || DEFAULT_SETTINGS.finance;
    var decimals = Math.max(0, Math.min(4, num(fin.decimals) || 0));
    var symbol = fin.currencySymbol != null ? fin.currencySymbol : 'T';
    var abs = Math.abs(n);
    var fixed = decimals > 0 ? abs.toFixed(decimals) : String(Math.round(abs));
    var sign = n < 0 && Number(fixed) !== 0 ? '-' : ''; // never "-0 T"
    var dot = fixed.indexOf('.');
    var intStr = dot === -1 ? fixed : fixed.slice(0, dot);
    var fracStr = dot === -1 ? '' : fixed.slice(dot);
    var digits = groupThousands(intStr) + fracStr;
    if (!symbol) return sign + digits;
    return fin.currencyPosition === 'prefix' ? sign + symbol + digits : sign + digits + ' ' + symbol;
  }
  // Compact money for tight spaces (calendar cells): 4,350,000 → 4.4M
  function fmtCompact(n) {
    n = num(n) || 0;
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
  }
  function fmtDateForList(iso) {
    var d = J.dateFromIso(iso);
    if (!d) return iso || '';
    if (state.calMode === 'jalali') return J.formatJalali(d);
    return J.formatGregorian(d);
  }
  function toast(msg, kind) {
    var t = $('#toast');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { t.classList.add('hidden'); }, 2400);
  }
  // Toast with an action button (used for "Undo" after a delete). Stays ~6s.
  function toastAction(msg, actionLabel, onAction) {
    var t = $('#toast');
    clearTimeout(toast._h);
    t.className = 'toast ok';
    t.textContent = '';
    t.appendChild(document.createTextNode(msg + ' '));
    var btn = el('button', { class: 'toast-action', type: 'button', on: { click: function () {
      clearTimeout(toast._h);
      t.classList.add('hidden');
      onAction();
    } } }, actionLabel);
    t.appendChild(btn);
    toast._h = setTimeout(function () { t.classList.add('hidden'); }, 6000);
  }
  function confirm(title, text, onOk) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent  = text;
    state.confirmCb = onOk;
    openModal('confirmModal');
  }
  function openModal(id) { $('#' + id).classList.remove('hidden'); }
  function closeModal(id) { $('#' + id).classList.add('hidden'); }

  // ====== Archive (soft delete) ======
  // Deleting anything archives it instead of destroying it — it leaves its page
  // (and all totals) and appears on the Archive page, where it can be restored.
  var ARCHIVE_LABELS = { orders: 'Order', customers: 'Contact', products: 'Product', expenses: 'Expense', funding: 'Funding' };
  function restoreRecord(store, rec) {
    if (store === 'orders') return DB.restoreOrder(rec.id);
    rec.archived = false; delete rec.archivedAt;
    return DB.put(store, rec);
  }
  function archiveRecord(store, rec, label) {
    var p;
    if (store === 'orders') {
      p = DB.archiveOrder(rec.id);
    } else {
      rec.archived = true; rec.archivedAt = new Date().toISOString();
      p = DB.put(store, rec);
    }
    return p.then(function () {
      renderInPlace();
      toastAction((label || ARCHIVE_LABELS[store] || 'Item') + ' archived.', 'Undo', function () {
        restoreRecord(store, rec).then(function () { toast('Restored', 'ok'); renderInPlace(); });
      });
    }).catch(function () { toast('Could not archive', 'error'); });
  }
  function purgeRecord(store, rec) { return DB.del(store, rec.id); }

  // Segmented toggle (two buttons, one active). Values are '1'/'0' → boolean.
  function segWire(id) {
    var box = $('#' + id);
    box.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        box.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
    });
  }
  function segSet(id, on) {
    var v = on ? '1' : '0';
    $('#' + id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b.dataset.val === v); });
  }
  function segGet(id) {
    var a = $('#' + id).querySelector('button.active');
    return a ? a.dataset.val === '1' : false;
  }

  // ====== Data loading ======
  function refreshCache() {
    return Promise.all([DB.all('orders'), DB.all('customers'), DB.all('products'), DB.all('expenses'), DB.all('funding'), DB.getMeta('lastBackup'), DB.getMeta('settings'), DB.all('stockMoves')])
      .then(function (rs) {
        // Stock is derived (stock moves − units in active orders), never stored.
        var onHand = DB.computeStock(rs[0], rs[7]);
        (rs[2] || []).forEach(function (p) { p.stock = onHand[p.id] || 0; });
        state.settings = mergeSettings(rs[6]);
        applySettings();
        // Split each store into active (shown everywhere) and archived (Archive page only).
        var archive = [];
        function split(store, rows) {
          var active = [];
          (rows || []).forEach(function (r) {
            if (r && r.archived) archive.push({ store: store, rec: r });
            else active.push(r);
          });
          return active;
        }
        state.cache.orders    = split('orders', rs[0]).sort(function (a, b) {
          var d = (b.date || '').localeCompare(a.date || '');
          if (d !== 0) return d;
          return (b.id || 0) - (a.id || 0);
        });
        state.cache.customers = split('customers', rs[1]);
        state.cache.products  = split('products', rs[2]);
        state.cache.expenses  = split('expenses', rs[3]).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        state.cache.funding   = split('funding', rs[4]).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        state.cache.archive   = archive.sort(function (a, b) { return String(b.rec.archivedAt || '').localeCompare(String(a.rec.archivedAt || '')); });
        state.lastBackup      = rs[5] || null;
        return state.cache;
      });
  }

  function refreshDatalists() {
    var cl = $('#customerList'); cl.innerHTML = '';
    state.cache.customers.forEach(function (c) {
      cl.appendChild(el('option', { value: c.name }));
    });
    var pl = $('#productList'); pl.innerHTML = '';
    state.cache.products.forEach(function (p) {
      pl.appendChild(el('option', { value: p.name }));
    });
  }

  function refreshBackupStatus() {
    DB.getMeta('lastBackup').then(function (iso) {
      var label = 'Last backup: never';
      if (iso) {
        var d = new Date(iso);
        label = 'Last backup: ' + J.formatJalali(d) + ' ' + J.pad(d.getHours()) + ':' + J.pad(d.getMinutes());
      }
      $('#backupStatus').textContent = label;
    });
  }

  // ====== Profit math ======
  function orderProfit(o) {
    var p = 0;
    (o.products || []).forEach(function (l) {
      p += (num(l.sellPrice) - num(l.costPrice)) * num(l.qty);
    });
    // A discount, gifts (given away free) and any loss (defects/refunds) all come straight out of margin.
    return p - (num(o.discount) || 0) - giftsCost(o) - (num(o.loss) || 0);
  }
  function giftsCost(o) {
    return (o.gifts || []).reduce(function (s, g) { return s + num(g.costPrice) * num(g.qty); }, 0);
  }
  function filterOrdersByPeriod(orders, period) {
    var now = new Date();
    var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'day')        { /* cutoff is start of today */ }
    else if (period === 'week')  { cutoff.setDate(cutoff.getDate() - 6); }
    else if (period === 'month') { cutoff.setDate(cutoff.getDate() - 29); }
    else if (period === 'year')  { cutoff.setDate(cutoff.getDate() - 364); }
    else return orders.slice();
    var y = cutoff.getFullYear();
    var m = String(cutoff.getMonth() + 1).padStart(2, '0');
    var d = String(cutoff.getDate()).padStart(2, '0');
    var cutoffIso = y + '-' + m + '-' + d;
    return orders.filter(function (o) { return (o.date || '') >= cutoffIso; });
  }
  function orderTotal(o) {
    var t = num(o.shipping) || 0;
    (o.products || []).forEach(function (l) {
      t += num(l.sellPrice) * num(l.qty);
    });
    return t - (num(o.discount) || 0);
  }
  function bucketSplit(profit) {
    var out = {};
    BUCKETS.forEach(function (b) { out[b.key] = profit * b.pct; });
    return out;
  }
  // Month boundaries that follow the user's current calendar mode (Jalali or Gregorian)
  function periodMonthStart(date) {
    if (state.calMode === 'jalali') {
      var j = J.gregorianToJalali(date);
      return J.jalaliToGregorian(j.jy, j.jm, 1);
    }
    return J.startOfMonth(date);
  }
  function periodMonthAdd(date, n) {
    if (state.calMode === 'jalali') {
      var j = J.gregorianToJalali(date);
      var jm = j.jm + n, jy = j.jy;
      while (jm > 12) { jm -= 12; jy += 1; }
      while (jm < 1)  { jm += 12; jy -= 1; }
      return J.jalaliToGregorian(jy, jm, 1);
    }
    return J.addMonths(date, n);
  }
  function periodMonthLabel(date) {
    if (state.calMode === 'jalali') {
      var j = J.gregorianToJalali(date);
      return J.jMonths[j.jm - 1].slice(0, 3);
    }
    return J.gMonths[date.getMonth()].slice(0, 3);
  }
  function periodYearStart(date) {
    if (state.calMode === 'jalali') { var j = J.gregorianToJalali(date); return J.jalaliToGregorian(j.jy, 1, 1); }
    return new Date(date.getFullYear(), 0, 1);
  }
  function periodYearAdd(date, n) {
    if (state.calMode === 'jalali') { var j = J.gregorianToJalali(date); return J.jalaliToGregorian(j.jy + n, 1, 1); }
    return new Date(date.getFullYear() + n, 0, 1);
  }

  // ====== Reporting helpers ======
  // A calendar period [startIso, endIso) respecting the active calendar mode.
  function reportRange(period) {
    var now = new Date();
    if (period === 'all') return { startIso: null, endIso: null, label: 'All time' };
    if (period === 'year') {
      var ys = periodYearStart(now), ye = periodYearAdd(ys, 1);
      var yl = state.calMode === 'jalali' ? J.gregorianToJalali(ys).jy : ys.getFullYear();
      return { startIso: J.isoFromDate(ys), endIso: J.isoFromDate(ye), label: 'Year ' + yl };
    }
    var ms = periodMonthStart(now), me = periodMonthAdd(ms, 1);
    var ml = state.calMode === 'jalali'
      ? (J.jMonths[J.gregorianToJalali(ms).jm - 1] + ' ' + J.gregorianToJalali(ms).jy)
      : (J.gMonths[ms.getMonth()] + ' ' + ms.getFullYear());
    return { startIso: J.isoFromDate(ms), endIso: J.isoFromDate(me), label: ml };
  }
  function inRangeIso(iso, r) {
    if (!iso) return false;
    if (r.startIso && iso < r.startIso) return false;
    if (r.endIso && iso >= r.endIso) return false;
    return true;
  }
  function ordersInRange(orders, r) { return orders.filter(function (o) { return inRangeIso(o.date, r); }); }
  function sumRevenueGoods(orders) {
    var s = 0; orders.forEach(function (o) { (o.products || []).forEach(function (l) { s += num(l.sellPrice) * num(l.qty); }); }); return s;
  }
  function sumShipping(orders) { return orders.reduce(function (s, o) { return s + (num(o.shipping) || 0); }, 0); }
  function sumCOGS(orders) {
    var s = 0; orders.forEach(function (o) { (o.products || []).forEach(function (l) { s += num(l.costPrice) * num(l.qty); }); }); return s;
  }
  function entryDateIso(e) { return e.date || (e.createdAt ? String(e.createdAt).slice(0, 10) : ''); }
  function entriesInRange(list, r) { return (list || []).filter(function (e) { return inRangeIso(entryDateIso(e), r); }); }
  function inventoryValue() {
    return state.cache.products.reduce(function (s, p) {
      var st = num(p.stock) || 0;
      return s + (st > 0 ? st * (num(p.defaultCost) || 0) : 0);
    }, 0);
  }

  // ====== Routing ======
  function currentRoute() {
    var r = (location.hash || '#/dashboard').replace(/^#\//, '').split('/')[0];
    if (ROUTES.indexOf(r) === -1) r = 'dashboard';
    return r;
  }
  function currentParam() {
    return (location.hash || '').replace(/^#\//, '').split('/')[1] || '';
  }
  function navigate(route) { location.hash = '#/' + route; }

  // Redraw after a save without losing your place: filters/search live in `state`,
  // and the scroll position is put back once the page is rebuilt.
  function renderInPlace() {
    var y = window.scrollY;
    var vh = $('#view');
    vh.style.minHeight = vh.offsetHeight + 'px'; // keep the page tall while it is rebuilt, so the scroll doesn't jump
    return render().then(function () {
      window.scrollTo(0, y);
      vh.style.minHeight = '';
    });
  }
  var MORE_ROUTES = ['profits', 'expenses', 'reports', 'catalog', 'customers', 'contact', 'archive', 'settings'];
  function render() {
    if (!Lock.unlocked) return Promise.resolve(); // nothing is drawn behind the lock screen
    closeSelect();
    var r = currentRoute();
    $$('.nav a, .tabbar a, .more-grid a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === r || (r === 'contact' && a.dataset.route === 'customers'));
    });
    $('#tabMore').classList.toggle('active', MORE_ROUTES.indexOf(r) !== -1);
    closeModal('moreSheet');
    var titles = {
      dashboard: 'Dashboard', orders: 'Orders', calendar: 'Calendar',
      profits: 'Profits', expenses: 'Expenses', reports: 'Financial Reports', catalog: 'Product Catalog',
      customers: 'Contacts', contact: 'Contact', archive: 'Archive', settings: 'Settings'
    };
    $('#pageTitle').textContent = titles[r];
    $('#topbarActions').innerHTML = '';
    var view = $('#view');
    view.innerHTML = '';
    return refreshCache().then(function () {
      refreshDatalists();
      if (r === 'dashboard') renderDashboard(view);
      else if (r === 'orders') renderOrders(view);
      else if (r === 'calendar') renderCalendar(view);
      else if (r === 'profits') renderProfits(view);
      else if (r === 'expenses') renderExpenses(view);
      else if (r === 'reports') renderReports(view);
      else if (r === 'catalog') renderCatalog(view);
      else if (r === 'customers') renderCustomers(view);
      else if (r === 'contact') renderContactDetail(view, num(currentParam()));
      else if (r === 'archive') renderArchive(view);
      else if (r === 'settings') renderSettings(view);
    });
  }

  // ====== Backup safety ======
  // Most recent time anything changed, so we can tell if the last backup is stale.
  function lastDataChange() {
    var max = '';
    function consider(ts) { if (ts && ts > max) max = ts; }
    // updatedAt is stamped on every write (edits, status toggles, stock changes), not just creation.
    ['orders', 'products', 'customers', 'expenses', 'funding'].forEach(function (s) {
      state.cache[s].forEach(function (r) { consider(r.updatedAt || r.createdAt); });
    });
    state.cache.archive.forEach(function (a) { consider(a.rec.updatedAt || a.rec.archivedAt); });
    return max;
  }
  function hasAnyData() {
    var c = state.cache;
    return (c.orders.length + c.customers.length + c.products.length + c.expenses.length + c.funding.length) > 0;
  }
  // Returns a reminder banner element, or null when no nudge is needed.
  function buildBackupReminder() {
    if (!hasAnyData()) return null;
    if (window.Sync && Sync.isConfigured()) return null; // the cloud copy (with its commit history) is the backup
    var changed = lastDataChange();
    var stale = !state.lastBackup || (changed && changed > state.lastBackup);
    if (!stale) return null;

    var msg, since = '';
    if (!state.lastBackup) {
      msg = 'You haven’t backed up yet. All data lives only in this browser — clearing site data or switching devices would lose it.';
    } else {
      var d = new Date(state.lastBackup);
      var days = Math.floor((Date.now() - d.getTime()) / 86400000);
      since = days <= 0 ? 'today' : (days === 1 ? '1 day ago' : days + ' days ago');
      msg = 'You have changes since your last backup (' + since + '). Download a fresh copy to keep it safe.';
    }

    return el('div', { class: 'alert warn', role: 'status' }, [
      el('span', { class: 'alert-icon', 'aria-hidden': 'true' }, '⚠'),
      el('div', { class: 'alert-body' }, [
        el('div', { class: 'alert-title' }, 'Back up your data'),
        el('div', { class: 'alert-msg' }, msg)
      ]),
      el('button', { class: 'btn primary sm', on: { click: doExport } }, 'Download backup')
    ]);
  }

  // ====== Dashboard ======
  // A dashboard KPI card with a month-over-month delta chip + 14-day sparkline.
  function dashKpi(label, valueStr, cur, prev, hero, sparkVals) {
    var d = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round((cur - prev) / Math.abs(prev) * 100);
    var dir = d > 0 ? 'up' : (d < 0 ? 'down' : 'flat');
    var arrow = d > 0 ? '▲ ' : (d < 0 ? '▼ ' : '');
    var spark = el('canvas', { class: 'kpi-spark' });
    var card = el('div', { class: 'card stat kpi' + (hero ? ' ink' : '') }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, valueStr),
      el('div', { class: 'kpi-sub' }, [
        el('span', { class: 'kpi-delta ' + dir }, arrow + Math.abs(d) + '%'),
        el('span', { class: 'kpi-vs' }, 'vs last month')
      ]),
      el('div', { class: 'kpi-spark-wrap' }, spark)
    ]);
    if (sparkVals) setTimeout(function () { drawSparkline(spark, sparkVals, hero); }, 0);
    return card;
  }

  // Daily totals for the last `days` days (ending today) for sparklines.
  function dailySeries(orders, days, valueFn) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var startMs = today.getTime() - (days - 1) * 86400000;
    var arr = []; for (var i = 0; i < days; i++) arr.push(0);
    orders.forEach(function (o) {
      var dt = J.dateFromIso(o.date); if (!dt) return;
      var dm = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
      var idx = Math.round((dm - startMs) / 86400000);
      if (idx >= 0 && idx < days) arr[idx] += valueFn(o);
    });
    return arr;
  }

  function drawSparkline(canvas, values, hero) {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    var ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio);
    var W = rect.width, H = rect.height; ctx.clearRect(0, 0, W, H);
    var n = values.length; if (n < 2) return;
    var line = hero ? '#ffffff' : ((getComputedStyle(document.documentElement).getPropertyValue('--chart-bar') || '').trim() || '#1f1f1f');
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values.concat([0]));
    if (max === min) max = min + 1;
    var pad = 3;
    function X(i) { return pad + (W - 2 * pad) * (i / (n - 1)); }
    function Y(v) { return H - pad - (H - 2 * pad) * ((v - min) / (max - min)); }
    ctx.beginPath(); ctx.moveTo(X(0), Y(values[0]));
    values.forEach(function (v, i) { ctx.lineTo(X(i), Y(v)); });
    ctx.lineTo(X(n - 1), H); ctx.lineTo(X(0), H); ctx.closePath();
    ctx.globalAlpha = hero ? 0.20 : 0.08; ctx.fillStyle = line; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath();
    values.forEach(function (v, i) { var px = X(i), py = Y(v); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.arc(X(n - 1), Y(values[n - 1]), 2, 0, Math.PI * 2); ctx.fillStyle = line; ctx.fill();
  }

  // This-vs-last comparison mini-card with two bars.
  function compareCard(label, cur, prev, isMoney) {
    var max = Math.max(cur, prev, 1);
    var d = prev === 0 ? (cur > 0 ? 100 : 0) : Math.round((cur - prev) / Math.abs(prev) * 100);
    var dir = d > 0 ? 'up' : (d < 0 ? 'down' : 'flat');
    function fmt(v) { return isMoney ? fmtMoney(v) : String(v); }
    function bar(v, cls, tag) {
      return el('div', { class: 'cmp-row' }, [
        el('span', { class: 'cmp-tag' }, tag),
        el('div', { class: 'cmp-track' }, el('div', { class: 'cmp-fill ' + cls, style: 'width:' + Math.round(v / max * 100) + '%' })),
        el('span', { class: 'cmp-val' }, fmt(v))
      ]);
    }
    return el('div', { class: 'card cmp-card' }, [
      el('div', { class: 'cmp-head' }, [
        el('span', {}, label),
        el('span', { class: 'kpi-delta ' + dir }, (d > 0 ? '▲ ' : (d < 0 ? '▼ ' : '')) + Math.abs(d) + '%')
      ]),
      bar(cur, 'cur', 'This'),
      bar(prev, 'prev', 'Last')
    ]);
  }

  function renderDashboard(root) {
    var reminder = buildBackupReminder();
    if (reminder) root.appendChild(reminder);

    var orders = state.cache.orders;
    var now = new Date();

    // ---- Greeting + quick actions ----
    var hr = now.getHours();
    var greet = hr < 12 ? 'Good morning' : (hr < 18 ? 'Good afternoon' : 'Good evening');
    var coName = (state.settings.company && state.settings.company.name) || 'Rumi';
    root.appendChild(el('div', { class: 'dash-hello' }, [
      el('div', {}, [
        el('div', { class: 'hello-title' }, greet),
        el('div', { class: 'hello-sub' }, coName + '  ·  J: ' + J.formatJalali(now) + '  ·  G: ' + J.formatGregorian(now))
      ]),
      el('div', { class: 'hello-actions' }, [
        el('button', { class: 'btn primary', on: { click: function () { openOrderForm(null); } } }, '+ New order'),
        el('button', { class: 'btn', on: { click: function () { openExpenseForm(null); } } }, '+ Expense'),
        el('button', { class: 'btn', on: { click: doExport } }, 'Backup')
      ])
    ]));

    var monthStart = periodMonthStart(now);
    var nextMonth  = periodMonthAdd(monthStart, 1);
    var lastStart  = periodMonthAdd(monthStart, -1);
    function inRange(o, s, e) { var d = J.dateFromIso(o.date); return d && d >= s && d < e; }

    var thisMonth = orders.filter(function (o) { return inRange(o, monthStart, nextMonth); });
    var lastMonth = orders.filter(function (o) { return inRange(o, lastStart, monthStart); });
    var monthProfit  = thisMonth.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var monthRevenue = thisMonth.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var lastProfit   = lastMonth.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var lastRevenue  = lastMonth.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var totalProfit  = orders.reduce(function (s, o) { return s + orderProfit(o); }, 0);

    // ---- KPI row (deltas + 14-day sparklines; one hero card) ----
    var sparkRev = dailySeries(orders, 14, function (o) { return orderTotal(o); });
    var sparkProf = dailySeries(orders, 14, function (o) { return orderProfit(o); });
    var sparkOrd = dailySeries(orders, 14, function () { return 1; });
    root.appendChild(el('div', { class: 'cards grid-4', style: 'margin-bottom:14px' }, [
      dashKpi('Revenue this month', fmtMoney(monthRevenue), monthRevenue, lastRevenue, false, sparkRev),
      dashKpi('Profit this month', fmtMoney(monthProfit), monthProfit, lastProfit, true, sparkProf),
      dashKpi('Orders this month', String(thisMonth.length), thisMonth.length, lastMonth.length, false, sparkOrd),
      statCard('All-time profit', fmtMoney(totalProfit), orders.length + ' order' + (orders.length === 1 ? '' : 's'))
    ]));

    // ---- Monthly revenue goal ----
    var goal = num(state.settings.finance.monthlyRevenueGoal) || 0;
    if (goal > 0) {
      var gpct = Math.min(100, Math.round(monthRevenue / goal * 100));
      var daysLeft = Math.max(0, Math.ceil((nextMonth - now) / 86400000));
      root.appendChild(el('div', { class: 'card goal-card', style: 'margin-bottom:18px' }, [
        el('div', { class: 'goal-head' }, [
          el('span', {}, 'Monthly revenue goal'),
          el('span', { class: 'goal-nums' }, fmtMoney(monthRevenue) + ' / ' + fmtMoney(goal) + '  ·  ' + gpct + '%')
        ]),
        el('div', { class: 'goal-bar' }, el('div', { class: 'goal-fill' + (gpct >= 100 ? ' done' : ''), style: 'width:' + gpct + '%' })),
        el('div', { class: 'goal-sub' }, (gpct >= 100 ? 'Goal reached! · ' : '') + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left in month')
      ]));
    }

    // ---- Today / this week snapshot ----
    var todayIso = J.isoFromDate(now);
    var weekStart = J.startOfWeek(now);
    var weekEnd = J.addDays(weekStart, 7);
    var ordersToday = orders.filter(function (o) { return o.date === todayIso; });
    var ordersWeek  = orders.filter(function (o) { return inRange(o, weekStart, weekEnd); });
    function snap(label, val) { return el('div', { class: 'snap' }, [el('div', { class: 's-label' }, label), el('div', { class: 's-val' }, val)]); }
    root.appendChild(el('div', { class: 'card snapshot', style: 'margin-bottom:18px' }, [
      snap('Orders today', String(ordersToday.length)),
      snap('Revenue today', fmtMoney(ordersToday.reduce(function (s, o) { return s + orderTotal(o); }, 0))),
      snap('Orders this week', String(ordersWeek.length)),
      snap('Revenue this week', fmtMoney(ordersWeek.reduce(function (s, o) { return s + orderTotal(o); }, 0)))
    ]));

    // ---- Trend chart + Needs attention ----
    var chartCard = el('div', { class: 'card' }, [
      el('div', { class: 'section-row', style: 'margin-bottom:10px' }, [
        el('div', {}, [
          el('div', { style: 'font-weight:600' }, 'Revenue & profit trend'),
          el('div', { class: 'chart-legend', style: 'margin-top:4px' }, [
            el('span', { class: 'cl-item' }, [el('span', { class: 'cl-line solid' }), 'Profit']),
            el('span', { class: 'cl-item' }, [el('span', { class: 'cl-line dashed' }), 'Revenue'])
          ])
        ]),
        el('div', { class: 'chart-tabs' }, [
          el('button', { class: state.chartGran === 'week' ? 'active' : '', on: { click: function () { state.chartGran = 'week'; render(); } } }, 'Week'),
          el('button', { class: state.chartGran === 'month' ? 'active' : '', on: { click: function () { state.chartGran = 'month'; render(); } } }, 'Month')
        ])
      ])
    ]);
    var chartWrap = el('div', { class: 'chart-wrap' });
    var canvas = el('canvas', {});
    chartWrap.appendChild(canvas);
    chartCard.appendChild(chartWrap);
    setTimeout(function () { drawTrendChart(canvas, orders, state.chartGran); }, 0);

    root.appendChild(el('div', { class: 'dash-grid' }, [chartCard, buildAttentionPanel(orders)]));

    // ---- This month vs last month + order status donuts ----
    root.appendChild(el('h3', { class: 'section-title' }, 'This month vs last month'));
    root.appendChild(el('div', { class: 'cards grid-3' }, [
      compareCard('Revenue', monthRevenue, lastRevenue, true),
      compareCard('Profit', monthProfit, lastProfit, true),
      compareCard('Orders', thisMonth.length, lastMonth.length, false)
    ]));

    if (orders.length > 0) {
      var paidCount = orders.filter(function (o) { return o.paid; }).length;
      var sentCount = orders.filter(function (o) { return o.shipped; }).length;
      var payPct  = Math.round(paidCount / orders.length * 100);
      var shipPct = Math.round(sentCount / orders.length * 100);
      var payCanvas = el('canvas', {}), shipCanvas = el('canvas', {});
      function donutLeg(items) {
        return el('div', { class: 'sd-legend' }, items.map(function (it) {
          return el('div', { class: 'dl-row' }, [
            el('span', { class: 'dl-swatch', style: 'background:' + it.color }),
            el('div', { class: 'dl-info' }, el('div', { class: 'dl-name' }, it.label)),
            el('div', { class: 'dl-pct' }, String(it.count))
          ]);
        }));
      }
      root.appendChild(el('div', { class: 'card status-donuts', style: 'margin-top:16px' }, [
        el('div', { class: 'sd-item' }, [
          el('div', { class: 'donut-mini' }, payCanvas),
          donutLeg([{ label: 'Paid', count: paidCount, color: 'var(--good)' }, { label: 'Unpaid', count: orders.length - paidCount, color: 'var(--track)' }])
        ]),
        el('div', { class: 'sd-item' }, [
          el('div', { class: 'donut-mini' }, shipCanvas),
          donutLeg([{ label: 'Sent', count: sentCount, color: 'var(--fat)' }, { label: 'Not sent', count: orders.length - sentCount, color: 'var(--track)' }])
        ])
      ]));
      setTimeout(function () {
        drawDonut(payCanvas, [{ value: paidCount, color: 'var(--good)' }, { value: orders.length - paidCount, color: 'var(--track)' }], payPct + '%', 'paid');
        drawDonut(shipCanvas, [{ value: sentCount, color: 'var(--fat)' }, { value: orders.length - sentCount, color: 'var(--track)' }], shipPct + '%', 'sent');
      }, 0);
    }

    // ---- Next to expire ----
    var nextExp = findExpiringProducts();
    if (nextExp.length > 0) {
      root.appendChild(el('h3', { class: 'section-title' }, 'Next to expire'));
      root.appendChild(buildNextExpireSection(nextExp));
    }

    // ---- Recent orders + Top customers (this month) ----
    root.appendChild(el('h3', { class: 'section-title' }, 'Recent orders'));
    var recent = orders.slice(0, 4);
    if (recent.length === 0) {
      root.appendChild(el('div', { class: 'card empty' }, 'No orders yet. Click "+ New Order" to add your first one.'));
    } else {
      var grid = el('div', { class: 'cards-list' });
      recent.forEach(function (o) { grid.appendChild(orderCard(o)); });
      root.appendChild(grid);
    }

    root.appendChild(el('h3', { class: 'section-title' }, 'Top customers (this month)'));
    var topC = aggregateCustomers(thisMonth).slice(0, 5);
    if (topC.length === 0) {
      root.appendChild(el('div', { class: 'card empty' }, 'No data yet.'));
    } else {
      var ml = el('div', { class: 'mini-list' });
      topC.forEach(function (c) {
        var nameDiv = el('div', { class: 'name', dir: 'auto' });
        nameDiv.appendChild(document.createTextNode(c.name + ' '));
        nameDiv.appendChild(el('span', { style: 'color:var(--muted);font-size:12px' }, '· ' + c.count + ' order' + (c.count > 1 ? 's' : '')));
        ml.appendChild(el('div', { class: 'row' }, [nameDiv, el('div', { class: 'val' }, fmtMoney(c.total))]));
      });
      root.appendChild(ml);
    }
  }

  // "Needs attention" action center — clickable rows jump to the relevant view.
  function buildAttentionPanel(orders) {
    var unpaid  = orders.filter(function (o) { return !o.paid; });
    var owed    = unpaid.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var notSent = orders.filter(function (o) { return !o.shipped; });
    var low = lowStockLevel();
    var lowStock = state.cache.products.filter(function (p) { var v = num(p.stock) || 0; return v <= 0 || (low > 0 && v < low); });
    var todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    var expiring = state.cache.products.filter(function (p) {
      if (!p.expireDate) return false;
      var d = J.dateFromIso(p.expireDate); if (!d) return false;
      return Math.round((d - todayMid) / 86400000) <= 30;
    });

    function goto(setter, hash) { return function () { if (setter) setter(); location.hash = hash; }; }
    function row(count, label, detail, onClick) {
      var active = count > 0 && onClick;
      return el('div', {
        class: 'attn-row' + (count > 0 ? ' active' : ' clear'),
        on: active ? { click: onClick } : undefined
      }, [
        el('div', { class: 'attn-main' }, [
          el('span', { class: 'attn-count' }, String(count)),
          el('span', { class: 'attn-label' }, label)
        ]),
        el('span', { class: 'attn-detail' }, count > 0 ? (detail || '') : 'all clear')
      ]);
    }

    return el('aside', { class: 'card attention' }, [
      el('div', { class: 'attn-head' }, 'Needs attention'),
      row(unpaid.length, 'Unpaid orders', owed > 0 ? fmtMoney(owed) + ' owed' : '', goto(function () { state.ordersStatus = 'unpaid'; }, '#/orders')),
      row(notSent.length, 'Not sent', 'to ship', goto(function () { state.ordersStatus = 'notsent'; }, '#/orders')),
      row(lowStock.length, 'Low / out of stock', 'reorder', goto(function () { state.catalogView = 'list'; state.catalogSort = 'stockAsc'; }, '#/catalog')),
      row(expiring.length, 'Expiring ≤ 30 days', 'check dates', goto(function () { state.catalogView = 'list'; state.catalogSort = 'expiry'; }, '#/catalog'))
    ]);
  }

  function statCard(label, value, sub, variant) {
    return el('div', { class: 'card stat' + (variant ? ' ' + variant : '') }, [
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value),
      el('div', { class: 'sub' }, sub || '')
    ]);
  }
  function el2(tag, attrs, kids) { return el(tag, attrs, kids); } // alias

  function aggregateCustomers(orders) {
    var map = {};
    orders.forEach(function (o) {
      var key = o.customerId || ('name:' + (o.customerName || ''));
      if (!map[key]) map[key] = { name: o.customerName, count: 0, total: 0, profit: 0 };
      map[key].count += 1;
      map[key].total += orderTotal(o);
      map[key].profit += orderProfit(o);
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return b.total - a.total; });
    return arr;
  }
  function aggregateProducts(orders) {
    var map = {};
    orders.forEach(function (o) {
      (o.products || []).forEach(function (l) {
        var key = (l.productId != null ? 'id:' + l.productId : 'name:' + (l.name || '')).toLowerCase();
        if (!map[key]) map[key] = { name: l.name, qty: 0, profit: 0, revenue: 0 };
        var prof = (num(l.sellPrice) - num(l.costPrice)) * num(l.qty);
        var rev  = num(l.sellPrice) * num(l.qty);
        map[key].qty     += num(l.qty);
        map[key].profit  += prof;
        map[key].revenue += rev;
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    var byProfit = arr.slice().sort(function (a, b) { return b.profit - a.profit; });
    var byQty    = arr.slice().sort(function (a, b) { return b.qty    - a.qty;    });
    return { byProfit: byProfit, byQty: byQty, all: arr };
  }
  // Per-product sold-units / revenue / profit totals, keyed by product id and by
  // name (so legacy lines without a productId still match). Computed live from
  // orders, so it always reflects edits, deletes, and undo.
  function computeProductSales(orders) {
    var byId = {}, byName = {};
    (orders || []).forEach(function (o) {
      (o.products || []).forEach(function (l) {
        var qty = num(l.qty) || 0;
        var revenue = num(l.sellPrice) * qty;
        var profit  = (num(l.sellPrice) - num(l.costPrice)) * qty;
        function add(bucket, key) {
          if (!bucket[key]) bucket[key] = { qty: 0, revenue: 0, profit: 0 };
          bucket[key].qty += qty; bucket[key].revenue += revenue; bucket[key].profit += profit;
        }
        if (l.productId != null) add(byId, l.productId);
        var nk = String(l.name || '').trim().toLowerCase();
        if (nk) add(byName, nk);
      });
    });
    return { byId: byId, byName: byName };
  }
  function statsForProduct(sales, p) {
    if (!sales) return { qty: 0, revenue: 0, profit: 0 };
    if (p && p.id != null && sales.byId[p.id]) return sales.byId[p.id];
    var nk = p ? (p.nameLower || String(p.name || '').toLowerCase()) : '';
    return sales.byName[nk] || { qty: 0, revenue: 0, profit: 0 };
  }
  // ====== Orders page ======
  function renderOrders(root) {
    // Topbar actions: view toggle
    var actions = el('div', { class: 'view-toggle' }, [
      el('button', { class: state.ordersView === 'cards' ? 'active' : '', on: { click: function () { state.ordersView = 'cards'; render(); } } }, 'Cards'),
      el('button', { class: state.ordersView === 'list'  ? 'active' : '', on: { click: function () { state.ordersView = 'list';  render(); } } }, 'List')
    ]);
    $('#topbarActions').appendChild(actions);

    // Filters
    var filt = el('div', { class: 'filters' });
    var search = el('input', { type: 'text', placeholder: 'Search customer / product…', id: 'flt_search' });
    var pet    = el('select', { id: 'flt_pet' }, [
      el('option', { value: '' }, 'All pets'),
      el('option', { value: 'dog' }, 'Dogs'),
      el('option', { value: 'cat' }, 'Cats')
    ]);
    var whole = el('select', { id: 'flt_whole' }, [
      el('option', { value: '' }, 'All orders'),
      el('option', { value: 'yes' }, 'Wholesale only'),
      el('option', { value: 'no'  }, 'Retail only')
    ]);
    var status = el('select', { id: 'flt_status' }, [
      el('option', { value: '' }, 'Any status'),
      el('option', { value: 'unpaid' }, 'Unpaid'),
      el('option', { value: 'notsent' }, 'Not sent'),
      el('option', { value: 'paid' }, 'Paid'),
      el('option', { value: 'sent' }, 'Sent')
    ]);
    status.value = state.ordersStatus || '';
    var sort = el('select', { id: 'flt_sort' }, [
      el('option', { value: 'recent' }, 'Newest first'),
      el('option', { value: 'totalDesc' }, 'Highest total'),
      el('option', { value: 'profitDesc' }, 'Highest profit')
    ]);
    sort.value = state.ordersSort || 'recent';
    filt.appendChild(search);
    filt.appendChild(pet);
    filt.appendChild(whole);
    filt.appendChild(status);
    filt.appendChild(el('label', { class: 'flt-sort' }, ['Sort', sort]));
    filt.appendChild(el('div', { class: 'spacer' }));
    root.appendChild(filt);

    var summaryHost = el('div', {});
    root.appendChild(summaryHost);
    var listHost = el('div', {});
    root.appendChild(listHost);

    function paint() {
      var q = search.value.trim().toLowerCase();
      var pv = pet.value, wv = whole.value, sv = status.value, sm = sort.value;
      state.ordersStatus = sv; state.ordersSort = sm;
      var rows = state.cache.orders.filter(function (o) {
        if (pv && o.pet !== pv) return false;
        if (wv === 'yes' && !o.isWholesale) return false;
        if (wv === 'no' && o.isWholesale) return false;
        if (sv === 'unpaid'  && o.paid)     return false;
        if (sv === 'notsent' && o.shipped)  return false;
        if (sv === 'paid'    && !o.paid)    return false;
        if (sv === 'sent'    && !o.shipped) return false;
        if (q) {
          var hay = (o.customerName || '').toLowerCase();
          (o.products || []).forEach(function (l) { hay += ' ' + (l.name || '').toLowerCase(); });
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
      rows = sortOrders(rows, sm);

      summaryHost.innerHTML = '';
      summaryHost.appendChild(buildOrdersSummary(rows));

      listHost.innerHTML = '';
      if (rows.length === 0) {
        listHost.appendChild(el('div', { class: 'card empty' }, 'No matching orders.'));
        return;
      }

      var grouped = sm === 'recent';
      if (state.ordersView === 'cards') {
        if (grouped) {
          groupByDate(rows).forEach(function (g) {
            listHost.appendChild(el('div', { class: 'section-row', style: 'margin:20px 0 10px' }, [
              el('h3', { class: 'section-title', style: 'margin:0' }, g.label),
              el('span', { style: 'color:var(--muted);font-size:12px' }, g.rows.length + ' order' + (g.rows.length === 1 ? '' : 's'))
            ]));
            var grid = el('div', { class: 'cards-list' });
            g.rows.forEach(function (o) { grid.appendChild(orderCard(o)); });
            listHost.appendChild(grid);
          });
        } else {
          var grid = el('div', { class: 'cards-list' });
          rows.forEach(function (o) { grid.appendChild(orderCard(o)); });
          listHost.appendChild(grid);
        }
      } else {
        listHost.appendChild(orderTable(rows, grouped));
      }
    }
    [search, pet, whole, status, sort].forEach(function (e) { e.addEventListener('input', paint); e.addEventListener('change', paint); });
    paint();
  }

  function sortOrders(rows, mode) {
    var arr = rows.slice();
    if (mode === 'totalDesc')       arr.sort(function (a, b) { return orderTotal(b) - orderTotal(a); });
    else if (mode === 'profitDesc') arr.sort(function (a, b) { return orderProfit(b) - orderProfit(a); });
    else arr.sort(function (a, b) { var d = (b.date || '').localeCompare(a.date || ''); return d !== 0 ? d : (b.id || 0) - (a.id || 0); });
    return arr;
  }

  // Bucket orders (sorted newest-first) into readable date sections.
  function groupByDate(rows) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var g = { up: [], today: [], yest: [], week: [], month: [], older: [] };
    rows.forEach(function (o) {
      var d = J.dateFromIso(o.date);
      var diff = d ? Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000) : 99999;
      if (diff < 0) g.up.push(o);
      else if (diff === 0) g.today.push(o);
      else if (diff === 1) g.yest.push(o);
      else if (diff <= 6) g.week.push(o);
      else if (diff <= 29) g.month.push(o);
      else g.older.push(o);
    });
    return [['up', 'Upcoming'], ['today', 'Today'], ['yest', 'Yesterday'], ['week', 'Earlier this week'], ['month', 'Earlier this month'], ['older', 'Older']]
      .map(function (k) { return { label: k[1], rows: g[k[0]] }; })
      .filter(function (grp) { return grp.rows.length; });
  }

  function buildOrdersSummary(rows) {
    var rev  = rows.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var prof = rows.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var unpaid = rows.filter(function (o) { return !o.paid; }).length;
    var unsent = rows.filter(function (o) { return !o.shipped; }).length;
    return el('div', { class: 'cards grid-5', style: 'margin-bottom:18px' }, [
      statCard('Orders', String(rows.length), 'shown'),
      statCard('Revenue', fmtMoney(rev), 'shown'),
      statCard('Profit', fmtMoney(prof), 'shown', prof < 0 ? 'bad' : 'good'),
      statCard('Unpaid', String(unpaid), unpaid ? 'need payment' : 'all paid'),
      statCard('Not sent', String(unsent), unsent ? 'to ship' : 'all sent')
    ]);
  }

  // Paid/Unpaid + Sent/Not-sent status badges shown on order cards & rows.
  // Clickable: toggles the status in place and saves, without opening the order.
  function statusBadges(o) {
    function mkBadge(field, onLabel, offLabel, onClass, offClass) {
      var b = el('span', {
        class: 'sbadge clickable ' + (o[field] ? onClass : offClass),
        title: 'Click to change',
        on: { click: function (e) {
          e.stopPropagation();
          o[field] = !o[field];
          b.className = 'sbadge clickable ' + (o[field] ? onClass : offClass);
          b.textContent = o[field] ? onLabel : offLabel;
          DB.put('orders', o)
            .then(function () { toast('Order #' + orderNo(o) + ' · ' + (o[field] ? onLabel : offLabel), 'ok'); })
            .catch(function () { toast('Could not save status', 'error'); });
        } }
      }, o[field] ? onLabel : offLabel);
      return b;
    }
    return el('span', { class: 'status-badges' }, [
      mkBadge('paid', 'Paid', 'Unpaid', 'ok', 'bad'),
      mkBadge('shipped', 'Sent', 'Not sent', 'ok', 'bad')
    ]);
  }

  function orderCard(o) {
    var profit = orderProfit(o);
    var total  = orderTotal(o);
    var items  = o.products || [];
    var itemCount = items.reduce(function (s, l) { return s + (num(l.qty) || 0); }, 0);
    var preview = items.length
      ? items[0].name + (items.length > 1 ? '  +' + (items.length - 1) + ' more' : '')
      : 'No items';
    var address = (o.address || '').trim();

    // Item line + (hover) address occupy the same slot so revealing the address
    // never changes the card height → sibling cards don't move.
    var slotKids = [el('div', { class: 'items', dir: 'auto' }, itemCount + ' item' + (itemCount === 1 ? '' : 's') + ' · ' + preview)];
    if (address) slotKids.push(el('div', { class: 'oc-address', dir: 'auto' }, address));
    var slot = el('div', { class: 'oc-slot' }, slotKids);

    var card = el('div', { class: 'order-card' + (address ? ' has-address' : ''), on: { click: function () { openOrderForm(o); } } }, [
      el('div', { class: 'head' }, [
        el('div', {}, [
          el('span', { class: 'num' }, '#' + orderNo(o) + ' '),
          el('span', { dir: 'auto' }, o.customerName || '')
        ]),
        el('span', { class: 'tag ' + (o.pet || '') }, (o.pet || '').toUpperCase())
      ]),
      el('div', { class: 'meta' }, fmtDateForList(o.date) + ' · ' + (o.time || '')),
      slot,
      el('div', { class: 'totals' }, [
        el('span', {}, 'Total: ' + fmtMoney(total)),
        el('span', { class: 'profit' + (profit < 0 ? ' neg' : '') }, 'Profit: ' + fmtMoney(profit))
      ]),
      el('div', { class: 'order-card-actions' }, [
        statusBadges(o),
        el('button', { class: 'btn ghost sm', on: { click: function (e) { e.stopPropagation(); printInvoice(o); } } }, 'Invoice')
      ])
    ]);
    var metaRow = card.querySelector('.meta');
    if (o.isWholesale) { metaRow.appendChild(document.createTextNode(' ')); metaRow.appendChild(el('span', { class: 'tag wholesale' }, 'WHOLESALE')); }
    if (num(o.loss) > 0) { metaRow.appendChild(document.createTextNode(' ')); metaRow.appendChild(el('span', { class: 'tag loss' }, 'LOSS')); }
    if ((o.gifts || []).length) { metaRow.appendChild(document.createTextNode(' ')); metaRow.appendChild(el('span', { class: 'tag gift' }, 'GIFT')); }
    return card;
  }

  function orderTable(rows, grouped) {
    var t = el('table', { class: 'table orders-table' });
    t.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, '#'),
      el('th', {}, 'Date'),
      el('th', {}, 'Customer'),
      el('th', {}, 'Pet'),
      el('th', {}, 'Status'),
      el('th', { class: 'num' }, 'Items'),
      el('th', { class: 'num' }, 'Total'),
      el('th', { class: 'num' }, 'Profit'),
      el('th', { class: 'actions' }, '')
    ])));
    var tb = el('tbody', {});
    function addRow(o) {
      tb.appendChild(el('tr', { on: { click: function (e) {
        if (e.target.tagName === 'BUTTON') return;
        openOrderForm(o);
      } }, style: 'cursor:pointer' }, [
        el('td', {}, '#' + orderNo(o)),
        el('td', {}, fmtDateForList(o.date)),
        el('td', { dir: 'auto' }, o.customerName || ''),
        el('td', {}, el('span', { class: 'tag ' + (o.pet || '') }, (o.pet || '').toUpperCase())),
        el('td', {}, statusBadges(o)),
        el('td', { class: 'num' }, String((o.products || []).reduce(function (s, l) { return s + num(l.qty); }, 0))),
        el('td', { class: 'num' }, fmtMoney(orderTotal(o))),
        el('td', { class: 'num' + (orderProfit(o) < 0 ? ' neg' : '') }, fmtMoney(orderProfit(o))),
        el('td', { class: 'actions' }, [
          el('button', { class: 'btn ghost sm', on: { click: function (e) { e.stopPropagation(); printInvoice(o); } } }, 'Invoice'),
          el('button', { class: 'btn ghost sm', on: { click: function (e) { e.stopPropagation(); deleteOrder(o); } } }, 'Delete')
        ])
      ]));
    }
    if (grouped) {
      groupByDate(rows).forEach(function (g) {
        tb.appendChild(el('tr', { class: 'group-row' }, el('td', { colspan: '9' }, g.label + ' · ' + g.rows.length)));
        g.rows.forEach(addRow);
      });
    } else {
      rows.forEach(addRow);
    }
    t.appendChild(tb);

    var tItems  = rows.reduce(function (s, o) { return s + (o.products || []).reduce(function (a, l) { return a + num(l.qty); }, 0); }, 0);
    var tTotal  = rows.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var tProfit = rows.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    t.appendChild(el('tfoot', {}, el('tr', { class: 'totals-row' }, [
      el('td', { colspan: '5' }, rows.length + ' order' + (rows.length === 1 ? '' : 's')),
      el('td', { class: 'num' }, String(tItems)),
      el('td', { class: 'num' }, fmtMoney(tTotal)),
      el('td', { class: 'num' + (tProfit < 0 ? ' neg' : '') }, fmtMoney(tProfit)),
      el('td', {})
    ])));
    return t;
  }

  function deleteOrder(o) {
    // Archive (soft delete): leaves the Orders page + all totals, inventory is
    // returned, and it can be restored from the Archive page.
    archiveRecord('orders', o, 'Order #' + orderNo(o));
  }

  // ====== Invoice ======
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Builds a fully self-contained HTML document for one order's invoice.
  function buildInvoiceHtml(o) {
    var co = (state.settings && state.settings.company) || DEFAULT_SETTINGS.company;
    var lines = o.products || [];
    var itemsSubtotal = lines.reduce(function (s, l) { return s + num(l.sellPrice) * num(l.qty); }, 0);
    var shipping = num(o.shipping) || 0;
    var discount = num(o.discount) || 0;
    var total = itemsSubtotal + shipping - discount;

    var d = J.dateFromIso(o.date);
    var dateStr = d ? (J.formatJalali(d) + ' &nbsp;/&nbsp; ' + J.formatGregorian(d)) : escapeHtml(o.date || '');
    var now = new Date();
    var issuedStr = J.formatJalali(now) + ' ' + J.pad(now.getHours()) + ':' + J.pad(now.getMinutes());

    var rows = lines.map(function (l, i) {
      var lineTotal = num(l.sellPrice) * num(l.qty);
      return '<tr>'
        + '<td class="c">' + (i + 1) + '</td>'
        + '<td>' + escapeHtml(l.name) + '</td>'
        + '<td class="r">' + escapeHtml(String(l.qty)) + '</td>'
        + '<td class="r">' + escapeHtml(fmtMoney(num(l.sellPrice))) + '</td>'
        + '<td class="r">' + escapeHtml(fmtMoney(lineTotal)) + '</td>'
        + '</tr>';
    }).join('');
    // Gifts: listed so the customer knows they're included, but never priced.
    rows += (o.gifts || []).map(function (g, i) {
      return '<tr class="gift">'
        + '<td class="c">' + (lines.length + i + 1) + '</td>'
        + '<td>' + escapeHtml(g.name) + ' <span class="gift-tag">Gift</span></td>'
        + '<td class="r">' + escapeHtml(String(g.qty)) + '</td>'
        + '<td class="r">—</td>'
        + '<td class="r">Free</td>'
        + '</tr>';
    }).join('');

    var companyLines = [co.address, co.phone, co.taxId ? 'Tax ID: ' + co.taxId : '']
      .filter(Boolean).map(function (x) { return '<div class="ph-line">' + escapeHtml(x) + '</div>'; }).join('');

    var billLines = [
      [o.phone1, o.phone2].filter(Boolean).join(' / '),
      o.email || '',
      o.address || ''
    ].filter(Boolean).map(function (x) { return '<div class="bill-line">' + escapeHtml(x) + '</div>'; }).join('');

    var wholesaleBadge = o.isWholesale ? '<span class="badge">WHOLESALE</span>' : '';
    var note = co.invoiceNote ? '<div class="note">' + escapeHtml(co.invoiceNote) + '</div>' : '';

    return '<!doctype html><html><head><meta charset="utf-8"><title>Invoice #' + orderNo(o) + '</title>'
      + '<style>'
      + '*{box-sizing:border-box}'
      + 'body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:0;padding:32px 36px;background:#fff}'
      + '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #111;padding-bottom:16px}'
      + '.ph-name{font-size:22px;font-weight:700}'
      + '.ph-line{font-size:12px;color:#444;margin-top:2px}'
      + '.inv-title{font-size:26px;font-weight:700;text-align:right;letter-spacing:.02em}'
      + '.inv-meta{font-size:12px;color:#444;text-align:right;margin-top:6px}'
      + '.inv-meta b{color:#111}'
      + '.parties{display:flex;justify-content:space-between;gap:24px;margin:22px 0}'
      + '.label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:4px}'
      + '.bill-name{font-size:15px;font-weight:600}'
      + '.bill-line{font-size:12px;color:#444}'
      + '.badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;background:#111;color:#fff;padding:2px 8px;border-radius:10px;vertical-align:middle;margin-left:8px}'
      + 'table{width:100%;border-collapse:collapse;margin-top:8px}'
      + 'th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666;border-bottom:1px solid #ccc;padding:8px 6px}'
      + 'td{padding:9px 6px;border-bottom:1px solid #eee}'
      + 'th.r,td.r{text-align:right}th.c,td.c{text-align:center;width:34px;color:#999}'
      + 'tr.gift td{color:#555}'
      + '.gift-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border:1px solid #999;color:#555;padding:0 6px;border-radius:10px;margin-left:6px;vertical-align:middle}'
      + '.totals{margin-top:16px;margin-left:auto;width:260px}'
      + '.totals .row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px}'
      + '.totals .row.grand{border-top:2px solid #111;margin-top:6px;padding-top:10px;font-size:16px;font-weight:700}'
      + '.note{margin-top:28px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#555;white-space:pre-wrap}'
      + '.foot{margin-top:36px;text-align:center;font-size:11px;color:#aaa}'
      + '@media print{body{padding:0}@page{margin:16mm}}'
      + '</style></head><body>'
      + '<div class="top">'
      +   '<div><div class="ph-name">' + escapeHtml(co.name || 'Rumi') + '</div>' + companyLines + '</div>'
      +   '<div><div class="inv-title">INVOICE</div>'
      +     '<div class="inv-meta"><b>#' + orderNo(o) + '</b></div>'
      +     '<div class="inv-meta">Order date: <b>' + dateStr + '</b></div>'
      +     '<div class="inv-meta">Issued: ' + escapeHtml(issuedStr) + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="parties">'
      +   '<div><div class="label">Bill to</div><div class="bill-name">' + escapeHtml(o.customerName || '—') + wholesaleBadge + '</div>' + billLines + '</div>'
      + '</div>'
      + '<table><thead><tr>'
      +   '<th class="c">#</th><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th>'
      + '</tr></thead><tbody>' + (rows || '<tr><td colspan="5" style="text-align:center;color:#999;padding:18px">No items</td></tr>') + '</tbody></table>'
      + '<div class="totals">'
      +   '<div class="row"><span>Subtotal</span><span>' + escapeHtml(fmtMoney(itemsSubtotal)) + '</span></div>'
      +   (shipping ? '<div class="row"><span>Shipping</span><span>' + escapeHtml(fmtMoney(shipping)) + '</span></div>' : '')
      +   (discount ? '<div class="row"><span>Discount</span><span>−' + escapeHtml(fmtMoney(discount)) + '</span></div>' : '')
      +   '<div class="row grand"><span>Total</span><span>' + escapeHtml(fmtMoney(total)) + '</span></div>'
      + '</div>'
      + note
      + '<div class="foot">Thank you for your business.</div>'
      + '</body></html>';
  }

  // Renders the invoice into a hidden iframe and triggers the print dialog.
  function printInvoice(o) {
    var frame = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;' });
    document.body.appendChild(frame);
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write(buildInvoiceHtml(o));
    doc.close();
    var done = false;
    function cleanup() { if (done) return; done = true; setTimeout(function () { frame.remove(); }, 500); }
    frame.contentWindow.onafterprint = cleanup;
    // Give the iframe a tick to lay out before printing.
    setTimeout(function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch (e) { toast('Could not open print dialog', 'error'); }
      // Fallback cleanup in case onafterprint never fires (some browsers).
      setTimeout(cleanup, 60000);
    }, 120);
  }

  // ====== Calendar ======
  function renderCalendar(root) {
    function shiftMonth(dir) {
      if (state.calMode === 'jalali') {
        var j = J.gregorianToJalali(state.calCursor);
        var m = j.jm + dir, y = j.jy;
        if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
        state.calCursor = J.jalaliToGregorian(y, m, 1);
      } else {
        state.calCursor = J.addMonths(state.calCursor, dir);
      }
      render();
    }

    // ---- Header: month nav + calendar-system toggle ----
    var head = el('div', { class: 'cal-head' });
    var nav  = el('div', { class: 'cal-nav' });
    var prev = el('button', { class: 'btn ghost sm', on: { click: function () { shiftMonth(-1); } } }, '‹ Prev');
    var next = el('button', { class: 'btn ghost sm', on: { click: function () { shiftMonth(1); } } }, 'Next ›');
    var todayBtn = el('button', { class: 'btn ghost sm', on: { click: function () { state.calCursor = new Date(); state.calSelected = J.isoFromDate(new Date()); render(); } } }, 'Today');
    var label = el('div', { class: 'month-label' });
    var monthName;
    if (state.calMode === 'jalali') {
      var jc = J.gregorianToJalali(state.calCursor);
      monthName = J.jMonths[jc.jm - 1] + ' ' + jc.jy;
    } else {
      monthName = J.gMonths[state.calCursor.getMonth()] + ' ' + state.calCursor.getFullYear();
    }
    label.textContent = monthName;
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next); nav.appendChild(todayBtn);
    head.appendChild(nav);

    var toggle = el('div', { class: 'cal-cal-toggle' }, [
      el('button', { class: state.calMode === 'jalali'    ? 'active' : '', on: { click: function () { state.calMode = 'jalali';    DB.setMeta('calMode','jalali');    render(); } } }, 'Jalali'),
      el('button', { class: state.calMode === 'gregorian' ? 'active' : '', on: { click: function () { state.calMode = 'gregorian'; DB.setMeta('calMode','gregorian'); render(); } } }, 'Gregorian')
    ]);
    head.appendChild(toggle);
    root.appendChild(head);

    // ---- Month grid + per-day order data ----
    var cells, gridYear, gridMonth;
    if (state.calMode === 'jalali') {
      var j2 = J.gregorianToJalali(state.calCursor);
      gridYear = j2.jy; gridMonth = j2.jm;
      cells = J.jalaliMonthGrid(j2.jy, j2.jm);
    } else {
      gridYear = state.calCursor.getFullYear(); gridMonth = state.calCursor.getMonth() + 1;
      cells = J.gregorianMonthGrid(gridYear, gridMonth);
    }

    var ordersByIso = {};
    state.cache.orders.forEach(function (o) {
      if (!ordersByIso[o.date]) ordersByIso[o.date] = [];
      ordersByIso[o.date].push(o);
    });

    var today = new Date();
    var todayIso = J.isoFromDate(today);
    var dayCells = [], monthOrders = [], maxCount = 0, isoSet = {};
    cells.forEach(function (dayNum) {
      if (dayNum == null) { dayCells.push(null); return; }
      var cellDate = state.calMode === 'jalali'
        ? J.jalaliToGregorian(gridYear, gridMonth, dayNum)
        : new Date(gridYear, gridMonth - 1, dayNum);
      var iso = J.isoFromDate(cellDate);
      var dayOrders = ordersByIso[iso] || [];
      var altLabel = state.calMode === 'jalali'
        ? (cellDate.getMonth() + 1) + '/' + cellDate.getDate()
        : (function () { var jj = J.gregorianToJalali(cellDate); return jj.jm + '/' + jj.jd; })();
      dayCells.push({ dayNum: dayNum, cellDate: cellDate, iso: iso, orders: dayOrders, alt: altLabel });
      isoSet[iso] = true;
      if (dayOrders.length > maxCount) maxCount = dayOrders.length;
      dayOrders.forEach(function (o) { monthOrders.push(o); });
    });

    // ---- Month summary strip ----
    var mProfit = monthOrders.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var mUnpaid = monthOrders.filter(function (o) { return !o.paid; }).length;
    var mUnsent = monthOrders.filter(function (o) { return !o.shipped; }).length;
    root.appendChild(el('div', { class: 'cards grid-5 cal-summary' }, [
      statCard('Orders', String(monthOrders.length), monthName),
      statCard('Revenue', fmtMoney(monthOrders.reduce(function (s, o) { return s + orderTotal(o); }, 0)), 'this month'),
      statCard('Profit', fmtMoney(mProfit), 'this month', mProfit < 0 ? 'bad' : 'good'),
      statCard('Unpaid', String(mUnpaid), mUnpaid ? 'need payment' : 'all paid'),
      statCard('Not sent', String(mUnsent), mUnsent ? 'to ship' : 'all sent')
    ]));

    // ---- Legend ----
    function legendItem(mark, text) { return el('span', { class: 'cal-leg-item' }, [el('span', { class: 'cal-leg-mark ' + mark }), text]); }
    var legend = el('div', { class: 'cal-legend' }, [
      legendItem('m-paid', 'Paid'),
      legendItem('m-unpaid', 'Unpaid'),
      legendItem('m-whole', 'Wholesale'),
      legendItem('m-heat', 'Busier day')
    ]);

    // ---- Calendar grid ----
    var cal = el('div', { class: 'calendar' });
    J.dowShort.forEach(function (d, i) {
      var weekend = state.calMode === 'jalali' ? (i === 5) : (i === 0 || i === 6);
      cal.appendChild(el('div', { class: 'cal-dow' + (weekend ? ' weekend' : '') }, d));
    });

    var cellByIso = {};
    dayCells.forEach(function (dc, idx) {
      if (dc == null) { cal.appendChild(el('div', { class: 'cal-cell empty' })); return; }
      var col = idx % 7;
      var weekend = state.calMode === 'jalali' ? (col === 5) : (col === 0 || col === 6);
      var count = dc.orders.length;
      var intensity = maxCount > 0 ? count / maxCount : 0;
      var bg = count > 0 ? 'background:rgb(var(--accent-rgb) / ' + (0.07 + intensity * 0.2).toFixed(2) + ');' : '';

      var daynum = el('div', { class: 'daynum' }, [
        el('span', { class: 'dn-num' }, String(dc.dayNum)),
        el('span', { class: 'alt' }, dc.alt)
      ]);
      if (count > 0) daynum.appendChild(el('span', { class: 'cal-count' }, String(count)));

      var foot = null;
      if (count > 0) {
        var dayRev = dc.orders.reduce(function (s, o) { return s + orderTotal(o); }, 0);
        var dots = el('div', { class: 'cal-dots' });
        dc.orders.slice(0, 5).forEach(function (o) { dots.appendChild(el('span', { class: 'cal-dot' + (o.paid ? ' paid' : '') })); });
        if (count > 5) dots.appendChild(el('span', { class: 'cal-more' }, '+' + (count - 5)));
        foot = el('div', { class: 'cal-foot' }, [el('span', { class: 'cal-rev' }, fmtCompact(dayRev)), dots]);
      }

      var cell = el('div', {
        class: 'cal-cell' + (J.sameDay(dc.cellDate, today) ? ' today' : '') + (weekend ? ' weekend' : '') + (count > 0 ? ' has-orders' : ''),
        style: bg,
        on: { click: function () { selectDay(dc.iso); } }
      }, [daynum, el('div', { class: 'cal-grow' }), foot]);
      cellByIso[dc.iso] = cell;
      cal.appendChild(cell);
    });

    // ---- Agenda side panel ----
    var agendaTitle = el('div', { class: 'ag-title' });
    var agendaCount = el('div', { class: 'ag-count' });
    var agendaBody  = el('div', { class: 'ag-body' });
    var agenda = el('aside', { class: 'cal-agenda card' }, [
      el('div', { class: 'ag-head' }, [agendaTitle, agendaCount]),
      agendaBody
    ]);

    function agendaRow(o) {
      return el('div', { class: 'agenda-row', on: { click: function () { openOrderForm(o); } } }, [
        el('div', { class: 'ar-top' }, [
          el('span', { class: 'ar-num' }, '#' + orderNo(o)),
          el('span', { class: 'ar-name', dir: 'auto' }, o.customerName || '—'),
          el('span', { class: 'ar-total' }, fmtMoney(orderTotal(o)))
        ]),
        statusBadges(o)
      ]);
    }
    function updateAgenda(iso) {
      agendaBody.innerHTML = '';
      var d = J.dateFromIso(iso);
      var list = ordersByIso[iso] || [];
      agendaTitle.textContent = d ? (state.calMode === 'jalali' ? J.formatJalali(d) : J.formatGregorian(d)) : 'Select a day';
      agendaCount.textContent = list.length + ' order' + (list.length === 1 ? '' : 's');
      if (list.length === 0) {
        agendaBody.appendChild(el('div', { class: 'ag-empty' }, 'No orders on this day.'));
      } else {
        list.forEach(function (o) { agendaBody.appendChild(agendaRow(o)); });
      }
      agendaBody.appendChild(el('button', {
        class: 'btn primary block', style: 'margin-top:14px',
        on: { click: function () { openOrderForm(null, d || new Date()); } }
      }, '+ Add order'));
    }
    function selectDay(iso) {
      state.calSelected = iso;
      Object.keys(cellByIso).forEach(function (k) { cellByIso[k].classList.toggle('selected', k === iso); });
      updateAgenda(iso);
    }

    var layout = el('div', { class: 'cal-layout' }, [
      el('div', { class: 'cal-main' }, [legend, cal]),
      agenda
    ]);
    root.appendChild(layout);

    // Default selected day: keep prior selection if still in view, else today, else latest day with orders, else 1st.
    var sel = state.calSelected;
    if (!sel || !isoSet[sel]) {
      if (isoSet[todayIso]) sel = todayIso;
      else {
        sel = null;
        for (var i = dayCells.length - 1; i >= 0; i--) { if (dayCells[i] && dayCells[i].orders.length) { sel = dayCells[i].iso; break; } }
        if (!sel) { for (var k = 0; k < dayCells.length; k++) { if (dayCells[k]) { sel = dayCells[k].iso; break; } } }
      }
    }
    if (sel) selectDay(sel);
  }

  // ====== Profits ======
  function renderProfits(root) {
    var orders = state.cache.orders;
    var totalProfit = orders.reduce(function (s, o) { return s + orderProfit(o); }, 0);

    // ----- Money paid (expenses): wholesale-order cost + inventory acquisition cost -----
    var wholesaleCost = 0;
    var wholesaleOrderCount = 0;
    orders.forEach(function (o) {
      if (!o.isWholesale) return;
      wholesaleOrderCount += 1;
      (o.products || []).forEach(function (l) {
        wholesaleCost += num(l.costPrice) * num(l.qty);
      });
    });
    var inventoryCost = 0;
    var inventoryUnits = 0;
    state.cache.products.forEach(function (p) {
      var s = num(p.stock) || 0;
      if (s <= 0) return;
      inventoryUnits += s;
      inventoryCost += s * (num(p.defaultCost) || 0);
    });

    // ----- Cash balance: profits + wholesale refunds + external funding - expenses -----
    var fundingTotal  = (state.cache.funding  || []).reduce(function (s, f) { return s + (num(f.amount) || 0); }, 0);
    var expensesTotal = (state.cache.expenses || []).reduce(function (s, x) { return s + (num(x.amount) || 0); }, 0);
    var cashBalance = totalProfit + wholesaleCost + fundingTotal - expensesTotal;

    // ----- Headline KPIs -----
    var totalRevenue = orders.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var marginPct = totalRevenue > 0 ? Math.round(totalProfit / totalRevenue * 100) : 0;
    var mOrders  = filterOrdersByPeriod(orders, 'month');
    var mProfit  = mOrders.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var mRevenue = mOrders.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    root.appendChild(el('div', { class: 'cards grid-5', style: 'margin-bottom:20px' }, [
      statCard('All-time profit', fmtMoney(totalProfit), orders.length + ' order' + (orders.length === 1 ? '' : 's'), 'ink'),
      statCard('Profit (30d)', fmtMoney(mProfit), 'last 30 days', mProfit < 0 ? 'bad' : 'good'),
      statCard('Revenue (30d)', fmtMoney(mRevenue), 'last 30 days'),
      statCard('Avg margin', marginPct + '%', 'profit / revenue'),
      statCard('Available cash', fmtMoney(cashBalance), cashBalance < 0 ? 'in deficit' : 'on hand', cashBalance < 0 ? 'bad' : 'good')
    ]));

    root.appendChild(el('h3', { class: 'section-title' }, 'Money paid'));
    var paidGrid = el('div', { class: 'cards grid-2' }, [
      el('div', { class: 'bucket' }, [
        el('div', { class: 'swatch', style: 'background:var(--cat-3)' }),
        el('div', { class: 'info' }, [
          el('div', { class: 'name' }, 'Wholesale orders cost (refund)'),
          el('div', { class: 'val' }, fmtMoney(wholesaleCost))
        ]),
        el('div', { class: 'pct' }, wholesaleOrderCount + ' order' + (wholesaleOrderCount === 1 ? '' : 's'))
      ]),
      el('div', { class: 'bucket' }, [
        el('div', { class: 'swatch', style: 'background:var(--cat-4)' }),
        el('div', { class: 'info' }, [
          el('div', { class: 'name' }, 'Inventory cost (catalog stock)'),
          el('div', { class: 'val' }, fmtMoney(inventoryCost))
        ]),
        el('div', { class: 'pct' }, inventoryUnits + ' unit' + (inventoryUnits === 1 ? '' : 's'))
      ])
    ]);
    root.appendChild(paidGrid);

    // ----- Losses (defects / refunds recorded on orders) -----
    var lossTotal = orders.reduce(function (s, o) { return s + (num(o.loss) || 0); }, 0);
    var lossCount = orders.filter(function (o) { return (num(o.loss) || 0) > 0; }).length;
    root.appendChild(el('h3', { class: 'section-title' }, 'Losses'));
    root.appendChild(el('div', { class: 'card', style: 'margin-bottom:18px' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px' }, [
        el('div', {}, [
          el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em' }, 'Total loss (defects, refunds)'),
          el('div', { style: 'font-size:28px;font-weight:700;margin-top:6px;color:var(--bad)' }, fmtMoney(lossTotal))
        ]),
        el('div', { style: 'color:var(--muted);font-size:13px;text-align:right' },
          lossCount + ' order' + (lossCount === 1 ? '' : 's') + ' affected · already deducted from order profit')
      ])
    ]));

    root.appendChild(el('h3', { class: 'section-title' }, 'Cash balance'));
    var balanceCard = el('div', { class: 'card', style: 'margin-bottom:18px' }, [
      el('div', { style: 'display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px' }, [
        el('div', {}, [
          el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em' }, 'Available cash'),
          el('div', { style: 'font-size:28px;font-weight:700;margin-top:6px;color:' + (cashBalance < 0 ? 'var(--bad)' : 'var(--good)') }, fmtMoney(cashBalance))
        ]),
        el('div', { class: 'mini-list', style: 'min-width:280px;font-size:13px;flex:1' }, [
          el('div', { class: 'row' }, [ el('div', { class: 'name' }, 'Order profits'),     el('div', { class: 'val' }, fmtMoney(totalProfit)) ]),
          el('div', { class: 'row' }, [ el('div', { class: 'name' }, 'Wholesale refunds'), el('div', { class: 'val' }, fmtMoney(wholesaleCost)) ]),
          el('div', { class: 'row' }, [ el('div', { class: 'name' }, 'External funding'),  el('div', { class: 'val' }, fmtMoney(fundingTotal)) ]),
          el('div', { class: 'row' }, [ el('div', { class: 'name' }, 'Expenses'),          el('div', { class: 'val', style: 'color:var(--bad)' }, fmtMoney(-expensesTotal)) ])
        ])
      ])
    ]);
    root.appendChild(balanceCard);

    // Buckets — filtered by selected period
    var PERIOD_LABELS = { day: 'today', week: 'last 7 days', month: 'last 30 days', year: 'last 365 days' };
    var periodOrders = filterOrdersByPeriod(orders, state.profitPeriod);
    var periodProfit = periodOrders.reduce(function (s, o) { return s + orderProfit(o); }, 0);

    root.appendChild(el('div', { class: 'section-row', style: 'margin-top:18px;margin-bottom:10px' }, [
      el('h3', { class: 'section-title', style: 'margin:0' }, 'Profit allocation (' + PERIOD_LABELS[state.profitPeriod] + ')'),
      el('div', { class: 'chart-tabs' }, [
        el('button', { class: state.profitPeriod === 'day'   ? 'active' : '', on: { click: function () { state.profitPeriod = 'day';   render(); } } }, 'Day'),
        el('button', { class: state.profitPeriod === 'week'  ? 'active' : '', on: { click: function () { state.profitPeriod = 'week';  render(); } } }, 'Week'),
        el('button', { class: state.profitPeriod === 'month' ? 'active' : '', on: { click: function () { state.profitPeriod = 'month'; render(); } } }, 'Month'),
        el('button', { class: state.profitPeriod === 'year'  ? 'active' : '', on: { click: function () { state.profitPeriod = 'year';  render(); } } }, 'Year')
      ])
    ]));
    var allocBase = Math.max(0, periodProfit);
    var donutCanvas = el('canvas', {});
    var donutLegend = el('div', { class: 'donut-legend' });
    var allocSegments = BUCKETS.map(function (b) {
      donutLegend.appendChild(el('div', { class: 'dl-row' }, [
        el('span', { class: 'dl-swatch', style: 'background:' + b.color }),
        el('div', { class: 'dl-info' }, [
          el('div', { class: 'dl-name' }, b.label),
          el('div', { class: 'dl-val' }, fmtMoney(allocBase * b.pct))
        ]),
        el('div', { class: 'dl-pct' }, Math.round(b.pct * 1000) / 10 + '%')
      ]));
      return { label: b.label, value: allocBase * b.pct, color: b.color };
    });
    root.appendChild(el('div', { class: 'card donut-card' }, [
      el('div', { class: 'donut-wrap' }, donutCanvas),
      donutLegend
    ]));
    setTimeout(function () { drawDonut(donutCanvas, allocSegments, fmtCompact(allocBase), periodProfit > 0 ? 'to allocate' : 'no profit'); }, 0);

    // Revenue & profit trend (line chart)
    root.appendChild(el('h3', { class: 'section-title' }, 'Revenue & profit trend'));
    var chartCard = el('div', { class: 'card' });
    var chartHead = el('div', { class: 'section-row', style: 'margin-bottom:10px' }, [
      el('div', { class: 'chart-legend' }, [
        el('span', { class: 'cl-item' }, [el('span', { class: 'cl-line solid' }), 'Profit']),
        el('span', { class: 'cl-item' }, [el('span', { class: 'cl-line dashed' }), 'Revenue'])
      ]),
      el('div', { class: 'chart-tabs' }, [
        el('button', { class: state.chartGran === 'week' ? 'active' : '', on: { click: function () { state.chartGran = 'week'; render(); } } }, 'Week'),
        el('button', { class: state.chartGran === 'month' ? 'active' : '', on: { click: function () { state.chartGran = 'month'; render(); } } }, 'Month')
      ])
    ]);
    chartCard.appendChild(chartHead);
    var chartWrap = el('div', { class: 'chart-wrap' });
    var canvas = el('canvas', {});
    chartWrap.appendChild(canvas);
    chartCard.appendChild(chartWrap);
    root.appendChild(chartCard);

    // Defer until inserted so canvas has a size
    setTimeout(function () {
      drawTrendChart(canvas, orders, state.chartGran);
    }, 0);

    // Top customers / products
    root.appendChild(el('h3', { class: 'section-title' }, 'Highlights'));
    var twoCols = el('div', { class: 'cards grid-2' });

    var custAgg = aggregateCustomers(orders);
    var customerCard = el('div', { class: 'card' }, [
      el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px' }, 'High-volume customers')
    ]);
    if (custAgg.length === 0) customerCard.appendChild(el('div', { class: 'empty', style: 'padding:14px' }, 'No data'));
    else {
      var ml = el('div', { class: 'mini-list' });
      custAgg.slice(0, 7).forEach(function (c) {
        var row = el('div', { class: 'row' }, [
          el('div', { class: 'name' }, [c.name + ' ', el('span', { style: 'color:var(--muted);font-size:12px' }, '· ' + c.count + ' order' + (c.count > 1 ? 's' : ''))]),
          el('div', { class: 'val' }, fmtMoney(c.total))
        ]);
        ml.appendChild(row);
      });
      customerCard.appendChild(ml);
    }
    twoCols.appendChild(customerCard);

    var prodAgg = aggregateProducts(orders);
    var prodCard = el('div', { class: 'card' }, [
      el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px' }, 'Highest-profit products')
    ]);
    if (prodAgg.byProfit.length === 0) prodCard.appendChild(el('div', { class: 'empty', style: 'padding:14px' }, 'No data'));
    else {
      var ml2 = el('div', { class: 'mini-list' });
      prodAgg.byProfit.slice(0, 7).forEach(function (p) {
        var pct = p.revenue > 0 ? Math.round(p.profit / p.revenue * 100) : 0;
        ml2.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'name' }, [p.name + ' ', el('span', { style: 'color:var(--muted);font-size:12px' }, '· ' + pct + '% margin')]),
          el('div', { class: 'val' }, fmtMoney(p.profit))
        ]));
      });
      prodCard.appendChild(ml2);
    }
    twoCols.appendChild(prodCard);
    root.appendChild(twoCols);

    var bestSold = el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px' }, 'Best-selling products (units)')
    ]);
    if (prodAgg.byQty.length === 0) bestSold.appendChild(el('div', { class: 'empty', style: 'padding:14px' }, 'No data'));
    else {
      var ml3 = el('div', { class: 'mini-list' });
      prodAgg.byQty.slice(0, 7).forEach(function (p) {
        ml3.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'name' }, p.name),
          el('div', { class: 'val' }, p.qty + ' units')
        ]));
      });
      bestSold.appendChild(ml3);
    }
    root.appendChild(bestSold);

    // ----- External funding (manual entries). Expenses have their own page now. -----
    root.appendChild(el('div', { class: 'section-row', style: 'margin-top:18px;margin-bottom:10px' }, [
      el('h3', { class: 'section-title', style: 'margin:0' }, 'External funding'),
      el('a', { href: '#/expenses', style: 'font-size:13px;color:var(--muted);text-decoration:none' }, 'Manage expenses →')
    ]));
    var ledgerGrid = el('div', { class: 'cards grid-2' }, [
      buildLedgerCard('funding',  'External funding', state.cache.funding, fundingTotal, 'var(--good)')
    ]);
    root.appendChild(ledgerGrid);
  }

  function buildLedgerCard(store, title, entries, total, accent) {
    var isExpense = store === 'expenses';
    var cats = (isExpense ? state.settings.expenseCategories : state.settings.fundingSources) || ['Other'];
    var todayStr = state.calMode === 'jalali' ? J.formatJalali(new Date()) : J.formatGregorian(new Date());

    var dateInput = el('input', { type: 'text', value: todayStr, placeholder: 'YYYY/MM/DD', autocomplete: 'off' });
    var catSelect = el('select', {}, cats.map(function (c) { return el('option', { value: c }, c); }));
    var nameInput = el('input', { type: 'text', placeholder: isExpense ? 'Payee / description' : 'Source / note', autocomplete: 'off' });
    var amtInput  = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', placeholder: '0', min: '0', step: '1' });

    function submit() {
      var name = nameInput.value.trim();
      var amount = num(amtInput.value);
      if (!name)         { toast('Enter a description', 'error'); nameInput.focus(); return; }
      if (!(amount > 0)) { toast('Enter an amount', 'error');     amtInput.focus();  return; }
      var parsed = state.calMode === 'jalali' ? J.parseJalali(dateInput.value.trim()) : J.parseGregorian(dateInput.value.trim());
      if (!parsed)       { toast('Date is invalid', 'error');     dateInput.focus(); return; }
      var rec = { name: name, amount: amount, category: catSelect.value, date: J.isoFromDate(parsed), createdAt: new Date().toISOString() };
      DB.add(store, rec).then(function () {
        toast((isExpense ? 'Expense' : 'Funding') + ' added', 'ok');
        render();
      }).catch(function (err) { toast('Save failed: ' + err.message, 'error'); });
    }
    [nameInput, amtInput].forEach(function (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    });
    var addBtn = el('button', { class: 'btn primary block', on: { click: submit } }, '+ Add');

    var card = el('div', { class: 'card' });

    // ---- Header: title + running total ----
    card.appendChild(el('div', { class: 'section-row', style: 'margin-bottom:14px' }, [
      el('div', {}, [
        el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em' }, title),
        el('div', { style: 'font-size:22px;font-weight:700;margin-top:4px;font-variant-numeric:tabular-nums;color:' + accent }, fmtMoney(total))
      ])
    ]));

    // ---- Inline add form (date + category + description + amount) ----
    var form = el('div', {
      style: 'padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:10px;margin-bottom:14px'
    }, [
      el('div', { class: 'grid two' }, [
        el('label', { class: 'field' }, [el('span', {}, 'Date'), dateInput]),
        el('label', { class: 'field' }, [el('span', {}, isExpense ? 'Category' : 'Source'), catSelect])
      ]),
      el('div', { class: 'grid two', style: 'margin-top:10px' }, [
        el('label', { class: 'field' }, [el('span', {}, isExpense ? 'Payee / description' : 'Description'), nameInput]),
        el('label', { class: 'field' }, [el('span', {}, 'Amount'), amtInput])
      ]),
      el('div', { style: 'margin-top:10px' }, addBtn)
    ]);
    card.appendChild(form);

    // ---- Entries list ----
    if (!entries || entries.length === 0) {
      card.appendChild(el('div', {
        style: 'padding:18px;text-align:center;color:var(--muted);font-size:13px;background:var(--bg);border:1px dashed var(--line);border-radius:10px'
      }, 'No entries yet'));
      return card;
    }

    var list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    entries.forEach(function (e) {
      var iso = e.date || (e.createdAt ? String(e.createdAt).slice(0, 10) : '');
      var dt = J.dateFromIso(iso);
      var whenLbl = dt ? (state.calMode === 'jalali' ? J.formatJalali(dt) : J.formatGregorian(dt)) : '';
      var sub = [e.category, whenLbl].filter(Boolean).join('  ·  ');
      var delBtn = el('button', {
        class: 'icon-btn',
        title: 'Delete',
        'aria-label': 'Delete',
        on: { click: function () { archiveRecord(store, e, 'Entry'); } }
      }, '✕');
      var row = el('div', {
        style: 'display:flex;align-items:center;gap:12px;padding:10px 12px;' +
               'background:var(--bg);border:1px solid var(--line);border-radius:10px'
      }, [
        el('div', { style: 'width:6px;align-self:stretch;border-radius:3px;background:' + accent }),
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', { style: 'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, e.name || '(unnamed)'),
          sub ? el('div', { style: 'color:var(--muted);font-size:11px;margin-top:2px' }, sub) : null
        ]),
        el('div', { style: 'font-weight:700;font-variant-numeric:tabular-nums;color:' + accent }, fmtMoney(e.amount)),
        delBtn
      ]);
      list.appendChild(row);
    });
    card.appendChild(list);
    return card;
  }

  // ====== Expenses page ======
  var EXPENSE_PERIOD_LABELS = { day: 'today', week: 'last 7 days', month: 'last 30 days', year: 'last 365 days', all: 'all time' };

  function renderExpenses(root) {
    // ---- Period tabs in the top bar ----
    var tabs = el('div', { class: 'chart-tabs' });
    ['day', 'week', 'month', 'year', 'all'].forEach(function (p) {
      tabs.appendChild(el('button', {
        class: state.expensePeriod === p ? 'active' : '',
        on: { click: function () { state.expensePeriod = p; render(); } }
      }, p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)));
    });
    $('#topbarActions').appendChild(tabs);
    $('#topbarActions').appendChild(el('button', { class: 'btn primary', on: { click: function () { openExpenseForm(null); } } }, '+ Add expense'));

    var period = state.expensePeriod;
    var periodExpenses = filterOrdersByPeriod(state.cache.expenses, period);
    var periodOrders   = filterOrdersByPeriod(state.cache.orders, period);
    var expTotal   = periodExpenses.reduce(function (s, x) { return s + (num(x.amount) || 0); }, 0);
    var grossProfit = periodOrders.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var net = grossProfit - expTotal;

    // ---- Category breakdown ----
    var byCat = {};
    periodExpenses.forEach(function (x) {
      var cat = x.category || 'Uncategorized';
      byCat[cat] = (byCat[cat] || 0) + (num(x.amount) || 0);
    });
    var catRows = Object.keys(byCat).map(function (k) { return { name: k, total: byCat[k] }; })
      .sort(function (a, b) { return b.total - a.total; });
    var topCat = catRows.length ? catRows[0].name : '—';

    // ---- Summary cards ----
    root.appendChild(el('div', { class: 'cards grid-4', style: 'margin-bottom:18px' }, [
      statCard('Expenses', fmtMoney(expTotal), EXPENSE_PERIOD_LABELS[period], 'accent'),
      statCard('Order profit', fmtMoney(grossProfit), 'before expenses'),
      statCard('Net profit', fmtMoney(net), net < 0 ? 'operating at a loss' : 'after expenses', net < 0 ? 'bad' : 'good'),
      statCard('Entries', String(periodExpenses.length), catRows.length ? 'top: ' + topCat : 'no expenses yet')
    ]));

    // ---- Category breakdown ----
    root.appendChild(el('h3', { class: 'section-title' }, 'By category (' + EXPENSE_PERIOD_LABELS[period] + ')'));
    var breakdown = el('div', { class: 'card', style: 'margin-bottom:18px' });
    if (catRows.length === 0) {
      breakdown.appendChild(el('div', { class: 'empty', style: 'padding:14px' }, 'No expenses in this period.'));
    } else {
      catRows.forEach(function (c, i) {
        var pct = expTotal > 0 ? Math.round(c.total / expTotal * 100) : 0;
        breakdown.appendChild(el('div', { style: 'padding:10px 0;' + (i > 0 ? 'border-top:1px solid var(--line)' : '') }, [
          el('div', { style: 'display:flex;justify-content:space-between;margin-bottom:6px' }, [
            el('span', { style: 'font-weight:600' }, c.name),
            el('span', { style: 'font-variant-numeric:tabular-nums' }, fmtMoney(c.total) + '  ·  ' + pct + '%')
          ]),
          el('div', { style: 'height:8px;background:var(--bg);border-radius:4px;overflow:hidden' }, [
            el('div', { style: 'height:100%;width:' + pct + '%;background:var(--accent);border-radius:4px' })
          ])
        ]));
      });
    }
    root.appendChild(breakdown);

    // ---- Entries list ----
    root.appendChild(el('h3', { class: 'section-title' }, 'Entries'));
    if (periodExpenses.length === 0) {
      root.appendChild(el('div', { class: 'card empty' }, 'No expenses recorded for ' + EXPENSE_PERIOD_LABELS[period] + '. Click "+ Add expense" to record one.'));
      return;
    }
    var t = el('table', { class: 'table' });
    t.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Date'),
      el('th', {}, 'Category'),
      el('th', {}, 'Payee / description'),
      el('th', { class: 'num' }, 'Amount'),
      el('th', { class: 'actions' }, '')
    ])));
    var tb = el('tbody', {});
    periodExpenses.forEach(function (x) {
      var dt = J.dateFromIso(x.date || '');
      var whenLbl = dt ? fmtDateForList(x.date) : '—';
      var editBtn = el('button', { class: 'btn ghost sm', on: { click: function () { openExpenseForm(x); } } }, 'Edit');
      var delBtn = el('button', { class: 'btn ghost sm', on: { click: function () {
        archiveRecord('expenses', x, 'Expense');
      } } }, 'Delete');
      tb.appendChild(el('tr', {}, [
        el('td', {}, whenLbl),
        el('td', {}, x.category || '—'),
        el('td', {}, x.name || '—'),
        el('td', { class: 'num', style: 'color:var(--bad)' }, fmtMoney(x.amount)),
        el('td', { class: 'actions' }, [editBtn, delBtn])
      ]));
    });
    t.appendChild(tb);
    root.appendChild(t);
  }

  function openExpenseForm(xOrNull) {
    var x = xOrNull || {};
    $('#expenseModalTitle').textContent = xOrNull ? 'Edit Expense' : 'Add Expense';
    var cats = (state.settings.expenseCategories && state.settings.expenseCategories.length)
      ? state.settings.expenseCategories : ['Other'];
    var sel = $('#x_category');
    sel.innerHTML = '';
    cats.forEach(function (c) { sel.appendChild(el('option', { value: c }, c)); });

    var dt = x.date ? J.dateFromIso(x.date) : new Date();
    $('#x_date').value = state.calMode === 'jalali' ? J.formatJalali(dt) : J.formatGregorian(dt);
    sel.value = x.category || cats[0];
    $('#x_name').value = x.name || '';
    $('#x_amount').value = x.amount != null ? x.amount : '';
    state.editingExpenseId = xOrNull ? x.id : null;
    $$('#expenseModal input[data-num]').forEach(formatNumInput);
    openModal('expenseModal');
    setTimeout(function () { $('#x_name').focus(); }, 30);
  }

  function saveExpenseFromForm() {
    var name = $('#x_name').value.trim();
    var amount = num($('#x_amount').value);
    if (!name) { toast('Enter a description', 'error'); $('#x_name').focus(); return; }
    if (!(amount > 0)) { toast('Enter an amount', 'error'); $('#x_amount').focus(); return; }
    var raw = $('#x_date').value.trim();
    var parsed = state.calMode === 'jalali' ? J.parseJalali(raw) : J.parseGregorian(raw);
    if (!parsed) { toast('Date is invalid', 'error'); $('#x_date').focus(); return; }

    var id = state.editingExpenseId;
    var existing = id != null ? state.cache.expenses.filter(function (e) { return e.id === id; })[0] : null;
    var rec = existing ? existing : { createdAt: new Date().toISOString() };
    rec.name = name;
    rec.amount = amount;
    rec.category = $('#x_category').value;
    rec.date = J.isoFromDate(parsed);

    DB.put('expenses', rec).then(function () {
      closeModal('expenseModal');
      toast(existing ? 'Expense updated' : 'Expense added', 'ok');
      render();
    }).catch(function () { toast('Could not save expense', 'error'); });
  }

  function drawProfitChart(canvas, orders, granularity) {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width  = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    var ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    // Theme-aware colors (read live so the chart matches light/dark)
    var cs = getComputedStyle(document.documentElement);
    var cssVar = function (name, fallback) { return (cs.getPropertyValue(name) || '').trim() || fallback; };
    var barColor    = cssVar('--chart-bar', '#1f1f1f');
    var accentColor = cssVar('--color-accent', '#1f1f1f');
    var gridColor   = cssVar('--color-border', '#e6e6e6');
    var labelColor  = cssVar('--color-text-muted', '#757575');

    // Build buckets: last 12 periods up to now (Sunday-based weeks, or calendar months)
    var now = new Date();
    var labels = [], totals = [];
    if (granularity === 'week') {
      var start = J.startOfWeek(now);
      for (var i = 11; i >= 0; i--) {
        var s = J.addDays(start, -7 * i);
        var e = J.addDays(s, 7);
        labels.push((s.getMonth() + 1) + '/' + s.getDate());
        var sum = 0;
        orders.forEach(function (o) {
          var d = J.dateFromIso(o.date);
          if (d && d >= s && d < e) sum += orderProfit(o);
        });
        totals.push(sum);
      }
    } else {
      var startM = periodMonthStart(now);
      for (var j = 11; j >= 0; j--) {
        var sm = periodMonthAdd(startM, -j);
        var em = periodMonthAdd(sm, 1);
        labels.push(periodMonthLabel(sm));
        var sumM = 0;
        orders.forEach(function (o) {
          var d = J.dateFromIso(o.date);
          if (d && d >= sm && d < em) sumM += orderProfit(o);
        });
        totals.push(sumM);
      }
    }

    var pad = { l: 56, r: 12, t: 14, b: 28 };
    var cw = W - pad.l - pad.r;
    var ch = H - pad.t - pad.b;
    var max = Math.max.apply(null, totals.concat([1]));
    if (max <= 0) max = 1;
    // Round max up to a nice number
    var pow = Math.pow(10, Math.floor(Math.log10(max)));
    max = Math.ceil(max / pow) * pow;

    // grid + y labels
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = labelColor;
    ctx.font = "11px 'Inter', system-ui, sans-serif";
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    var rows = 4;
    for (var r = 0; r <= rows; r++) {
      var y = pad.t + ch * (r / rows);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
      var v = max * (1 - r / rows);
      ctx.fillText(shortMoney(v), pad.l - 8, y);
    }

    // bars — ink by default, single tallest bar highlighted in accent
    var n = totals.length;
    var barW = cw / n * 0.66;
    var step = cw / n;
    var maxIdx = -1, maxVal = 0;
    for (var m = 0; m < n; m++) { if (totals[m] > maxVal) { maxVal = totals[m]; maxIdx = m; } }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var k = 0; k < n; k++) {
      var v2 = totals[k];
      var bh = (v2 / max) * ch;
      var bx = pad.l + step * k + (step - barW) / 2;
      var by = pad.t + ch - bh;
      ctx.fillStyle = (k === maxIdx && maxVal > 0) ? accentColor : barColor;
      roundRect(ctx, bx, by, barW, Math.max(bh, 1), 4);
      ctx.fill();
      ctx.fillStyle = labelColor;
      ctx.fillText(labels[k], pad.l + step * k + step / 2, pad.t + ch + 6);
    }
  }
  function shortMoney(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return Math.round(n).toString();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Two-line trend chart: Revenue (dashed grey) + Profit (solid ink) over 12 periods.
  function drawTrendChart(canvas, orders, granularity) {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    var ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    var cs = getComputedStyle(document.documentElement);
    var cssVar = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
    var inkColor = cssVar('--chart-bar', '#1f1f1f');
    var revColor = cssVar('--color-text-muted', '#757575');
    var gridColor = cssVar('--color-border', '#e6e6e6');
    var labelColor = cssVar('--color-text-muted', '#757575');

    var now = new Date();
    var labels = [], rev = [], prof = [];
    function bucket(s, e) {
      var r = 0, p = 0;
      orders.forEach(function (o) {
        var d = J.dateFromIso(o.date);
        if (d && d >= s && d < e) { r += orderTotal(o); p += orderProfit(o); }
      });
      rev.push(r); prof.push(p);
    }
    if (granularity === 'week') {
      var start = J.startOfWeek(now);
      for (var i = 11; i >= 0; i--) {
        var s = J.addDays(start, -7 * i), e = J.addDays(s, 7);
        labels.push((s.getMonth() + 1) + '/' + s.getDate());
        bucket(s, e);
      }
    } else {
      var startM = periodMonthStart(now);
      for (var jm = 11; jm >= 0; jm--) {
        var sm = periodMonthAdd(startM, -jm), em = periodMonthAdd(sm, 1);
        labels.push(periodMonthLabel(sm));
        bucket(sm, em);
      }
    }

    var pad = { l: 56, r: 12, t: 14, b: 28 };
    var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var maxV = Math.max.apply(null, rev.concat(prof).concat([1]));
    var minV = Math.min.apply(null, prof.concat([0]));
    var powv = Math.pow(10, Math.floor(Math.log10(Math.max(1, maxV))));
    maxV = Math.ceil(maxV / powv) * powv;
    if (minV < 0) { var pm = Math.pow(10, Math.floor(Math.log10(Math.max(1, -minV)))); minV = -Math.ceil(-minV / pm) * pm; }
    if (maxV === minV) maxV = minV + 1;
    var n = rev.length;
    function X(i) { return pad.l + (n <= 1 ? cw / 2 : cw * (i / (n - 1))); }
    function Y(v) { return pad.t + ch * (1 - (v - minV) / (maxV - minV)); }

    ctx.strokeStyle = gridColor; ctx.fillStyle = labelColor;
    ctx.font = "11px 'Inter', system-ui, sans-serif";
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var r2 = 0; r2 <= 4; r2++) {
      var yy = pad.t + ch * (r2 / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(pad.l + cw, yy); ctx.stroke();
      ctx.fillText(shortMoney(maxV - (maxV - minV) * (r2 / 4)), pad.l - 8, yy);
    }
    if (minV < 0) {
      ctx.save(); ctx.globalAlpha = .5; ctx.strokeStyle = labelColor;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(pad.l + cw, Y(0)); ctx.stroke(); ctx.restore();
    }

    function drawLine(vals, color, dashed) {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      vals.forEach(function (v, i) { var px = X(i), py = Y(v); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawLine(rev, revColor, true);
    drawLine(prof, inkColor, false);
    ctx.fillStyle = inkColor;
    prof.forEach(function (v, i) { ctx.beginPath(); ctx.arc(X(i), Y(v), 2.5, 0, Math.PI * 2); ctx.fill(); });

    ctx.fillStyle = labelColor; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    labels.forEach(function (lb, i) { if (n > 8 && i % 2 !== 0) return; ctx.fillText(lb, X(i), pad.t + ch + 6); });
  }

  // Monochrome donut chart with a hollow center label.
  function drawDonut(canvas, segments, centerTop, centerBottom) {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * ratio);
    canvas.height = Math.floor(rect.height * ratio);
    var ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    var W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    var cs = getComputedStyle(document.documentElement);
    var cssVar = function (n, f) { return (cs.getPropertyValue(n) || '').trim() || f; };
    function resolve(c) { var m = /^var\((--[\w-]+)\)$/.exec(c || ''); return m ? cssVar(m[1], '#888') : (c || '#888'); }
    var borderC = cssVar('--color-border', '#e6e6e6');
    var textColor = cssVar('--color-text', '#1f1f1f');
    var labelColor = cssVar('--color-text-muted', '#757575');

    var cx = W / 2, cy = H / 2;
    var R = Math.min(W, H) / 2 - 4;
    var thickness = Math.max(14, R * 0.4);
    var rMid = R - thickness / 2;
    var total = segments.reduce(function (s, x) { return s + Math.max(0, x.value); }, 0);

    ctx.lineWidth = thickness; ctx.lineCap = 'butt';
    if (total <= 0) {
      ctx.strokeStyle = borderC;
      ctx.beginPath(); ctx.arc(cx, cy, rMid, 0, Math.PI * 2); ctx.stroke();
    } else {
      var startA = -Math.PI / 2, gap = 0.03;
      segments.forEach(function (seg) {
        var val = Math.max(0, seg.value); if (val <= 0) return;
        var ang = val / total * (Math.PI * 2);
        ctx.strokeStyle = resolve(seg.color);
        ctx.beginPath(); ctx.arc(cx, cy, rMid, startA + gap / 2, startA + ang - gap / 2); ctx.stroke();
        startA += ang;
      });
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (centerTop) { ctx.fillStyle = textColor; ctx.font = "600 18px 'Inter', system-ui, sans-serif"; ctx.fillText(centerTop, cx, cy - 7); }
    if (centerBottom) { ctx.fillStyle = labelColor; ctx.font = "11px 'Inter', system-ui, sans-serif"; ctx.fillText(centerBottom, cx, cy + 12); }
  }

  // ====== Catalog page ======
  function formatExpireForInput(iso) {
    if (!iso) return '';
    var d = J.dateFromIso(iso);
    if (!d) return '';
    return state.calMode === 'jalali' ? J.formatJalali(d) : J.formatGregorian(d);
  }
  // Auto-detect calendar by leading digit of the year:
  //   year starts with "2" → Gregorian, anything else (including "1") → Jalali.
  function detectExpireCalendar(input) {
    var m = String(input || '').trim().match(/\d/);
    if (!m) return null;
    return m[0] === '2' ? 'gregorian' : 'jalali';
  }
  function parseExpireToIso(input) {
    input = String(input || '').trim();
    if (!input) return '';
    var cal = detectExpireCalendar(input);
    var d = cal === 'gregorian' ? J.parseGregorian(input) : J.parseJalali(input);
    return d ? J.isoFromDate(d) : null; // null means "not parseable"
  }
  function expireStatusColor(iso) {
    if (!iso) return '';
    var d = J.dateFromIso(iso);
    if (!d) return '';
    var today = new Date(); today.setHours(0,0,0,0);
    var diffDays = Math.round((d - today) / 86400000);
    if (diffDays < 0)  return 'var(--bad)';
    if (diffDays < 30) return 'var(--warn)';
    return '';
  }
  // Returns products sorted ascending by expireDate. Includes:
  //   - the soonest 5 (or fewer if not that many exist), AND
  //   - every product expiring in less than 100 days.
  function findExpiringProducts() {
    var withDate = (state.cache.products || []).filter(function (p) {
      return p.expireDate && J.dateFromIso(p.expireDate);
    });
    if (withDate.length === 0) return [];
    withDate.sort(function (a, b) {
      return J.dateFromIso(a.expireDate) - J.dateFromIso(b.expireDate);
    });
    var today = new Date(); today.setHours(0,0,0,0);
    var under100 = 0;
    for (var i = 0; i < withDate.length; i++) {
      var d = J.dateFromIso(withDate[i].expireDate);
      var days = Math.round((d - today) / 86400000);
      if (days < 100) under100++;
      else break; // sorted, so once we cross 100 days we're done
    }
    return withDate.slice(0, Math.max(5, under100));
  }
  function buildNextExpireSection(products) {
    var card = el('div', { class: 'card' }, [
      el('div', { style: 'color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px' }, 'Soonest expiry')
    ]);
    var today = new Date(); today.setHours(0,0,0,0);
    products.forEach(function (p, idx) {
      var d = J.dateFromIso(p.expireDate);
      var days = Math.round((d - today) / 86400000);
      var urgent = days < 100;
      var label;
      if (days < 0)        label = 'Expired ' + Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') + ' ago';
      else if (days === 0) label = 'Expires today';
      else                 label = 'Expires in ' + days + ' day' + (days === 1 ? '' : 's');
      var labelColor = days < 0 ? 'var(--bad)' : (days < 30 ? 'var(--warn)' : (urgent ? 'var(--text)' : 'var(--muted)'));
      var icon = urgent
        ? el('span', { style: 'color:var(--bad);font-size:16px;flex:0 0 auto;margin-right:10px', title: 'Expires within 100 days' }, '⚠')
        : el('span', { style: 'visibility:hidden;font-size:16px;flex:0 0 auto;margin-right:10px' }, '⚠');
      var row = el('div', {
        style: 'display:flex;align-items:center;padding:10px 0;' + (idx > 0 ? 'border-top:1px solid var(--color-border);' : '')
      }, [
        icon,
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', { style: 'font-weight:600;margin-bottom:2px' }, p.name),
          el('div', { style: 'color:var(--muted);font-size:12px' }, 'J: ' + J.formatJalali(d) + '  ·  G: ' + J.formatGregorian(d))
        ]),
        el('div', { style: 'color:' + labelColor + ';font-weight:500;font-size:13px;text-align:right;flex:0 0 auto;margin-left:12px' }, label)
      ]);
      card.appendChild(row);
    });
    return card;
  }

  // ====== Financial Reports ======
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function downloadCSV(filename, rows) {
    var csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
    toast('CSV downloaded', 'ok');
  }
  function todayLabel() {
    var d = new Date();
    return state.calMode === 'jalali' ? J.formatJalali(d) : J.formatGregorian(d);
  }

  // Render a statement from a list of { label, amount?, type? } lines.
  // type: 'section' | 'subtotal' | 'total' | undefined (plain line)
  function renderStatement(title, sub, lines, csvName) {
    var rowsEls = lines.map(function (ln) {
      if (ln.type === 'section') return el('div', { class: 'stmt-section' }, ln.label);
      var amtTxt = (ln.amount == null) ? '' : fmtMoney(ln.amount);
      return el('div', { class: 'stmt-row' + (ln.type ? ' ' + ln.type : '') }, [
        el('div', { class: 'stmt-label' }, ln.label),
        el('div', { class: 'stmt-amt' + (ln.amount < 0 ? ' neg' : '') }, amtTxt)
      ]);
    });
    var csvRows = [[title], [sub || '']].concat(lines.map(function (ln) {
      return [ln.label, ln.amount == null ? '' : Math.round(ln.amount)];
    }));
    var head = el('div', { class: 'section-row', style: 'align-items:flex-start;margin-bottom:8px' }, [
      el('div', {}, [
        el('h3', { class: 'stmt-title' }, title),
        sub ? el('div', { class: 'stmt-sub' }, sub) : null
      ]),
      el('button', { class: 'btn ghost sm noprint', on: { click: function () { downloadCSV(csvName, csvRows); } } }, '⤓ CSV')
    ]);
    return el('div', { class: 'card stmt' }, [head].concat(rowsEls));
  }

  function renderReports(root) {
    var actions = el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
      el('div', { class: 'chart-tabs' }, [
        el('button', { class: state.reportPeriod === 'month' ? 'active' : '', on: { click: function () { state.reportPeriod = 'month'; render(); } } }, 'This month'),
        el('button', { class: state.reportPeriod === 'year'  ? 'active' : '', on: { click: function () { state.reportPeriod = 'year';  render(); } } }, 'This year'),
        el('button', { class: state.reportPeriod === 'all'   ? 'active' : '', on: { click: function () { state.reportPeriod = 'all';   render(); } } }, 'All time')
      ]),
      el('button', { class: 'btn ghost sm', on: { click: function () { window.print(); } } }, '🖨 Print')
    ]);
    $('#topbarActions').appendChild(actions);

    var r = reportRange(state.reportPeriod);
    var c = state.settings.company;

    // Print-only company header
    root.appendChild(el('div', { class: 'print-header' }, [
      el('div', { class: 'ph-name' }, c.name || 'Rumi'),
      c.address ? el('div', { class: 'ph-line' }, c.address) : null,
      c.taxId ? el('div', { class: 'ph-line' }, 'Tax ID: ' + c.taxId) : null,
      el('div', { class: 'ph-line' }, 'Financial report · ' + r.label + ' · ' + todayLabel())
    ]));

    // ----- Profit & Loss (period) -----
    var ords = ordersInRange(state.cache.orders, r);
    var sales = sumRevenueGoods(ords);
    var shipping = sumShipping(ords);
    var discounts = ords.reduce(function (s, o) { return s + (num(o.discount) || 0); }, 0);
    // Shipping is collected for the courier and passed on — it is not income, exactly as
    // in order profit. Gift items are stock given away, so they belong in cost of goods.
    var revenue = sales - discounts;
    var cogs = sumCOGS(ords);
    var gifts = ords.reduce(function (s, o) { return s + giftsCost(o); }, 0);
    var gross = revenue - cogs - gifts;
    var byCat = {};
    entriesInRange(state.cache.expenses, r).forEach(function (e) {
      var cat = e.category || 'Uncategorized';
      byCat[cat] = (byCat[cat] || 0) + (num(e.amount) || 0);
    });
    var catNames = Object.keys(byCat).sort();
    var opex = catNames.reduce(function (s, k) { return s + byCat[k]; }, 0);
    var losses = ords.reduce(function (s, o) { return s + (num(o.loss) || 0); }, 0);
    var net = gross - opex - losses;

    var pnl = [
      { label: 'Revenue', type: 'section' },
      { label: 'Product sales', amount: sales },
      { label: 'Discounts', amount: -discounts },
      { label: 'Total revenue', amount: revenue, type: 'subtotal' },
      { label: 'Cost of goods sold', type: 'section' },
      { label: 'Cost of goods sold', amount: -cogs },
      { label: 'Gift items given away', amount: -gifts },
      { label: 'Gross profit', amount: gross, type: 'subtotal' },
      { label: 'Losses / write-offs', amount: -losses },
      { label: 'Order profit (same as Profits page)', amount: gross - losses, type: 'subtotal' },
      { label: 'Operating expenses', type: 'section' }
    ];
    if (catNames.length === 0) pnl.push({ label: 'No expenses recorded', amount: 0 });
    catNames.forEach(function (k) { pnl.push({ label: k, amount: -byCat[k] }); });
    pnl.push({ label: 'Total operating expenses', amount: -opex, type: 'subtotal' });
    pnl.push({ label: 'Net profit', amount: net, type: 'total' });
    pnl.push({ label: 'Memo (not profit)', type: 'section' });
    pnl.push({ label: 'Shipping collected for the courier', amount: shipping });
    root.appendChild(renderStatement('Profit & Loss', r.label, pnl, 'rumi-pnl.csv'));

    // ----- Balance Sheet (as of today) -----
    var all = state.cache.orders;
    var lifeDiscounts = all.reduce(function (s, o) { return s + (num(o.discount) || 0); }, 0);
    var lifeRevenue = sumRevenueGoods(all) - lifeDiscounts; // shipping is passed on, not earned
    var lifeCOGS = sumCOGS(all) + all.reduce(function (s, o) { return s + giftsCost(o); }, 0);
    var lifeOpex = state.cache.expenses.reduce(function (s, e) { return s + (num(e.amount) || 0); }, 0);
    var lifeLosses = all.reduce(function (s, o) { return s + (num(o.loss) || 0); }, 0);
    var retained = lifeRevenue - lifeCOGS - lifeOpex - lifeLosses;
    var ownerFunding = state.cache.funding.reduce(function (s, f) { return s + (num(f.amount) || 0); }, 0);
    var inventory = inventoryValue();
    var ar = 0, ap = 0, taxPayable = 0;
    var equity = ownerFunding + retained;
    var cash = equity - inventory + ar - ap - taxPayable;
    var totalAssets = cash + inventory + ar;
    var totalLiab = ap + taxPayable;

    var bs = [
      { label: 'Assets', type: 'section' },
      { label: 'Cash (inferred)', amount: cash },
      { label: 'Inventory at cost', amount: inventory },
      { label: 'Accounts receivable', amount: ar },
      { label: 'Total assets', amount: totalAssets, type: 'subtotal' },
      { label: 'Liabilities', type: 'section' },
      { label: 'Accounts payable', amount: ap },
      { label: 'Tax payable', amount: taxPayable },
      { label: 'Total liabilities', amount: totalLiab, type: 'subtotal' },
      { label: 'Equity', type: 'section' },
      { label: 'Owner funding', amount: ownerFunding },
      { label: 'Retained earnings', amount: retained },
      { label: 'Total equity', amount: equity, type: 'subtotal' },
      { label: 'Liabilities + equity', amount: totalLiab + equity, type: 'total' }
    ];
    var bsCard = renderStatement('Balance Sheet', 'As of ' + todayLabel(), bs, 'rumi-balance-sheet.csv');
    bsCard.appendChild(el('div', { class: 'stmt-note' },
      'Cash is inferred (sales assumed received in cash; inventory assumed purchased in cash). ' +
      'Receivables, payables, and tax appear here once the Payments, Purchases, and Tax modules are added.'));
    root.appendChild(bsCard);

    // ----- Cash Flow (period) -----
    var cashFromSales = ords.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var cashOpex = entriesInRange(state.cache.expenses, r).reduce(function (s, e) { return s + (num(e.amount) || 0); }, 0);
    var netOps = cashFromSales - shipping - cashOpex - losses;
    var financing = entriesInRange(state.cache.funding, r).reduce(function (s, f) { return s + (num(f.amount) || 0); }, 0);
    var netChange = netOps + financing;

    var cf = [
      { label: 'Operating activities', type: 'section' },
      { label: 'Cash from customers', amount: cashFromSales },
      { label: 'Shipping passed to the courier', amount: -shipping },
      { label: 'Operating expenses paid', amount: -cashOpex },
      { label: 'Losses (defects / refunds)', amount: -losses },
      { label: 'Net cash from operations', amount: netOps, type: 'subtotal' },
      { label: 'Financing activities', type: 'section' },
      { label: 'Owner / external funding', amount: financing },
      { label: 'Net cash from financing', amount: financing, type: 'subtotal' },
      { label: 'Net change in cash', amount: netChange, type: 'total' }
    ];
    var cfCard = renderStatement('Cash Flow', r.label, cf, 'rumi-cash-flow.csv');
    cfCard.appendChild(el('div', { class: 'stmt-note' },
      'Inventory purchases are not yet tracked as cash outflows — they will appear here once the Purchases module is added.'));
    root.appendChild(cfCard);
  }

  function markupStr(cost, sell) {
    cost = num(cost); sell = num(sell);
    if (!(cost > 0)) return '—';
    return Math.round((sell - cost) / cost * 100) + '%';
  }
  function stockUnits(p) { return Math.max(0, num(p.stock) || 0); }
  function stockValue(p) { return stockUnits(p) * (num(p.defaultCost) || 0); }
  function lowStockLevel() { return num(state.settings.inventory.lowStockLevel) || 0; }

  // Shared inline editor used by both the list (table row) and the card view.
  function makeProductEditor(p, isNew) {
    p = p || { name: '', defaultCost: 0, defaultSell: 0, stock: 0, expireDate: '' };
    var low = lowStockLevel();
    function stockColorFor(v) { v = num(v) || 0; return v <= 0 ? 'var(--bad)' : (low > 0 && v < low ? 'var(--warn)' : 'var(--text)'); }

    var nameInput  = el('input', { type: 'text', value: p.name, placeholder: 'Product name', title: p.name || '', dir: 'auto', class: 'cat-input cat-name-input', autocomplete: 'off' });
    nameInput.addEventListener('input', function () { nameInput.title = nameInput.value; });
    var stockInput = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', value: num(p.stock) || 0, min: '0', step: '1', class: 'cat-input cat-num', style: 'color:' + stockColorFor(p.stock) });
    var costInput  = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', value: p.defaultCost, min: '0', step: '1', class: 'cat-input cat-num' });
    var sellInput  = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', value: p.defaultSell, min: '0', step: '1', class: 'cat-input cat-num' });
    var expireInput = el('input', { type: 'text', value: formatExpireForInput(p.expireDate), placeholder: 'YYYY/MM/DD', class: 'cat-input', style: 'color:' + (expireStatusColor(p.expireDate) || 'var(--text)') });
    var expireAlt = el('div', { style: 'font-size:11px;color:var(--muted);margin-top:2px' });

    stockInput.addEventListener('input', function () { stockInput.style.color = stockColorFor(stockInput.value); });
    function refreshExpireAlt() {
      var iso = parseExpireToIso(expireInput.value);
      var d = iso ? J.dateFromIso(iso) : null;
      if (!d) { expireAlt.textContent = ''; return; }
      expireInput.style.color = expireStatusColor(iso) || 'var(--text)';
      var typed = detectExpireCalendar(expireInput.value);
      var alt = typed === 'gregorian' ? 'J: ' + J.formatJalali(d) : 'G: ' + J.formatGregorian(d);
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var days = Math.round((d - today) / 86400000);
      var remaining;
      if (days < 0)        remaining = 'Expired ' + Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') + ' ago';
      else if (days === 0) remaining = 'Expires today';
      else                 remaining = days + ' day' + (days === 1 ? '' : 's') + ' left';
      expireAlt.textContent = alt + '  ·  ' + remaining;
    }
    expireInput.addEventListener('input', refreshExpireAlt);
    refreshExpireAlt();

    // Live outputs (markup + stock value) registered by each layout.
    var outs = [];
    function refreshOuts() {
      var m = markupStr(costInput.value, sellInput.value);
      var v = fmtMoney(stockUnits({ stock: stockInput.value }) * (num(costInput.value) || 0));
      outs.forEach(function (o) { o.markup.textContent = m; o.value.textContent = v; });
    }
    [costInput, sellInput, stockInput].forEach(function (i) { i.addEventListener('input', refreshOuts); });

    function commit() {
      var name = nameInput.value.trim();
      if (!name) { toast('Product name is required', 'error'); nameInput.focus(); return; }
      var expIso = parseExpireToIso(expireInput.value);
      if (expIso === null) { toast('Expire date is invalid', 'error'); expireInput.focus(); return; }
      var target = num(stockInput.value) || 0;
      var data = {
        name: name, nameLower: name.toLowerCase(),
        defaultCost: num(costInput.value) || 0,
        defaultSell: num(sellInput.value) || 0,
        expireDate: expIso
      };
      // Stock is saved as a change (+/−) rather than an absolute number, so a sale made
      // on another device at the same time is never overwritten.
      var before = isNew ? 0 : (num(p.stock) || 0);
      var save = isNew ? DB.add('products', data) : (function () { for (var k in data) p[k] = data[k]; return DB.put('products', p); })();
      save.then(function (id) {
        return DB.adjustStock(id, target - before, isNew ? 'Opening stock' : 'Stock count');
      }).then(function (r) {
        if (!isNew) delete state.catalogOpen[p.id]; // done with this one — fold it up
        toast(isNew ? 'Product added' : 'Product saved', 'ok');
        renderInPlace();
      })
        .catch(function (err) { toast('Could not save product: ' + err.message, 'error'); });
    }
    function remove(container) {
      if (isNew) { if (container) container.remove(); return; }
      archiveRecord('products', p, 'Product "' + p.name + '"');
    }
    return {
      p: p, isNew: isNew,
      nameInput: nameInput, stockInput: stockInput, costInput: costInput, sellInput: sellInput,
      expireInput: expireInput, expireAlt: expireAlt,
      registerOut: function (o) { outs.push(o); },
      commit: commit, remove: remove,
      focus: function () { nameInput.focus(); }
    };
  }

  // Profit margin as a share of the sell price.
  function marginStr(cost, sell) {
    cost = num(cost); sell = num(sell);
    if (!(sell > 0)) return '—';
    return Math.round((sell - cost) / sell * 100) + '%';
  }

  // Compact, clickable summary shown for every catalog product: name, sell price,
  // margin and stock. Everything else lives in the body, revealed on click.
  // Existing products start collapsed; a new product starts expanded.
  function collapsibleProduct(ed, cls, body) {
    var low = lowStockLevel();
    var nameEl   = el('span', { class: 'ps-name', dir: 'auto' });
    var sellEl   = el('strong', {});
    var marginEl = el('strong', {});
    var stockEl  = el('strong', {});
    function stat(label, node) { return el('div', { class: 'ps-stat' }, [el('span', { class: 'pc-label' }, label), node]); }
    function refresh() {
      nameEl.textContent = ed.nameInput.value.trim() || (ed.isNew ? 'New product' : '(unnamed)');
      sellEl.textContent = fmtMoney(num(ed.sellInput.value) || 0);
      var m = marginStr(ed.costInput.value, ed.sellInput.value);
      marginEl.textContent = m;
      marginEl.style.color = parseInt(m, 10) < 0 ? 'var(--bad)' : '';
      var s = num(ed.stockInput.value) || 0;
      stockEl.textContent = String(s);
      stockEl.style.color = s <= 0 ? 'var(--bad)' : (low > 0 && s < low ? 'var(--warn)' : '');
    }
    [ed.nameInput, ed.sellInput, ed.costInput, ed.stockInput].forEach(function (i) { i.addEventListener('input', refresh); });
    refresh();

    var chevron = el('span', { class: 'ps-chevron', 'aria-hidden': 'true' }, '▾');
    var summary = el('div', { class: 'ps-summary', role: 'button', tabindex: '0', title: 'Show details' }, [
      nameEl,
      el('div', { class: 'ps-stats' }, [stat('Price', sellEl), stat('Margin', marginEl), stat('Stock', stockEl)]),
      chevron
    ]);
    var bodyEl = el('div', { class: 'ps-body' }, body);
    var card = el('div', { class: 'card product-item ' + cls }, [summary, bodyEl]);
    function setOpen(open) {
      card.classList.toggle('open', open);
      summary.setAttribute('aria-expanded', open ? 'true' : 'false');
      summary.title = open ? 'Hide details' : 'Show details';
    }
    function toggle() { setOpen(!card.classList.contains('open')); }
    summary.addEventListener('click', toggle);
    summary.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    var pid = ed.p && ed.p.id;
    var setOpenRaw = setOpen;
    setOpen = function (open) { setOpenRaw(open); if (pid != null && !ed.isNew) { if (open) state.catalogOpen[pid] = true; else delete state.catalogOpen[pid]; } };
    setOpen(!!ed.isNew || (pid != null && !!state.catalogOpen[pid]));
    return card;
  }

  // A catalog list entry as a full-width row: compact summary, and on click
  // the full product name and number, a labeled field grid, actions bottom-right.
  function productRow(ed, stat) {
    var markupEl = el('strong', {}, markupStr(ed.costInput.value, ed.sellInput.value));
    var valueEl  = el('strong', {}, fmtMoney(stockUnits({ stock: ed.stockInput.value }) * (num(ed.costInput.value) || 0)));
    ed.registerOut({ markup: markupEl, value: valueEl });
    function field(label, node, cls) { return el('div', { class: 'pr-field' + (cls ? ' ' + cls : '') }, [el('span', { class: 'pc-label' }, label), node]); }

    var card;
    var saveBtn = el('button', { class: 'btn primary sm', on: { click: ed.commit } }, ed.isNew ? 'Add' : 'Save');
    var delBtn  = el('button', { class: 'btn ghost sm', on: { click: function () { ed.remove(card); } } }, ed.isNew ? 'Cancel' : 'Delete');

    var pnum = el('span', { class: 'cat-pnum' }, ed.isNew ? 'NEW' : '');
    card = collapsibleProduct(ed, 'product-row', [
      el('div', { class: 'pr-head' }, [ed.nameInput, pnum]),
      salesStrip(stat),
      el('div', { class: 'pr-grid' }, [
        field('Stock', ed.stockInput),
        field('Cost / unit', ed.costInput),
        field('Sell / unit', ed.sellInput),
        field('Markup', markupEl),
        field('Stock value', valueEl),
        field('Expires', el('div', {}, [ed.expireInput, ed.expireAlt]), 'pr-exp')
      ]),
      el('div', { class: 'pr-foot' }, [saveBtn, delBtn])
    ]);
    return card;
  }

  // Read-only "sold to date" + "earned to date" strip shown on product cards.
  function salesStrip(stat) {
    stat = stat || { qty: 0, profit: 0 };
    return el('div', { class: 'sales-strip' }, [
      el('div', { class: 'ss-item' }, [
        el('span', { class: 'ss-label' }, 'Sold'),
        el('span', { class: 'ss-val' }, stat.qty + ' unit' + (stat.qty === 1 ? '' : 's'))
      ]),
      el('div', { class: 'ss-item' }, [
        el('span', { class: 'ss-label' }, 'Earned'),
        el('span', { class: 'ss-val good' }, fmtMoney(stat.profit))
      ])
    ]);
  }

  function productCard(ed, stat) {
    var markupEl = el('strong', {}, markupStr(ed.costInput.value, ed.sellInput.value));
    var valueEl  = el('strong', {}, fmtMoney(stockUnits({ stock: ed.stockInput.value }) * (num(ed.costInput.value) || 0)));
    ed.registerOut({ markup: markupEl, value: valueEl });
    function field(label, node) { return el('div', { class: 'pc-field' }, [el('span', { class: 'pc-label' }, label), node]); }
    var card;
    var saveBtn = el('button', { class: 'btn primary sm', on: { click: ed.commit } }, ed.isNew ? 'Add' : 'Save');
    var delBtn  = el('button', { class: 'btn ghost sm', on: { click: function () { ed.remove(card); } } }, ed.isNew ? 'Cancel' : 'Delete');
    card = collapsibleProduct(ed, 'product-card', [
      el('div', { class: 'pc-head' }, ed.nameInput),
      salesStrip(stat),
      el('div', { class: 'pc-grid' }, [
        field('Stock', ed.stockInput),
        field('Cost / unit', ed.costInput),
        field('Sell / unit', ed.sellInput),
        field('Markup', markupEl),
        field('Stock value', valueEl)
      ]),
      field('Expires', el('div', {}, [ed.expireInput, ed.expireAlt])),
      el('div', { class: 'pc-foot' }, [saveBtn, delBtn])
    ]);
    return card;
  }

  function sortProducts(list, mode, sales) {
    var arr = list.slice();
    if (mode === 'stockAsc')       arr.sort(function (a, b) { return (num(a.stock) || 0) - (num(b.stock) || 0); });
    else if (mode === 'stockDesc') arr.sort(function (a, b) { return (num(b.stock) || 0) - (num(a.stock) || 0); });
    else if (mode === 'recent')    arr.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    else if (mode === 'expiry')    arr.sort(function (a, b) { return String(a.expireDate || '9999-99-99').localeCompare(String(b.expireDate || '9999-99-99')); });
    else if (mode === 'value')     arr.sort(function (a, b) { return stockValue(b) - stockValue(a); });
    else if (mode === 'sold')      arr.sort(function (a, b) { return statsForProduct(sales, b).qty    - statsForProduct(sales, a).qty;    });
    else if (mode === 'profit')    arr.sort(function (a, b) { return statsForProduct(sales, b).profit - statsForProduct(sales, a).profit; });
    else arr.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    return arr;
  }

  function renderCatalog(root) {
    var products = state.cache.products;
    var low = lowStockLevel();
    var sales = computeProductSales(state.cache.orders);

    // ---- Topbar: Cards/List toggle + Add product ----
    var cardsBtn = el('button', { class: state.catalogView === 'cards' ? 'active' : '' }, 'Cards');
    var listBtn  = el('button', { class: state.catalogView === 'list'  ? 'active' : '' }, 'List');
    function setView(v) {
      state.catalogView = v;
      cardsBtn.classList.toggle('active', v === 'cards');
      listBtn.classList.toggle('active', v === 'list');
      paint();
    }
    cardsBtn.addEventListener('click', function () { setView('cards'); });
    listBtn.addEventListener('click', function () { setView('list'); });
    $('#topbarActions').appendChild(el('div', { class: 'view-toggle' }, [cardsBtn, listBtn]));
    $('#topbarActions').appendChild(el('button', { class: 'btn primary', on: { click: function () { addNew(); } } }, '+ Add product'));

    // ---- Summary cards ----
    var totalUnits = products.reduce(function (s, p) { return s + stockUnits(p); }, 0);
    var lowCount = products.filter(function (p) { var v = num(p.stock) || 0; return v <= 0 || (low > 0 && v < low); }).length;
    var costValue = products.reduce(function (s, p) { return s + stockValue(p); }, 0);
    var retailValue = products.reduce(function (s, p) { return s + stockUnits(p) * (num(p.defaultSell) || 0); }, 0);
    root.appendChild(el('div', { class: 'cards grid-4', style: 'margin-bottom:18px' }, [
      statCard('Products', String(products.length), 'in catalog', 'ink'),
      statCard('Units in stock', String(totalUnits), totalUnits === 1 ? 'unit' : 'units'),
      statCard('Low / out of stock', String(lowCount), low > 0 ? 'at or below ' + low : 'out of stock'),
      statCard('Warehouse value', fmtMoney(costValue), 'Retail value: ' + fmtMoney(retailValue), 'accent')
    ]));

    // ---- Filters: search + sort ----
    var searchInput = el('input', { type: 'text', placeholder: 'Search product…', autocomplete: 'off', dir: 'auto' });
    searchInput.value = state.catalogQuery;
    var sortSelect = el('select', {}, [
      el('option', { value: 'name' }, 'Name (A–Z)'),
      el('option', { value: 'stockAsc' }, 'Stock: low → high'),
      el('option', { value: 'stockDesc' }, 'Stock: high → low'),
      el('option', { value: 'recent' }, 'Recently added'),
      el('option', { value: 'expiry' }, 'Expiry: soonest first'),
      el('option', { value: 'value' }, 'Warehouse value: high → low'),
      el('option', { value: 'sold' }, 'Best selling: units sold'),
      el('option', { value: 'profit' }, 'Most profitable: earned')
    ]);
    sortSelect.value = state.catalogSort;
    var filters = el('div', { class: 'filters' }, [
      searchInput,
      el('label', { style: 'display:flex;align-items:center;gap:6px;color:var(--muted);font-size:13px' }, ['Sort', sortSelect]),
      el('div', { class: 'spacer' })
    ]);
    root.appendChild(filters);

    var listHost = el('div', {});
    root.appendChild(listHost);

    function buildRowList(rows) {
      var list = el('div', { class: 'catalog-rows' });
      rows.forEach(function (p) { list.appendChild(productRow(makeProductEditor(p, false), statsForProduct(sales, p))); });
      return list;
    }

    function paint() {
      listHost.innerHTML = '';
      if (products.length === 0) {
        listHost.appendChild(el('div', { class: 'card empty' }, 'No products yet. Click "+ Add product", or they are saved automatically the first time you enter them in an order.'));
        return;
      }
      var q = searchInput.value.trim().toLowerCase();
      var rows = sortProducts(products.filter(function (p) {
        return !q || (p.nameLower || (p.name || '').toLowerCase()).indexOf(q) !== -1;
      }), state.catalogSort, sales);
      if (rows.length === 0) {
        listHost.appendChild(el('div', { class: 'card empty' }, 'No products match “' + searchInput.value.trim() + '”.'));
        return;
      }
      if (state.catalogView === 'cards') {
        var grid = el('div', { class: 'cards-list' });
        rows.forEach(function (p) { grid.appendChild(productCard(makeProductEditor(p, false), statsForProduct(sales, p))); });
        listHost.appendChild(grid);
      } else {
        listHost.appendChild(buildRowList(rows));
      }
    }

    function addNew() {
      var ed = makeProductEditor(null, true);
      if (products.length === 0) { listHost.innerHTML = ''; } // clear empty-state
      var zero = { qty: 0, revenue: 0, profit: 0 };
      if (state.catalogView === 'cards') {
        var grid = listHost.querySelector('.cards-list');
        if (!grid) { grid = el('div', { class: 'cards-list' }); listHost.appendChild(grid); }
        grid.insertBefore(productCard(ed, zero), grid.firstChild);
      } else {
        var list = listHost.querySelector('.catalog-rows');
        if (!list) { list = buildRowList([]); listHost.appendChild(list); }
        list.insertBefore(productRow(ed, zero), list.firstChild);
      }
      ed.focus();
    }

    searchInput.addEventListener('input', function () { state.catalogQuery = searchInput.value; paint(); });
    sortSelect.addEventListener('change', function () { state.catalogSort = sortSelect.value; paint(); });
    paint();
  }

  // ====== Customers page ======
  function petSummary(c) {
    var parts = [];
    if (c.petName) parts.push(c.petName);
    var typed = [];
    if (c.petSpecies) typed.push(c.petSpecies.charAt(0).toUpperCase() + c.petSpecies.slice(1));
    if (c.petBreed) typed.push(c.petBreed);
    if (typed.length) parts.push('(' + typed.join(', ') + ')');
    return parts.join(' ');
  }

  function contactName(c) { return c.name || c.phone1 || c.phone2 || '(no name)'; }

  function renderCustomers(root) {
    var custs = state.cache.customers;

    // ---- Per-contact stats keyed by customer id ----
    var byId = {};
    state.cache.orders.forEach(function (o) {
      var k = o.customerId; if (k == null) return;
      if (!byId[k]) byId[k] = { count: 0, total: 0, profit: 0, loss: 0, lastDate: '', firstDate: '' };
      var s = byId[k];
      s.count += 1;
      s.total += orderTotal(o);
      s.profit += orderProfit(o);
      s.loss += num(o.loss) || 0;
      if (!s.lastDate || o.date > s.lastDate) s.lastDate = o.date;
      if (!s.firstDate || o.date < s.firstDate) s.firstDate = o.date;
    });
    function stat(c) { return byId[c.id] || { count: 0, total: 0, profit: 0, loss: 0, lastDate: '', firstDate: '' }; }

    var lastRows = [];
    $('#topbarActions').appendChild(el('button', { class: 'btn', on: { click: function () { openImportContacts(); } } }, 'Import'));
    $('#topbarActions').appendChild(el('button', { class: 'btn', on: { click: function () { exportContactsCsv(lastRows, stat, 'names'); } } }, 'Names + numbers'));
    $('#topbarActions').appendChild(el('button', { class: 'btn', on: { click: function () { exportContactsCsv(lastRows, stat, 'full'); } } }, 'Full export'));
    $('#topbarActions').appendChild(el('button', { class: 'btn primary', on: { click: function () { openCustomerForm(null); } } }, '+ Add contact'));

    if (custs.length === 0) {
      root.appendChild(el('div', { class: 'card empty' }, 'No contacts yet. Add one with "+ Add contact" (a phone number is enough), or they are saved automatically when you create an order.'));
      return;
    }

    var summaryHost = el('div', {});
    root.appendChild(summaryHost);

    // ---- Filters: search + type + sort ----
    var searchInput = el('input', { type: 'text', placeholder: 'Search name / phone / email / pet…', autocomplete: 'off', dir: 'auto' });
    searchInput.value = state.customersQuery;
    var typeSel = el('select', {}, [
      el('option', { value: 'all' }, 'All contacts'),
      el('option', { value: 'buyers' }, 'Buyers (have orders)'),
      el('option', { value: 'leads' }, 'Leads (no orders)')
    ]);
    typeSel.value = state.customersFilter || 'all';
    var sortSel = el('select', {}, [
      el('option', { value: 'name' }, 'Name (A–Z)'),
      el('option', { value: 'ordersDesc' }, 'Most orders'),
      el('option', { value: 'ordersAsc' }, 'Fewest orders'),
      el('option', { value: 'spentDesc' }, 'Highest spent'),
      el('option', { value: 'spentAsc' }, 'Lowest spent'),
      el('option', { value: 'profitDesc' }, 'Most profit'),
      el('option', { value: 'lossDesc' }, 'Most loss caused'),
      el('option', { value: 'recent' }, 'Most recent order'),
      el('option', { value: 'oldest' }, 'Longest inactive'),
      el('option', { value: 'newest' }, 'Newest contact')
    ]);
    sortSel.value = state.customersSort || 'spentDesc';
    root.appendChild(el('div', { class: 'filters' }, [
      searchInput, typeSel,
      el('label', { class: 'flt-sort' }, ['Sort', sortSel]),
      el('div', { class: 'spacer' })
    ]));

    var listHost = el('div', {});
    root.appendChild(listHost);

    function computeRows() {
      var q = searchInput.value.trim().toLowerCase();
      var tf = typeSel.value;
      var rows = custs.filter(function (c) {
        var s = stat(c);
        if (tf === 'buyers' && s.count === 0) return false;
        if (tf === 'leads' && s.count > 0) return false;
        if (q) {
          var hay = ((c.name || '') + ' ' + (c.phone1 || '') + ' ' + (c.phone2 || '') + ' ' + (c.email || '') + ' ' + (c.petName || '') + ' ' + (c.petBreed || '')).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
      var sm = sortSel.value;
      rows.sort(function (a, b) {
        var sa = stat(a), sb = stat(b);
        switch (sm) {
          case 'ordersDesc': return sb.count - sa.count;
          case 'ordersAsc':  return sa.count - sb.count;
          case 'spentDesc':  return sb.total - sa.total;
          case 'spentAsc':   return sa.total - sb.total;
          case 'profitDesc': return sb.profit - sa.profit;
          case 'lossDesc':   return sb.loss - sa.loss;
          case 'recent':     return String(sb.lastDate || '').localeCompare(String(sa.lastDate || ''));
          case 'oldest':     return String(sa.lastDate || '9999-99-99').localeCompare(String(sb.lastDate || '9999-99-99'));
          case 'newest':     return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
          default:           return contactName(a).localeCompare(contactName(b));
        }
      });
      return rows;
    }

    function paint() {
      state.customersFilter = typeSel.value;
      state.customersSort = sortSel.value;
      var rows = computeRows();
      lastRows = rows;

      var buyers = custs.filter(function (c) { return stat(c).count > 0; }).length;
      var revenue = custs.reduce(function (s, c) { return s + stat(c).total; }, 0);
      summaryHost.innerHTML = '';
      summaryHost.appendChild(el('div', { class: 'cards grid-4', style: 'margin-bottom:18px' }, [
        statCard('Contacts', String(custs.length), 'total'),
        statCard('Buyers', String(buyers), 'with orders'),
        statCard('Leads', String(custs.length - buyers), 'no orders yet'),
        statCard('Revenue', fmtMoney(revenue), 'all contacts')
      ]));

      listHost.innerHTML = '';
      if (rows.length === 0) {
        listHost.appendChild(el('div', { class: 'card empty' }, 'No contacts match.'));
        return;
      }
      var t = el('table', { class: 'table' });
      t.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, 'Contact'),
        el('th', {}, 'Phone'),
        el('th', { class: 'num' }, 'Orders'),
        el('th', { class: 'num' }, 'Spent'),
        el('th', { class: 'num' }, 'Profit'),
        el('th', { class: 'num' }, 'Loss'),
        el('th', {}, 'Last order'),
        el('th', { class: 'actions' }, '')
      ])));
      var tb = el('tbody', {});
      rows.forEach(function (c) {
        var s = stat(c);
        var phone = [c.phone1, c.phone2].filter(Boolean).join(' / ');
        var editBtn = el('button', { class: 'btn ghost sm', on: { click: function (e) { e.stopPropagation(); openCustomerForm(c); } } }, 'Edit');
        var delBtn = el('button', { class: 'btn ghost sm', on: { click: function (e) {
          e.stopPropagation();
          archiveRecord('customers', c, 'Contact "' + contactName(c) + '"');
        } } }, 'Delete');
        var nameCell = el('td', {}, [
          el('span', { dir: 'auto' }, contactName(c)),
          s.count === 0 ? el('span', { class: 'tag lead-tag' }, 'LEAD') : null
        ]);
        if (c.notes) nameCell.title = c.notes;
        tb.appendChild(el('tr', { style: 'cursor:pointer', on: { click: function (e) {
          if (e.target.tagName === 'BUTTON') return;
          navigate('contact/' + c.id);
        } } }, [
          nameCell,
          el('td', {}, phone || '—'),
          el('td', { class: 'num' }, String(s.count)),
          el('td', { class: 'num' }, fmtMoney(s.total)),
          el('td', { class: 'num', style: s.profit ? 'color:var(--good)' : '' }, s.count ? fmtMoney(s.profit) : '—'),
          el('td', { class: 'num', style: s.loss > 0 ? 'color:var(--bad)' : '' }, s.loss > 0 ? fmtMoney(s.loss) : '—'),
          el('td', {}, s.lastDate ? fmtDateForList(s.lastDate) : '—'),
          el('td', { class: 'actions' }, [editBtn, delBtn])
        ]));
      });
      t.appendChild(tb);
      listHost.appendChild(t);
    }

    searchInput.addEventListener('input', function () { state.customersQuery = searchInput.value; paint(); });
    typeSel.addEventListener('change', paint);
    sortSel.addEventListener('change', paint);
    paint();
  }

  // Download the current (filtered) contacts as a CSV.
  //   mode 'names' → just Name + phone numbers.  mode 'full' → name, phones, email + stats.
  // Phone numbers are forced to Latin digits so Excel reads them cleanly.
  function exportContactsCsv(rows, statFn, mode) {
    if (!rows || !rows.length) { toast('No contacts to export', 'error'); return; }
    function esc(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
    var header, buildLine, suffix;
    if (mode === 'names') {
      header = ['Name', 'Phone 1', 'Phone 2'];
      buildLine = function (c) { return [c.name || '', toEnglishDigits(c.phone1 || ''), toEnglishDigits(c.phone2 || '')]; };
      suffix = 'names';
    } else {
      header = ['Name', 'Phone 1', 'Phone 2', 'Email', 'Orders', 'Spent', 'Profit', 'Loss', 'Last order'];
      buildLine = function (c) {
        var s = statFn(c);
        return [c.name || '', toEnglishDigits(c.phone1 || ''), toEnglishDigits(c.phone2 || ''), c.email || '', s.count, Math.round(s.total), Math.round(s.profit), Math.round(s.loss), s.lastDate || ''];
      };
      suffix = 'full';
    }
    var lines = [header.join(',')];
    rows.forEach(function (c) { lines.push(buildLine(c).map(esc).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'rumi-contacts-' + suffix + '-' + J.formatJalali(new Date()).replace(/\//g, '-') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
    toast(rows.length + ' contact' + (rows.length === 1 ? '' : 's') + ' exported', 'ok');
  }

  // ====== Import contacts ======
  // Normalize a phone to local form: +98… / 0098… / 98… → 0…, and 9xxxxxxxxx → 09xxxxxxxxx.
  function normalizePhone(raw) {
    var p = toEnglishDigits(String(raw || '')).replace(/[^\d+]/g, '');
    if (p.indexOf('+98') === 0)      p = '0' + p.slice(3);
    else if (p.indexOf('0098') === 0) p = '0' + p.slice(4);
    else if (p.length === 12 && p.indexOf('98') === 0) p = '0' + p.slice(2);
    else if (p.length === 10 && p.charAt(0) === '9')    p = '0' + p;
    return p;
  }

  // Parse a pasted contact list into [{ name, phone, email }].
  function parseContactsText(text) {
    var lines = toEnglishDigits(String(text || '')).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var HEADERS = ['نام و نام خانوادگی', 'شماره موبایل', 'ایمیل', 'تاریخ ایجاد'];
    var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    function isHeader(l) { return HEADERS.indexOf(l) !== -1; }
    function isEmail(l) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l); }
    function isDate(l) {
      if (l.indexOf('ساعت') !== -1) return true;
      for (var i = 0; i < MONTHS.length; i++) if (l.indexOf(MONTHS[i]) !== -1) return true;
      return false;
    }
    function phoneOf(l) {
      if (!/^[+\d]/.test(l)) return null;
      var digits = l.replace(/[^\d]/g, '');
      if (digits.length < 10 || digits.length > 14) return null;
      return l.replace(/[^\d+]/g, '');
    }
    var results = [], pendingName = null, current = null;
    lines.forEach(function (l) {
      if (isHeader(l)) { pendingName = null; current = null; return; }
      if (isEmail(l)) { if (current && !current.email) current.email = l; return; }
      if (isDate(l)) { pendingName = null; current = null; return; }
      var ph = phoneOf(l);
      if (ph) {
        var name = (pendingName && pendingName !== 'بدون نام') ? pendingName : '';
        current = { name: name, phone: normalizePhone(ph), email: '' };
        results.push(current);
        pendingName = null;
        return;
      }
      pendingName = l; current = null; // a name candidate
    });
    return results.filter(function (r) { return r.phone; });
  }

  function openImportContacts() {
    $('#imp_text').value = '';
    $('#imp_file').value = '';
    $('#imp_result').textContent = '';
    openModal('importContactsModal');
  }

  // Returns { parsed, toAdd, skipped } after de-duping against existing + within the list.
  function analyzeImport() {
    var parsed = parseContactsText($('#imp_text').value);
    var existing = {};
    state.cache.customers.forEach(function (c) {
      [c.phone1, c.phone2].forEach(function (p) { var n = normalizePhone(p); if (n) existing[n] = true; });
    });
    var seen = {}, toAdd = [], skipped = 0;
    parsed.forEach(function (r) {
      if (existing[r.phone] || seen[r.phone]) { skipped++; return; }
      seen[r.phone] = true; toAdd.push(r);
    });
    return { parsed: parsed, toAdd: toAdd, skipped: skipped };
  }

  function previewImportContacts() {
    var a = analyzeImport();
    if (!a.parsed.length) { $('#imp_result').textContent = 'No contacts found in the text.'; return; }
    $('#imp_result').textContent = 'Found ' + a.parsed.length + ' · new to add: ' + a.toAdd.length + ' · already exist: ' + a.skipped;
  }

  function runImportContacts() {
    var a = analyzeImport();
    if (!a.parsed.length) { $('#imp_result').textContent = 'No contacts found in the text.'; return; }
    if (!a.toAdd.length) { $('#imp_result').textContent = 'All ' + a.parsed.length + ' contacts already exist — nothing to add.'; return; }
    var now = new Date().toISOString();
    Promise.all(a.toAdd.map(function (r) {
      var name = (r.name || '').trim();
      return DB.add('customers', {
        name: name, nameLower: name.toLowerCase(),
        phone1: r.phone, phone2: '', email: r.email || '', address: '',
        createdAt: now
      });
    })).then(function () {
      closeModal('importContactsModal');
      toast(a.toAdd.length + ' contact' + (a.toAdd.length === 1 ? '' : 's') + ' imported' + (a.skipped ? ' · ' + a.skipped + ' skipped' : ''), 'ok');
      render();
    }).catch(function () { toast('Import failed', 'error'); });
  }

  // ====== Contact detail page ======
  function renderContactDetail(root, id) {
    $('#topbarActions').appendChild(el('button', { class: 'btn', on: { click: function () { navigate('customers'); } } }, '← Contacts'));
    var c = state.cache.customers.filter(function (x) { return x.id === id; })[0];
    if (!c) {
      root.appendChild(el('div', { class: 'card empty' }, 'Contact not found. It may have been deleted.'));
      return;
    }
    $('#pageTitle').textContent = contactName(c);
    $('#topbarActions').appendChild(el('button', { class: 'btn primary', on: { click: function () { openCustomerForm(c); } } }, 'Edit contact'));

    // Orders for this contact (by id, with a name fallback for legacy rows).
    var orders = state.cache.orders.filter(function (o) {
      return o.customerId === id || (c.nameLower && String(o.customerName || '').toLowerCase() === c.nameLower);
    }).slice().sort(function (a, b) {
      var d = (b.date || '').localeCompare(a.date || '');
      if (d !== 0) return d;
      var t = (b.time || '').localeCompare(a.time || '');
      if (t !== 0) return t;
      return (b.id || 0) - (a.id || 0);
    });

    // ---- Lifetime summary ----
    var count = orders.length;
    var spent  = orders.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    var profit = orders.reduce(function (s, o) { return s + orderProfit(o); }, 0);
    var loss   = orders.reduce(function (s, o) { return s + (num(o.loss) || 0); }, 0);
    var avg = count ? spent / count : 0;
    root.appendChild(el('div', { class: 'cards grid-5', style: 'margin-bottom:18px' }, [
      statCard('Orders', String(count), 'lifetime'),
      statCard('Spent', fmtMoney(spent), 'lifetime'),
      statCard('Profit', fmtMoney(profit), 'lifetime', profit < 0 ? 'bad' : 'good'),
      statCard('Loss', fmtMoney(loss), loss > 0 ? 'defects / refunds' : 'none', loss > 0 ? 'bad' : ''),
      statCard('Avg order', count ? fmtMoney(avg) : '—', 'per order')
    ]));

    // ---- Contact details ----
    var infoRows = [];
    function info(label, val) { if (val) infoRows.push(el('div', { class: 'ci-row' }, [el('span', { class: 'ci-label' }, label), el('span', { dir: 'auto' }, val)])); }
    info('Phone 1', c.phone1);
    info('Phone 2', c.phone2);
    info('Email', c.email);
    info('Address', c.address);
    info('Pet', petSummary(c));
    info('Pet birthday', c.petBirthday);
    info('Notes', c.notes);
    if (infoRows.length === 0) infoRows.push(el('div', { style: 'color:var(--muted)' }, 'No contact details yet — click "Edit contact" to add them.'));
    root.appendChild(el('div', { class: 'card', style: 'margin-bottom:18px' }, [
      el('div', { class: 'section-title', style: 'margin:0 0 10px' }, 'Contact details'),
      el('div', { class: 'contact-info' }, infoRows)
    ]));

    // ---- Order history (one dated card per order) ----
    root.appendChild(el('h3', { class: 'section-title' }, 'Order history'));
    if (count === 0) {
      root.appendChild(el('div', { class: 'card empty' }, 'No orders yet for this contact.'));
      return;
    }
    orders.forEach(function (o) { root.appendChild(buildContactOrderCard(o)); });
  }

  function buildContactOrderCard(o) {
    var lines = o.products || [];
    var itemsSubtotal = lines.reduce(function (s, l) { return s + num(l.sellPrice) * num(l.qty); }, 0);
    var shipping = num(o.shipping) || 0;
    var discount = num(o.discount) || 0;
    var loss = num(o.loss) || 0;
    var profit = orderProfit(o);
    var total = orderTotal(o);

    var tagKids = [statusBadges(o)];
    if (o.isWholesale) tagKids.push(el('span', { class: 'tag wholesale' }, 'WHOLESALE'));
    if (loss > 0) tagKids.push(el('span', { class: 'tag loss' }, 'LOSS'));
    var head = el('div', { class: 'co-head' }, [
      el('div', { class: 'co-when' }, [
        el('span', { class: 'co-date' }, fmtDateForList(o.date)),
        el('span', { class: 'co-time' }, o.time || ''),
        el('span', { class: 'co-num' }, '#' + orderNo(o))
      ]),
      el('div', { class: 'co-tags' }, tagKids)
    ]);

    var tbl = el('table', { class: 'table co-table' });
    tbl.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, 'Product'),
      el('th', { class: 'num' }, 'Qty'),
      el('th', { class: 'num' }, 'Cost / unit'),
      el('th', { class: 'num' }, 'Sell / unit'),
      el('th', { class: 'num' }, 'Line profit')
    ])));
    var tb = el('tbody', {});
    lines.forEach(function (l) {
      var lp = (num(l.sellPrice) - num(l.costPrice)) * num(l.qty);
      tb.appendChild(el('tr', {}, [
        el('td', { dir: 'auto' }, l.name),
        el('td', { class: 'num' }, String(l.qty)),
        el('td', { class: 'num' }, fmtMoney(num(l.costPrice))),
        el('td', { class: 'num' }, fmtMoney(num(l.sellPrice))),
        el('td', { class: 'num', style: lp < 0 ? 'color:var(--bad)' : 'color:var(--good)' }, fmtMoney(lp))
      ]));
    });
    (o.gifts || []).forEach(function (g) {
      tb.appendChild(el('tr', {}, [
        el('td', { dir: 'auto' }, [document.createTextNode(g.name + ' '), el('span', { class: 'tag gift' }, 'GIFT')]),
        el('td', { class: 'num' }, String(g.qty)),
        el('td', { class: 'num' }, fmtMoney(num(g.costPrice))),
        el('td', { class: 'num' }, '—'),
        el('td', { class: 'num', style: 'color:var(--bad)' }, '−' + fmtMoney(num(g.costPrice) * num(g.qty)))
      ]));
    });
    tbl.appendChild(tb);
    var gifts = giftsCost(o);

    function trow(label, val, cls) { return el('div', { class: 'co-trow' + (cls ? ' ' + cls : '') }, [el('span', {}, label), el('span', {}, val)]); }
    var totals = el('div', { class: 'co-totals' }, [
      trow('Items subtotal', fmtMoney(itemsSubtotal)),
      shipping ? trow('Shipping', fmtMoney(shipping)) : null,
      discount ? trow('Discount', '−' + fmtMoney(discount)) : null,
      gifts ? trow('Gifts cost', '−' + fmtMoney(gifts), 'bad') : null,
      loss ? trow('Loss', '−' + fmtMoney(loss), 'bad') : null,
      trow('Customer pays', fmtMoney(total), 'strong'),
      trow('Order profit', fmtMoney(profit), profit < 0 ? 'bad' : 'good')
    ]);

    return el('div', { class: 'card contact-order', style: 'cursor:pointer;margin-bottom:14px', on: { click: function (e) {
      if (e.target.tagName === 'BUTTON' || (e.target.closest && e.target.closest('.sbadge'))) return;
      openOrderForm(o);
    } } }, [head, tbl, totals]);
  }

  // ====== Archive page ======
  function archiveDescribe(store, r) {
    if (store === 'orders')    return '#' + orderNo(r) + '  ·  ' + (r.customerName || '—') + '  ·  ' + fmtMoney(orderTotal(r)) + '  ·  ' + fmtDateForList(r.date);
    if (store === 'customers') return contactName(r) + (r.phone1 ? '  ·  ' + r.phone1 : '');
    if (store === 'products')  return (r.name || '(unnamed)') + '  ·  stock ' + (num(r.stock) || 0);
    if (store === 'expenses')  return (r.name || 'expense') + (r.category ? '  ·  ' + r.category : '') + '  ·  ' + fmtMoney(r.amount);
    if (store === 'funding')   return (r.name || 'funding') + '  ·  ' + fmtMoney(r.amount);
    return '#' + r.id;
  }

  function buildArchiveRow(store, rec) {
    var when = rec.archivedAt ? new Date(rec.archivedAt) : null;
    var whenLbl = when ? (J.formatJalali(when) + ' ' + J.pad(when.getHours()) + ':' + J.pad(when.getMinutes())) : '';
    var restoreBtn = el('button', { class: 'btn ghost sm', on: { click: function () {
      restoreRecord(store, rec).then(function () { toast('Restored', 'ok'); render(); }).catch(function () { toast('Could not restore', 'error'); });
    } } }, 'Restore');
    var delBtn = el('button', { class: 'btn ghost sm', on: { click: function () {
      confirm('Delete permanently?', 'This ' + (ARCHIVE_LABELS[store] || 'item').toLowerCase() + ' will be gone for good — this cannot be undone.', function () {
        purgeRecord(store, rec).then(function () { toast('Deleted permanently', 'ok'); render(); });
      });
    } } }, 'Delete permanently');
    return el('div', { class: 'card archive-row' }, [
      el('div', { class: 'ar-main' }, [
        el('div', { class: 'ar-desc', dir: 'auto' }, archiveDescribe(store, rec)),
        whenLbl ? el('div', { class: 'ar-when' }, 'Archived ' + whenLbl) : null
      ]),
      el('div', { class: 'ar-actions' }, [restoreBtn, delBtn])
    ]);
  }

  function renderArchive(root) {
    var arch = state.cache.archive || [];
    if (arch.length === 0) {
      root.appendChild(el('div', { class: 'card empty' }, 'Archive is empty. Anything you delete is moved here and can be restored.'));
      return;
    }
    $('#topbarActions').appendChild(el('button', { class: 'btn danger', on: { click: function () {
      confirm('Empty the archive?', 'Permanently delete all ' + arch.length + ' archived item' + (arch.length === 1 ? '' : 's') + '? This cannot be undone.', function () {
        Promise.all(arch.map(function (a) { return purgeRecord(a.store, a.rec); })).then(function () { toast('Archive emptied', 'ok'); render(); });
      });
    } } }, 'Empty archive'));

    var groups = {};
    arch.forEach(function (a) { (groups[a.store] = groups[a.store] || []).push(a.rec); });
    [['orders', 'Orders'], ['customers', 'Contacts'], ['products', 'Products'], ['expenses', 'Expenses'], ['funding', 'Funding']].forEach(function (g) {
      var recs = groups[g[0]]; if (!recs || !recs.length) return;
      root.appendChild(el('h3', { class: 'section-title' }, g[1] + ' (' + recs.length + ')'));
      var list = el('div', { class: 'archive-list' });
      recs.forEach(function (rec) { list.appendChild(buildArchiveRow(g[0], rec)); });
      root.appendChild(list);
    });
  }

  // Open the customer add/edit modal. Pass null to create a new customer.
  function openCustomerForm(cOrNull) {
    var c = cOrNull || {};
    $('#customerModalTitle').textContent = cOrNull ? 'Edit Contact' : 'New Contact';
    $('#c_name').value       = c.name || '';
    $('#c_phone1').value     = c.phone1 || '';
    $('#c_phone2').value     = c.phone2 || '';
    $('#c_email').value      = c.email || '';
    $('#c_address').value    = c.address || '';
    $('#c_petName').value    = c.petName || '';
    $('#c_petSpecies').value = c.petSpecies || '';
    $('#c_petBreed').value   = c.petBreed || '';
    $('#c_petBirthday').value = c.petBirthday || '';
    $('#c_notes').value      = c.notes || '';
    state.editingCustomerId = cOrNull ? c.id : null;
    openModal('customerModal');
    setTimeout(function () { $('#c_name').focus(); }, 30);
  }

  function saveCustomerFromForm() {
    var name = $('#c_name').value.trim();
    var phone1 = toEnglishDigits($('#c_phone1').value.trim());
    // A contact needs at least a name OR a phone number (e.g. a lead who just called).
    if (!name && !phone1) { toast('Enter a name or a phone number', 'error'); $('#c_name').focus(); return; }
    var nameLower = name.toLowerCase();
    var id = state.editingCustomerId;

    // Guard against name collisions with a *different* existing named customer.
    if (name) {
      var clash = state.cache.customers.filter(function (x) {
        return x.nameLower === nameLower && x.id !== id;
      });
      if (clash.length) { toast('Another contact already uses that name', 'error'); $('#c_name').focus(); return; }
    }

    var existing = id != null
      ? state.cache.customers.filter(function (x) { return x.id === id; })[0]
      : null;
    var prevName = existing ? existing.name : null;

    var record = existing ? existing : { createdAt: new Date().toISOString() };
    record.name = name;
    record.nameLower = nameLower;
    record.phone1 = phone1;
    record.phone2 = toEnglishDigits($('#c_phone2').value.trim());
    record.email = $('#c_email').value.trim();
    record.address = $('#c_address').value.trim();
    record.petName = $('#c_petName').value.trim();
    record.petSpecies = $('#c_petSpecies').value;
    record.petBreed = $('#c_petBreed').value.trim();
    record.petBirthday = $('#c_petBirthday').value.trim();
    record.notes = $('#c_notes').value.trim();

    DB.put('customers', record).then(function () {
      // If the name changed, keep the denormalized customerName on linked orders in sync.
      if (existing && prevName !== name) {
        var linked = state.cache.orders.filter(function (o) { return o.customerId === id; });
        return Promise.all(linked.map(function (o) { o.customerName = name; return DB.put('orders', o); }));
      }
    }).then(function () {
      closeModal('customerModal');
      toast('Contact saved', 'ok');
      renderInPlace();
    }).catch(function () { toast('Could not save customer', 'error'); });
  }

  // ====== Settings / backup ======
  function saveSettings(patch) {
    var merged = mergeSettings(state.settings);
    ['company', 'finance', 'inventory', 'allocation'].forEach(function (grp) {
      if (patch[grp]) for (var k in patch[grp]) merged[grp][k] = patch[grp][k];
    });
    if (patch.expenseCategories) merged.expenseCategories = patch.expenseCategories;
    if (patch.fundingSources) merged.fundingSources = patch.fundingSources;
    state.settings = merged;
    applySettings();
    return DB.setMeta('settings', merged).then(function () { toast('Settings saved', 'ok'); render(); });
  }
  function textLines(t) { return String(t || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }

  function renderSettings(root) {
    var s = state.settings;

    // ---- Business profile ----
    var inName  = el('input', { type: 'text', value: s.company.name || '' });
    var inPhone = el('input', { type: 'text', value: s.company.phone || '' });
    var inTaxId = el('input', { type: 'text', value: s.company.taxId || '' });
    var inAddr  = el('textarea', { rows: '2' }); inAddr.value = s.company.address || '';
    var inNote  = el('textarea', { rows: '2' }); inNote.value = s.company.invoiceNote || '';
    var profileCard = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0' }, 'Business profile'),
      el('p', { style: 'color:var(--muted)' }, 'Appears on printed reports (and on invoices once that module is added).'),
      el('div', { class: 'grid two' }, [
        el('label', { class: 'field' }, [el('span', {}, 'Business name'), inName]),
        el('label', { class: 'field' }, [el('span', {}, 'Phone'), inPhone])
      ]),
      el('div', { class: 'grid two' }, [
        el('label', { class: 'field' }, [el('span', {}, 'Tax ID'), inTaxId]),
        el('label', { class: 'field' }, [el('span', {}, 'Address'), inAddr])
      ]),
      el('label', { class: 'field' }, [el('span', {}, 'Report / invoice footer note'), inNote]),
      el('div', { class: 'settings-actions' }, [
        el('button', { class: 'btn primary', on: { click: function () {
          saveSettings({ company: {
            name: inName.value.trim(), phone: inPhone.value.trim(), taxId: inTaxId.value.trim(),
            address: inAddr.value.trim(), invoiceNote: inNote.value.trim()
          } });
        } } }, 'Save profile')
      ])
    ]);

    // ---- Financial settings ----
    var inSym = el('input', { type: 'text', value: s.finance.currencySymbol || '', style: 'max-width:140px' });
    var inPos = el('select', {}, [
      el('option', { value: 'suffix' }, 'After amount (1,000 T)'),
      el('option', { value: 'prefix' }, 'Before amount ($1,000)')
    ]);
    inPos.value = s.finance.currencyPosition || 'suffix';
    var inDec = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', min: '0', max: '4', step: '1', value: s.finance.decimals != null ? s.finance.decimals : 0, style: 'max-width:140px' });
    var inTax = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', min: '0', step: '0.1', value: s.finance.taxRate != null ? s.finance.taxRate : 0, style: 'max-width:140px' });
    var inLow = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', min: '0', step: '1', value: s.inventory.lowStockLevel != null ? s.inventory.lowStockLevel : 5, style: 'max-width:140px' });
    var inGoal = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', min: '0', step: '1', value: s.finance.monthlyRevenueGoal || 0, style: 'max-width:220px' });

    var allocInputs = {};
    var allocWrap = el('div', {});
    var allocTotal = el('div', { class: 'alloc-total' });
    function refreshAllocTotal() {
      var t = 0; ['personal', 'wholesale', 'tax'].forEach(function (k) { t += num(allocInputs[k].value) || 0; });
      allocTotal.textContent = 'Total: ' + t + '%' + (t === 100 ? '  ✓' : '  (should be 100%)');
      allocTotal.className = 'alloc-total' + (t === 100 ? '' : ' bad');
    }
    [['personal', 'Personal income'], ['wholesale', 'Wholesale increase'], ['tax', 'Emergency & tax']].forEach(function (pair) {
      var inp = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', min: '0', max: '100', step: '1', value: s.allocation[pair[0]] != null ? s.allocation[pair[0]] : 0 });
      inp.addEventListener('input', refreshAllocTotal);
      allocInputs[pair[0]] = inp;
      allocWrap.appendChild(el('div', { class: 'alloc-row' }, [el('span', {}, pair[1]), inp]));
    });

    var inExpCats = el('textarea', { rows: '5' }); inExpCats.value = (s.expenseCategories || []).join('\n');
    var inFundSrc = el('textarea', { rows: '3' }); inFundSrc.value = (s.fundingSources || []).join('\n');

    var financeCard = el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h3', { style: 'margin-top:0' }, 'Financial settings'),
      el('div', { class: 'grid three' }, [
        el('label', { class: 'field' }, [el('span', {}, 'Currency symbol'), inSym]),
        el('label', { class: 'field' }, [el('span', {}, 'Symbol position'), inPos]),
        el('label', { class: 'field' }, [el('span', {}, 'Decimal places'), inDec])
      ]),
      el('div', { class: 'grid three' }, [
        el('label', { class: 'field' }, [el('span', {}, 'Default tax rate (%)'), inTax]),
        el('label', { class: 'field' }, [el('span', {}, 'Low-stock alert level (units)'), inLow]),
        el('label', { class: 'field' }, [el('span', {}, 'Monthly revenue goal'), inGoal])
      ]),
      el('div', { class: 'section-title', style: 'margin:18px 0 8px' }, 'Profit allocation'),
      allocWrap, allocTotal,
      el('div', { class: 'grid two', style: 'margin-top:14px' }, [
        el('label', { class: 'field' }, [el('span', {}, 'Expense categories (one per line)'), inExpCats]),
        el('label', { class: 'field' }, [el('span', {}, 'Funding sources (one per line)'), inFundSrc])
      ]),
      el('div', { class: 'settings-actions' }, [
        el('button', { class: 'btn primary', on: { click: function () {
          saveSettings({
            finance: { currencySymbol: inSym.value, currencyPosition: inPos.value, decimals: num(inDec.value) || 0, taxRate: num(inTax.value) || 0, monthlyRevenueGoal: num(inGoal.value) || 0 },
            inventory: { lowStockLevel: num(inLow.value) || 0 },
            allocation: { personal: num(allocInputs.personal.value) || 0, wholesale: num(allocInputs.wholesale.value) || 0, tax: num(allocInputs.tax.value) || 0 },
            expenseCategories: textLines(inExpCats.value),
            fundingSources: textLines(inFundSrc.value)
          });
        } } }, 'Save financial settings')
      ])
    ]);
    refreshAllocTotal();

    root.appendChild(el('h3', { class: 'section-title', style: 'margin-top:0' }, 'Sync & security'));
    root.appendChild(el('div', { class: 'cards grid-2 settings-top' }, [buildSyncCard(), el('div', { class: 'stack' }, [buildSecurityCard(), buildMirrorCard()])]));
    root.appendChild(el('h3', { class: 'section-title' }, 'Business'));
    root.appendChild(profileCard);
    root.appendChild(financeCard);
    root.appendChild(el('h3', { class: 'section-title' }, 'Backup & data'));

    var card1 = el('div', { class: 'card' }, [
      el('h3', { style: 'margin-top:0' }, 'Export data'),
      el('p', { style: 'color:var(--muted)' }, 'Download everything (orders, contacts, products, stock, expenses, funding and settings) as one JSON file. Keep it somewhere safe — you can re-import it later or on another device.'),
      el('button', { class: 'btn primary', on: { click: doExport } }, 'Download backup (.json)')
    ]);
    var card2 = el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('h3', { style: 'margin-top:0' }, 'Import data'),
      el('p', { style: 'color:var(--muted)' }, 'Choose how to import:'),
      el('div', { class: 'kv' }, [
        el('div', { class: 'k' }, 'Replace'),
        el('div', {}, 'Wipe everything currently here and load the file as-is. IDs are preserved.'),
        el('div', { class: 'k' }, 'Merge'),
        el('div', {}, 'Add records from the file alongside what is already here. Imported records get fresh IDs.')
      ]),
      el('div', { style: 'display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap' }, [
        el('input', { type: 'file', id: 'importFile', accept: 'application/json,.json' }),
        el('button', { class: 'btn', on: { click: function () { doImport('merge'); } } }, 'Import (Merge)'),
        el('button', { class: 'btn danger', on: { click: function () { doImport('replace'); } } }, 'Import (Replace)')
      ])
    ]);
    var card3 = el('div', { class: 'card', style: 'margin-top:16px;border-color:var(--bad)' }, [
      el('h3', { style: 'margin-top:0;color:var(--bad)' }, 'Danger zone'),
      el('p', { style: 'color:var(--muted)' }, 'Permanently delete all data. When cloud sync is on, it is deleted on your other devices and in the cloud file too (older versions stay in the repository history). Make a backup first.'),
      el('button', { class: 'btn danger', on: { click: function () {
        confirm('Wipe all data?', 'This cannot be undone' + (Sync.isConfigured() ? ' and also clears your other synced devices' : '') + '. Your last backup file is unaffected.', function () {
          DB.wipeAll().then(function () { toast('All data wiped', 'ok'); render(); refreshBackupStatus(); });
        });
      } } }, 'Wipe all data')
    ]);
    root.appendChild(card1);
    root.appendChild(card2);
    root.appendChild(card3);
  }

  function doExport() {
    DB.exportAll().then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var name = 'rumi-backup-' + J.formatJalali(new Date()).replace(/\//g, '-') + '.json';
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
      DB.setMeta('lastBackup', new Date().toISOString()).then(function () {
        refreshBackupStatus();
        render(); // refresh so the dashboard backup reminder clears
      });
      toast('Backup downloaded', 'ok');
    });
  }
  function doImport(mode) {
    var f = $('#importFile').files[0];
    if (!f) { toast('Choose a file first', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var msg = mode === 'replace'
          ? 'Replace ALL current data with this file?'
          : 'Merge file into current data?';
        confirm('Import data', msg, function () {
          DB.importAll(data, mode).then(function () {
            toast('Import complete', 'ok');
            render();
            refreshBackupStatus();
          }).catch(function (err) {
            toast('Import failed: ' + err.message, 'error');
          });
        });
      } catch (err) {
        toast('Could not parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(f);
  }

  // ====== Order form ======
  function openOrderForm(orderOrNull, prefDate) {
    state.editingOrderId = orderOrNull ? orderOrNull.id : null;
    state.formCalMode = state.calMode; // start in same mode as calendar pref
    $('#orderModalTitle').textContent = orderOrNull ? ('Edit Order #' + orderNo(orderOrNull)) : 'New Order';

    // Invoice button only makes sense for a saved order.
    var invoiceBtn = $('#invoiceOrderBtn');
    if (orderOrNull) {
      invoiceBtn.classList.remove('hidden');
      invoiceBtn.onclick = function () { printInvoice(orderOrNull); };
    } else {
      invoiceBtn.classList.add('hidden');
      invoiceBtn.onclick = null;
    }

    var dateField = $('#f_date');
    var dateHint = $('#dateHint');
    var calToggle = $('#dateCalToggle');

    function paintDateHint() {
      var raw = dateField.value;
      var d;
      if (state.formCalMode === 'jalali') d = J.parseJalali(raw);
      else d = J.parseGregorian(raw);
      if (!d) { dateHint.textContent = 'Format: YYYY/MM/DD'; return; }
      if (state.formCalMode === 'jalali') dateHint.textContent = 'Gregorian: ' + J.formatGregorian(d);
      else dateHint.textContent = 'Jalali: ' + J.formatJalali(d);
    }
    function setDateInputFrom(jsDate) {
      if (state.formCalMode === 'jalali') dateField.value = J.formatJalali(jsDate);
      else dateField.value = J.formatGregorian(jsDate);
      paintDateHint();
    }
    function syncCalToggleLabel() {
      calToggle.textContent = state.formCalMode === 'jalali' ? 'J' : 'G';
      calToggle.title = 'Currently ' + (state.formCalMode === 'jalali' ? 'Jalali' : 'Gregorian') + ' — click to switch';
    }
    calToggle.onclick = function () {
      var raw = dateField.value;
      var d = (state.formCalMode === 'jalali') ? J.parseJalali(raw) : J.parseGregorian(raw);
      state.formCalMode = state.formCalMode === 'jalali' ? 'gregorian' : 'jalali';
      syncCalToggleLabel();
      if (d) setDateInputFrom(d);
      else paintDateHint();
    };
    dateField.oninput = paintDateHint;
    syncCalToggleLabel();

    // Fill form
    if (orderOrNull) {
      $('#f_customer').value = orderOrNull.customerName || '';
      $('#f_pet').value = orderOrNull.pet || 'dog';
      setDateInputFrom(J.dateFromIso(orderOrNull.date) || new Date());
      $('#f_time').value = orderOrNull.time || '';
      $('#f_wholesale').checked = !!orderOrNull.isWholesale;
      $('#f_phone1').value = orderOrNull.phone1 || '';
      $('#f_phone2').value = orderOrNull.phone2 || '';
      $('#f_email').value  = orderOrNull.email  || '';
      $('#f_shipping').value = orderOrNull.shipping || 0;
      $('#f_discount').value = orderOrNull.discount || 0;
      $('#f_loss').value = orderOrNull.loss || 0;
      $('#f_address').value = orderOrNull.address || '';
      segSet('f_paid', !!orderOrNull.paid);
      segSet('f_shipped', !!orderOrNull.shipped);
      buildProductLines(orderOrNull.products || []);
      buildGiftLines(orderOrNull.gifts || []);
    } else {
      $('#f_customer').value = '';
      $('#f_pet').value = 'dog';
      var initDate = prefDate || new Date();
      setDateInputFrom(initDate);
      var nowT = new Date();
      $('#f_time').value = J.pad(nowT.getHours()) + ':' + J.pad(nowT.getMinutes());
      $('#f_wholesale').checked = false;
      $('#f_phone1').value = '';
      $('#f_phone2').value = '';
      $('#f_email').value = '';
      $('#f_shipping').value = 0;
      $('#f_discount').value = 0;
      $('#f_loss').value = 0;
      $('#f_address').value = '';
      segSet('f_paid', false);   // default: unpaid
      segSet('f_shipped', false); // default: not sent
      buildProductLines([{ name: '', qty: 1, costPrice: 0, sellPrice: 0 }]);
      buildGiftLines([]);
    }

    // Prefill on customer select (autocomplete pick)
    $('#f_customer').oninput = function () {
      var name = this.value.trim().toLowerCase();
      var match = state.cache.customers.find(function (c) { return c.nameLower === name; });
      if (match) {
        if (!$('#f_phone1').value) $('#f_phone1').value = match.phone1 || '';
        if (!$('#f_phone2').value) $('#f_phone2').value = match.phone2 || '';
        if (!$('#f_email').value)  $('#f_email').value  = match.email  || '';
        if (!$('#f_address').value) $('#f_address').value = match.address || '';
      }
    };

    $$('#orderModal input[data-num]').forEach(formatNumInput);
    openModal('orderModal');
    $('#orderModal .modal-body').scrollTop = 0;
    requestAnimationFrame(function () { growAll($('#orderModal')); growAddress(); });
    setTimeout(function () { $('#f_customer').focus(); }, 60);
  }

  function buildProductLines(lines) {
    var host = $('#productLines');
    host.innerHTML = '';
    if (!lines || lines.length === 0) lines = [{ name: '', qty: 1, costPrice: 0, sellPrice: 0 }];
    lines.forEach(addProductLine);
    recomputeTotals();
  }
  // ---- Order lines (cards: full product name on top, numbers below) ----
  // Name field: a textarea that grows, so long Persian names are shown in full.
  function lineNameField(value, placeholder, onPick) {
    var ta = el('textarea', { class: 'ol-name', rows: '1', dir: 'auto', placeholder: placeholder, autocomplete: 'off', spellcheck: 'false' });
    ta.value = value || '';
    function grow() { if (!ta.offsetParent) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); }); // names are one line
    ta._grow = grow;
    attachSuggest(ta, function (q) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      return state.cache.products.filter(function (p) { return (p.nameLower || '').indexOf(q) !== -1; })
        .slice(0, 8).map(function (p) { return { label: p.name, sub: fmtMoney(p.defaultSell) + ' · stock ' + (num(p.stock) || 0), value: p.name }; });
    }, function () { grow(); if (onPick) onPick(); });
    return ta;
  }
  function growAddress() { var t = $('#f_address'); if (!t.offsetParent) return; t.style.height = 'auto'; t.style.height = Math.max(70, t.scrollHeight + 2) + 'px'; }
  function growAll(root) { $$('.ol-name', root).forEach(function (t) { if (t._grow) t._grow(); }); }
  function numField(label, value, cls) {
    var inp = el('input', { type: 'text', inputmode: 'decimal', 'data-num': '1', class: cls, value: value });
    return { input: inp, wrap: el('label', { class: 'ol-field' }, [el('span', {}, label), inp]) };
  }
  function addProductLine(line) {
    line = line || {};
    var row = el('div', { class: 'order-line' });
    var qty = numField('Qty', line.qty || 1, 'ol-qty');
    var cost = numField('Cost / unit', line.costPrice || 0, 'ol-cost');
    var sell = numField('Sell / unit', line.sellPrice || 0, 'ol-sell');
    var name = lineNameField(line.name, 'Product name', null);
    var prof = el('strong', { class: 'ol-profit' }, '0');
    var del = el('button', { type: 'button', class: 'ol-del', title: 'Remove', 'aria-label': 'Remove product', html: '<svg class="ico"><use href="#i-close"/></svg>', on: { click: function () { row.remove(); recomputeTotals(); } } });

    function fillFromCatalog() {
      var v = name.value.trim().toLowerCase();
      var match = state.cache.products.find(function (p) { return p.nameLower === v; });
      if (match) {
        if (!num(cost.input.value)) { cost.input.value = match.defaultCost; formatNumInput(cost.input); }
        if (!num(sell.input.value)) { sell.input.value = match.defaultSell; formatNumInput(sell.input); }
      }
      recomputeTotals();
    }
    name.addEventListener('input', fillFromCatalog);
    [qty, cost, sell].forEach(function (f) { f.input.addEventListener('input', recomputeTotals); });

    row.appendChild(el('div', { class: 'ol-top' }, [name, del]));
    row.appendChild(el('div', { class: 'ol-nums' }, [qty.wrap, cost.wrap, sell.wrap]));
    row.appendChild(el('div', { class: 'ol-foot' }, [el('span', {}, 'Line profit'), prof]));
    $('#productLines').appendChild(row);

    row._refresh = function () {
      var p = (num(sell.input.value) - num(cost.input.value)) * num(qty.input.value || 0);
      prof.textContent = fmtMoney(p);
      prof.classList.toggle('neg', p < 0);
    };
    row._refresh();
    name._grow();
  }
  function readProductLines() {
    return $$('#productLines .order-line').map(function (r) {
      return {
        name: $('.ol-name', r).value.trim(),
        qty: num($('.ol-qty', r).value) || 0,
        costPrice: num($('.ol-cost', r).value) || 0,
        sellPrice: num($('.ol-sell', r).value) || 0
      };
    }).filter(function (l) { return l.name && l.qty > 0; });
  }

  // Gift lines: free items sent with the order. They take stock and their cost
  // counts against profit, but the customer isn't charged and the invoice shows no price.
  function buildGiftLines(lines) {
    $('#giftLines').innerHTML = '';
    (lines || []).forEach(addGiftLine);
    syncGiftsBlock();
  }
  function syncGiftsBlock() {
    $('#giftsBlock').classList.toggle('hidden', $$('#giftLines .order-line').length === 0);
  }
  function addGiftLine(line) {
    line = line || {};
    var row = el('div', { class: 'order-line gift' });
    var qty = numField('Qty', line.qty || 1, 'ol-qty');
    var cost = numField('Cost / unit', line.costPrice || 0, 'ol-cost');
    var name = lineNameField(line.name, 'Gift item', null);
    var costOut = el('strong', { class: 'ol-profit neg' }, '0');
    var del = el('button', { type: 'button', class: 'ol-del', title: 'Remove', 'aria-label': 'Remove gift', html: '<svg class="ico"><use href="#i-close"/></svg>', on: { click: function () { row.remove(); syncGiftsBlock(); recomputeTotals(); } } });

    function fillFromCatalog() {
      var v = name.value.trim().toLowerCase();
      var match = state.cache.products.find(function (p) { return p.nameLower === v; });
      if (match && !num(cost.input.value)) { cost.input.value = match.defaultCost; formatNumInput(cost.input); }
      recomputeTotals();
    }
    name.addEventListener('input', fillFromCatalog);
    [qty, cost].forEach(function (f) { f.input.addEventListener('input', recomputeTotals); });

    row.appendChild(el('div', { class: 'ol-top' }, [name, del]));
    row.appendChild(el('div', { class: 'ol-nums two' }, [qty.wrap, cost.wrap]));
    row.appendChild(el('div', { class: 'ol-foot' }, [el('span', {}, 'Cost to you (free for the customer)'), costOut]));
    $('#giftLines').appendChild(row);

    row._refresh = function () {
      var c = num(cost.input.value) * num(qty.input.value || 0);
      costOut.textContent = c ? '−' + fmtMoney(c) : fmtMoney(0);
    };
    row._refresh();
    name._grow();
    syncGiftsBlock();
  }
  function readGiftLines() {
    return $$('#giftLines .order-line').map(function (r) {
      return {
        name: $('.ol-name', r).value.trim(),
        qty: num($('.ol-qty', r).value) || 0,
        costPrice: num($('.ol-cost', r).value) || 0
      };
    }).filter(function (l) { return l.name && l.qty > 0; });
  }

  // Suggestion list under a text field (product / customer names from your data).
  function attachSuggest(field, source, onPick) {
    var box = null, items = [], active = -1, picking = false;
    function close() { if (box) { box.remove(); box = null; } active = -1; }
    function pick(it) {
      field.value = it.value;
      close();
      picking = true;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      picking = false;
      if (onPick) onPick(it);
    }
    function paint() {
      if (box) $$('.sg-item', box).forEach(function (n, i) { n.classList.toggle('active', i === active); });
    }
    function open() {
      items = source(field.value);
      if (!items.length || (items.length === 1 && items[0].value === field.value)) { close(); return; }
      if (!box) {
        box = el('div', { class: 'suggest glass-strong', role: 'listbox' });
        field.parentNode.insertBefore(box, field.nextSibling);
      }
      box.innerHTML = '';
      items.forEach(function (it) {
        box.appendChild(el('button', { type: 'button', class: 'sg-item', dir: 'auto', on: {
          pointerdown: function (e) { e.preventDefault(); pick(it); }
        } }, [el('span', { class: 'sg-label' }, it.label), it.sub ? el('span', { class: 'sg-sub', dir: 'ltr' }, it.sub) : null]));
      });
      active = -1;
    }
    field.addEventListener('input', function () { if (!picking) open(); });
    field.addEventListener('blur', function () { setTimeout(close, 150); });
    field.addEventListener('keydown', function (e) {
      if (!box) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
  }

  function recomputeTotals() {
    var lines = readProductLines();
    var profit = 0, total = 0;
    lines.forEach(function (l) {
      profit += (l.sellPrice - l.costPrice) * l.qty;
      total  += l.sellPrice * l.qty;
    });
    var gifts = giftsCost({ gifts: readGiftLines() });
    var ship = num($('#f_shipping').value) || 0;
    var discount = num($('#f_discount').value) || 0;
    var loss = num($('#f_loss').value) || 0;
    total += ship - discount;
    profit -= discount + gifts + loss;
    $('#orderProfit').textContent   = fmtMoney(profit);
    $('#orderShipping').textContent = fmtMoney(ship);
    $('#orderDiscount').textContent = discount ? '−' + fmtMoney(discount) : fmtMoney(0);
    $('#orderGifts').textContent    = gifts ? '−' + fmtMoney(gifts) : fmtMoney(0);
    $('#orderLoss').textContent     = loss ? '−' + fmtMoney(loss) : fmtMoney(0);
    $('#orderTotal').textContent    = fmtMoney(total);
    // refresh per-row figures (in case)
    $$('#productLines .order-line, #giftLines .order-line').forEach(function (r) { if (r._refresh) r._refresh(); });
  }

  function submitOrderForm(e) {
    e.preventDefault();
    var name = $('#f_customer').value.trim();
    if (!name) { toast('Customer name is required', 'error'); return; }
    var rawDate = $('#f_date').value.trim();
    var d = state.formCalMode === 'jalali' ? J.parseJalali(rawDate) : J.parseGregorian(rawDate);
    if (!d) { toast('Date is invalid', 'error'); return; }
    var products = readProductLines();
    if (products.length === 0) { toast('Add at least one product', 'error'); return; }

    var order = {
      customerName: name,
      pet: $('#f_pet').value,
      date: J.isoFromDate(d),
      time: $('#f_time').value,
      isWholesale: $('#f_wholesale').checked,
      phone1: toEnglishDigits($('#f_phone1').value.trim()),
      phone2: toEnglishDigits($('#f_phone2').value.trim()),
      email:  $('#f_email').value.trim(),
      address: $('#f_address').value.trim(),
      shipping: num($('#f_shipping').value) || 0,
      discount: num($('#f_discount').value) || 0,
      loss: num($('#f_loss').value) || 0,
      paid: segGet('f_paid'),
      shipped: segGet('f_shipped'),
      products: products,
      gifts: readGiftLines()
    };
    if (state.editingOrderId != null) order.id = state.editingOrderId;

    // Guard against a double tap saving the same order twice (and taking the stock twice).
    var btn = $('#saveOrderBtn');
    if (btn.disabled) return;
    btn.disabled = true;
    DB.saveOrder(order).then(function () {
      closeModal('orderModal');
      toast(state.editingOrderId ? 'Order updated' : 'Order saved', 'ok');
      state.editingOrderId = null;
      render();
    }).catch(function (err) {
      toast('Save failed: ' + err.message, 'error');
    }).then(function () { btn.disabled = false; });
  }

  // ====== Wire up ======
  function bindGlobalHandlers() {
    window.addEventListener('hashchange', render);
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.addEventListener('click', function (e) { /* default anchor behavior */ });
    });
    $('#newOrderBtn').addEventListener('click', function () { openOrderForm(null); });

    // Theme toggle (light / dark) — persisted in localStorage
    syncThemeUi();
    $$('#themeToggle, .more-theme').forEach(function (b) { b.addEventListener('click', toggleTheme); });
    $('#orderForm').addEventListener('submit', submitOrderForm);
    function focusLast(host) { var n = $$(host + ' .ol-name'); if (n.length) { n[n.length - 1].focus(); n[n.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
    $('#addProductLine').addEventListener('click', function () { addProductLine({ name:'', qty:1, costPrice:0, sellPrice:0 }); recomputeTotals(); focusLast('#productLines'); });
    $('#addGiftLine').addEventListener('click', function () { addGiftLine({ name:'', qty:1, costPrice:0 }); recomputeTotals(); focusLast('#giftLines'); });
    // Customer name: suggestions from your contacts (name + phone).
    attachSuggest($('#f_customer'), function (q) {
      q = q.trim().toLowerCase();
      if (!q) return [];
      return state.cache.customers.filter(function (c) {
        return c.name && ((c.nameLower || '').indexOf(q) !== -1 || String(c.phone1 || '').indexOf(q) !== -1);
      }).slice(0, 8).map(function (c) { return { label: c.name, sub: [c.phone1, c.address].filter(Boolean).join(' · '), value: c.name }; });
    });
    $('#f_address').addEventListener('input', growAddress);
    $('#f_shipping').addEventListener('input', recomputeTotals);
    $('#f_discount').addEventListener('input', recomputeTotals);
    $('#f_loss').addEventListener('input', recomputeTotals);
    segWire('f_paid');
    segWire('f_shipped');
    $('#customerForm').addEventListener('submit', function (e) { e.preventDefault(); saveCustomerFromForm(); });
    $('#imp_preview').addEventListener('click', previewImportContacts);
    $('#imp_run').addEventListener('click', runImportContacts);
    $('#imp_file').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { $('#imp_text').value = reader.result || ''; previewImportContacts(); };
      reader.readAsText(f, 'utf-8');
    });
    $('#expenseForm').addEventListener('submit', function (e) { e.preventDefault(); saveExpenseFromForm(); });

    document.querySelectorAll('[data-close-modal]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.dataset.closeModal); });
    });
    document.querySelectorAll('.modal-backdrop').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m && !m.dataset.sticky) m.classList.add('hidden'); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop:not(.hidden):not([data-sticky])').forEach(function (m) { m.classList.add('hidden'); });
    });
    // Any Persian/Arabic digit typed into a text field becomes English immediately.
    // Digit conversion is 1:1 in length, so we can restore the caret position.
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
      if (t.type === 'number') return; // native number inputs already restrict digits
      var v = t.value;
      var nv = toEnglishDigits(v);
      if (nv !== v) {
        var s = t.selectionStart, en = t.selectionEnd;
        t.value = nv;
        try { t.setSelectionRange(s, en); } catch (err) {}
      }
    });
    $('#confirmOk').addEventListener('click', function () {
      closeModal('confirmModal');
      var cb = state.confirmCb; state.confirmCb = null;
      if (cb) cb();
    });
  }

  // ====== Theme ======
  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('appavet-theme', next); } catch (e) {}
    syncThemeUi();
    render(); // repaint so the canvas charts pick up the new theme colors
  }
  function syncThemeUi() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $$('#themeToggle use, .more-theme use').forEach(function (u) { u.setAttribute('href', dark ? '#i-sun' : '#i-moon'); });
    $$('.more-theme .lbl').forEach(function (l) { l.textContent = dark ? 'Light mode' : 'Dark mode'; });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#09090E' : '#EEF0F7');
  }

  // ====== Lock screen ======
  // The password unlocks this device; it also decrypts the saved GitHub token.
  var Lock = { unlocked: false, key: null, last: Date.now(), hiddenAt: 0, mode: '' };
  function autoLockMinutes() {
    var v = parseInt(localStorage.getItem('appavet-autolock') || '10', 10);
    return isNaN(v) ? 10 : v; // 0 = never
  }

  function showLock(msg) {
    Lock.unlocked = false;
    document.body.classList.add('locked');
    $('#lockScreen').classList.remove('hidden');
    if (!Sec.supported()) {
      $('#lockTitle').textContent = 'Secure page needed';
      $('#lockSub').textContent = 'Open Rumi from its https:// address (GitHub Pages) or from localhost. The password lock uses the browser’s encryption, which only works on secure pages.';
      $('#lockForm').classList.add('hidden'); $('#lockAlt').classList.add('hidden');
      return;
    }
    setLockMode(Sec.hasPassword() ? 'unlock' : 'setup', msg);
  }

  function setLockMode(mode, msg) {
    Lock.mode = mode;
    var setup = mode === 'setup', connect = mode === 'connect', unlock = mode === 'unlock';
    $('#lockConnect').classList.toggle('hidden', !connect);
    $('#lockPw2Wrap').classList.toggle('hidden', !setup);
    $('#lockReset').classList.toggle('hidden', !unlock);
    $('#lockTitle').textContent = setup ? 'Welcome to Rumi' : connect ? 'Connect this device' : 'Rumi';
    $('#lockSub').textContent = msg || (setup
      ? 'Create a password. You will need it every time you open the app on this device.'
      : connect
        ? 'Enter the GitHub repository that holds your data, a token for it, and the password you use on your other devices.'
        : 'Enter your password to unlock.');
    $('#lockPwLabel').textContent = setup ? 'New password (at least 6 characters)' : 'Password';
    $('#lockPw').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
    $('#lockBtn').textContent = setup ? 'Create password' : connect ? 'Connect & download' : 'Unlock';
    var alt = $('#lockAlt');
    alt.classList.toggle('hidden', unlock);
    alt.textContent = setup ? 'Already use Rumi on another device? Connect it' : 'Back';
    $('#lockErr').textContent = '';
    $('#lockPw').value = ''; $('#lockPw2').value = '';
    setTimeout(function () { (connect ? $('#lc_owner') : $('#lockPw')).focus(); }, 60);
  }

  function lockError(text) {
    $('#lockErr').textContent = text;
    var card = $('.lock-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }

  function submitLock(e) {
    e.preventDefault();
    var pw = $('#lockPw').value;
    var btn = $('#lockBtn');
    if (btn.disabled) return;
    function busy(on, label) { btn.disabled = on; if (label) btn.textContent = label; }
    if (Lock.mode === 'unlock') {
      if (!pw) return lockError('Enter your password.');
      busy(true, 'Checking…');
      Sec.unlock(pw).then(function (key) {
        busy(false, 'Unlock');
        if (key) unlocked(key); else { lockError('Wrong password.'); $('#lockPw').select(); }
      }, function (err) { busy(false, 'Unlock'); lockError(err.message); });
    } else if (Lock.mode === 'setup') {
      if (pw.length < 6) return lockError('Use at least 6 characters.');
      if (pw !== $('#lockPw2').value) return lockError('The two passwords are different.');
      busy(true, 'Saving…');
      Sec.setPassword(pw).then(function (key) { busy(false, 'Create password'); unlocked(key); toast('Password created', 'ok'); },
        function (err) { busy(false, 'Create password'); lockError(err.message); });
    } else {
      if (!pw) return lockError('Enter your password.');
      busy(true, 'Connecting…');
      Sync.connectNewDevice({
        owner: $('#lc_owner').value, repo: $('#lc_repo').value, path: $('#lc_path').value, token: $('#lc_token').value
      }, pw).then(function (key) {
        busy(false, 'Connect & download');
        $('#lc_token').value = '';
        unlocked(key, { first: true, force: true });
        toast('Connected — downloading your data', 'ok');
      }, function (err) { busy(false, 'Connect & download'); lockError(err.message); });
    }
  }

  function unlocked(key, syncOpts) {
    Lock.unlocked = true; Lock.key = key; Lock.last = Date.now();
    $('#lockPw').value = ''; $('#lockPw2').value = '';
    $('#lockScreen').classList.add('hidden');
    document.body.classList.remove('locked');
    Sync.setSession(key, syncOpts);
    refreshBackupStatus();
    render();
  }

  function lockNow() {
    if (!Sec.hasPassword()) return;
    $$('.modal-backdrop').forEach(function (m) { m.classList.add('hidden'); });
    $('#view').innerHTML = ''; $('#topbarActions').innerHTML = '';
    Lock.key = null;
    showLock();
  }

  function resetDevice() {
    if (!window.confirm('Reset this device?\n\nThis deletes ALL Rumi data stored in this browser and removes the password. ' +
        'Data that is already synced to GitHub stays there. This cannot be undone.')) return;
    ['appavet-auth', 'appavet-sync', 'appavet-sync-dirty'].forEach(function (k) { localStorage.removeItem(k); });
    var req = indexedDB.deleteDatabase('appavet');
    req.onsuccess = req.onerror = req.onblocked = function () { location.reload(); };
  }

  // Auto-lock after a few minutes without use (or in the background).
  function bindAutoLock() {
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, function () { Lock.last = Date.now(); }, { passive: true, capture: true });
    });
    function due(since) { var m = autoLockMinutes(); return Lock.unlocked && m > 0 && Date.now() - since > m * 60000; }
    setInterval(function () { if (due(Lock.last)) lockNow(); }, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') Lock.hiddenAt = Date.now();
      else if (Lock.hiddenAt && due(Lock.hiddenAt)) lockNow();
    });
  }

  // ====== Prompts used by sync ======
  function promptPassword(message) {
    return new Promise(function (resolve) {
      $('#pwText').textContent = message;
      $('#pwInput').value = '';
      openModal('pwModal');
      setTimeout(function () { $('#pwInput').focus(); }, 60);
      function done(v) { closeModal('pwModal'); $('#pwForm').onsubmit = null; $('#pwCancel').onclick = null; resolve(v); }
      $('#pwForm').onsubmit = function (e) { e.preventDefault(); done($('#pwInput').value); };
      $('#pwCancel').onclick = function () { done(null); };
    });
  }
  function choose(title, text, options) {
    return new Promise(function (resolve) {
      $('#choiceTitle').textContent = title;
      $('#choiceText').textContent = text;
      var box = $('#choiceButtons'); box.innerHTML = '';
      options.forEach(function (o) {
        box.appendChild(el('button', { class: 'btn block ' + (o.cls || ''), type: 'button', on: { click: function () { closeModal('choiceModal'); resolve(o.value); } } }, [
          el('span', { class: 'cb-label' }, o.label), o.hint ? el('span', { class: 'cb-hint' }, o.hint) : null
        ]));
      });
      openModal('choiceModal');
    });
  }
  function chooseFirstSync(info) {
    function d(x) { return x.orders + ' orders · ' + x.products + ' products · ' + x.customers + ' contacts'; }
    return choose('Both have data',
      'This device: ' + d(info.local) + '\nCloud file: ' + d(info.remote) + '\n\nHow should they be combined?', [
        { value: 'merge', label: 'Combine both', hint: 'Keeps every record; the newest edit wins', cls: 'primary' },
        { value: 'remote', label: 'Use the cloud copy', hint: 'Replaces what is on this device' },
        { value: 'local', label: 'Use this device', hint: 'Replaces the cloud file and other devices' }
      ]);
  }

  // ====== Sync status ======
  function fmtClock(iso) {
    if (!iso) return '';
    var d = new Date(iso), now = new Date();
    var t = J.pad(d.getHours()) + ':' + J.pad(d.getMinutes());
    return J.sameDay(d, now) ? t : (state.calMode === 'jalali' ? J.formatJalali(d) : J.formatGregorian(d)) + ' ' + t;
  }
  function syncText(st) {
    if (!st.configured) return { cls: 'off', text: 'Sync off', title: 'Cloud sync is off — tap to set it up' };
    if (st.state === 'syncing') return { cls: 'busy', text: 'Syncing…', title: 'Talking to GitHub' };
    if (st.state === 'error') return { cls: 'bad', text: 'Sync problem', title: st.message || 'Sync failed' };
    if (st.state === 'offline' || (!navigator.onLine)) return { cls: 'warn', text: st.pending ? 'Offline · saved here' : 'Offline', title: 'Changes are saved on this device and will sync when you are online' };
    if (st.state === 'locked') return { cls: 'off', text: 'Locked', title: 'Unlock to sync' };
    if (st.pending) return { cls: 'warn', text: 'Waiting to sync', title: 'Unsynced changes on this device' };
    return { cls: 'ok', text: st.lastSync ? 'Synced ' + fmtClock(st.lastSync) : 'Synced', title: 'Everything is saved to ' + st.repo };
  }
  function paintSyncStatus(st) {
    var t = syncText(st);
    $$('.sync-pill').forEach(function (p) {
      p.className = 'sync-pill ' + (p.classList.contains('compact') ? 'compact ' : '') + t.cls;
      p.title = t.title;
      p.querySelector('.txt').textContent = t.text;
    });
    var live = $('#syncLive');
    if (live) { live.textContent = t.text + (st.state === 'error' && st.message ? ' — ' + st.message : ''); live.className = 'sync-live ' + t.cls; }
  }

  // Re-render after another device's changes — but never under the user's fingers.
  var idleRenderTimer = null;
  function isEditing() {
    if ($$('.modal-backdrop:not(.hidden)').length) return true;
    var a = document.activeElement;
    return !!(a && a !== document.body && $('#view').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  function renderWhenIdle() {
    clearTimeout(idleRenderTimer);
    if (!Lock.unlocked) return;
    if (isEditing()) { idleRenderTimer = setTimeout(renderWhenIdle, 1500); return; }
    render();
  }

  // ====== Settings: sync / security / folder cards ======
  function infoRow(label, value) {
    return el('div', { class: 'kv-row' }, [el('span', { class: 'k' }, label), el('span', { class: 'v' }, value)]);
  }
  function inputField(label, input, hint) {
    return el('label', { class: 'field' }, [el('span', {}, label), input, hint ? el('small', { class: 'hint' }, hint) : null]);
  }

  function buildSyncCard() {
    var st = Sync.getStatus();
    var card = el('div', { class: 'card settings-card', id: 'syncCard' });
    card.appendChild(el('div', { class: 'card-title' }, [
      el('span', { class: 'ct-ico', html: '<svg class="ico"><use href="#i-cloud"/></svg>' }),
      el('div', {}, [el('h3', {}, 'Cloud sync (GitHub)'), el('div', { class: 'card-sub' }, 'Works offline; syncs every change when online')])
    ]));

    if (!st.configured) {
      var c = Sync.getConfig() || {};
      var inOwner = el('input', { type: 'text', autocomplete: 'off', placeholder: 'your-github-username', value: c.owner || '' });
      var inRepo  = el('input', { type: 'text', autocomplete: 'off', placeholder: 'Rumi', value: c.repo || '' });
      var inBranch = el('input', { type: 'text', autocomplete: 'off', placeholder: 'default branch' });
      var inPath  = el('input', { type: 'text', autocomplete: 'off', value: 'data/rumi-data.json' });
      var inToken = el('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' });
      var inEnc   = el('input', { type: 'checkbox' });
      var btn = el('button', { class: 'btn primary', type: 'button' }, 'Connect');
      btn.addEventListener('click', function () {
        btn.disabled = true; btn.textContent = 'Connecting…';
        Sync.connect({ owner: inOwner.value, repo: inRepo.value, branch: inBranch.value, path: inPath.value, token: inToken.value, encrypt: inEnc.checked ? 'always' : 'auto' })
          .then(function (r) { toast(r === 'pushed' ? 'Connected — your data is now in GitHub' : 'Connected and synced', 'ok'); render(); },
                function (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Connect'; });
      });
      card.appendChild(el('ol', { class: 'steps' }, [
        el('li', { html: 'Create a <b>private</b> repository on GitHub for the data, e.g. <code>Rumi</code>. (A public one works too — the file is then encrypted with your password.)' }),
        el('li', { html: 'Create a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>: <i>Only select repositories</i> → that repo → <i>Permissions → Contents: Read and write</i>.' }),
        el('li', {}, 'Fill this in and press Connect. On a new phone or tablet, use “Already use Rumi on another device?” on the first screen.')
      ]));
      card.appendChild(el('div', { class: 'grid two' }, [inputField('Owner', inOwner), inputField('Repository', inRepo)]));
      card.appendChild(el('div', { class: 'grid two' }, [inputField('File path', inPath), inputField('Branch', inBranch, 'Leave empty for the default branch')]));
      card.appendChild(inputField('Access token', inToken, 'Stored on this device only, encrypted with your password.'));
      card.appendChild(el('label', { class: 'field check inline' }, [inEnc, el('span', {}, 'Encrypt the file even in a private repository')]));
      card.appendChild(el('div', { class: 'settings-actions' }, btn));
      return card;
    }

    var fileUrl = 'https://github.com/' + st.repo + '/blob/' + encodeURIComponent(st.branch || 'main') + '/' + st.path;
    card.appendChild(el('div', { id: 'syncLive', class: 'sync-live' }, ''));
    card.appendChild(el('div', { class: 'kv-list' }, [
      infoRow('Repository', el('a', { href: 'https://github.com/' + st.repo, target: '_blank', rel: 'noopener' }, st.repo + (st.isPrivate ? ' (private)' : ' (public)'))),
      infoRow('Data file', el('a', { href: fileUrl, target: '_blank', rel: 'noopener' }, st.path)),
      infoRow('Format', st.encrypted ? '🔒 Encrypted with your password' : 'Readable JSON'),
      infoRow('Last synced', st.lastSync ? fmtClock(st.lastSync) : 'not yet')
    ]));
    var actions = el('div', { class: 'settings-actions' });
    var syncBtn = el('button', { class: 'btn primary', type: 'button' }, 'Sync now');
    syncBtn.addEventListener('click', function () {
      syncBtn.disabled = true;
      Sync.syncNow({ force: true }).then(function () { toast('Synced', 'ok'); }, function (err) { toast(err.message, 'error'); })
        .then(function () { syncBtn.disabled = false; });
    });
    actions.appendChild(syncBtn);
    if (st.isPrivate) {
      actions.appendChild(el('button', { class: 'btn', type: 'button', on: { click: function () {
        Sync.setEncrypt(st.encrypt === 'always' ? 'auto' : 'always').then(function () { toast('File format updated', 'ok'); render(); }, function (err) { toast(err.message, 'error'); });
      } } }, st.encrypt === 'always' ? 'Store as readable JSON' : 'Encrypt the file'));
    }
    actions.appendChild(el('button', { class: 'btn ghost', type: 'button', on: { click: function () {
      confirm('Disconnect cloud sync?', 'This device stops syncing. Your data stays here and in GitHub.', function () {
        Sync.disconnect(); toast('Sync disconnected', 'ok'); render();
      });
    } } }, 'Disconnect'));
    card.appendChild(actions);
    setTimeout(function () { paintSyncStatus(Sync.getStatus()); }, 0);
    return card;
  }

  function buildSecurityCard() {
    var card = el('div', { class: 'card settings-card' });
    card.appendChild(el('div', { class: 'card-title' }, [
      el('span', { class: 'ct-ico', html: '<svg class="ico"><use href="#i-lock"/></svg>' }),
      el('div', {}, [el('h3', {}, 'Password & lock'), el('div', { class: 'card-sub' }, 'Asked every time the app opens')])
    ]));
    var cur = el('input', { type: 'password', autocomplete: 'current-password' });
    var nw  = el('input', { type: 'password', autocomplete: 'new-password' });
    var nw2 = el('input', { type: 'password', autocomplete: 'new-password' });
    var btn = el('button', { class: 'btn', type: 'button' }, 'Change password');
    btn.addEventListener('click', function () {
      if (nw.value.length < 6) { toast('Use at least 6 characters', 'error'); return; }
      if (nw.value !== nw2.value) { toast('The new passwords are different', 'error'); return; }
      btn.disabled = true;
      Sec.unlock(cur.value).then(function (ok) {
        if (!ok) throw new Error('Current password is wrong');
        return Sec.setPassword(nw.value);
      }).then(function (key) {
        Lock.key = key;
        return Sync.rekey(key);
      }).then(function () {
        cur.value = nw.value = nw2.value = '';
        toast(Sync.isConfigured() ? 'Password changed — your other devices will ask for it once' : 'Password changed', 'ok');
      }, function (err) { toast(err.message, 'error'); }).then(function () { btn.disabled = false; });
    });
    var sel = el('select', {}, [[1, '1 minute'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never']].map(function (o) {
      return el('option', { value: String(o[0]) }, o[1]);
    }));
    sel.value = String(autoLockMinutes());
    sel.addEventListener('change', function () { localStorage.setItem('appavet-autolock', sel.value); toast('Auto-lock updated', 'ok'); });
    card.appendChild(el('div', { class: 'grid three' }, [inputField('Current password', cur), inputField('New password', nw), inputField('Repeat new', nw2)]));
    card.appendChild(el('div', { class: 'settings-actions split' }, [
      el('label', { class: 'field inline-select' }, [el('span', {}, 'Auto-lock after'), sel]),
      el('div', { class: 'row-gap' }, [btn, el('button', { class: 'btn ghost', type: 'button', on: { click: lockNow } }, 'Lock now')])
    ]));
    return card;
  }

  function buildMirrorCard() {
    var m = Sync.Mirror.state();
    var card = el('div', { class: 'card settings-card' });
    card.appendChild(el('div', { class: 'card-title' }, [
      el('span', { class: 'ct-ico', html: '<svg class="ico"><use href="#i-archive"/></svg>' }),
      el('div', {}, [el('h3', {}, 'Copy to a folder on this computer'), el('div', { class: 'card-sub' }, 'Every change is also written to a JSON file')])
    ]));
    if (!m.supported) {
      card.appendChild(el('p', { class: 'muted-text' }, 'Available in Chrome or Edge on a computer. On phones and tablets the GitHub file is the copy.'));
      return card;
    }
    var actions = el('div', { class: 'settings-actions' });
    if (!m.connected) {
      card.appendChild(el('p', { class: 'muted-text', html: 'Pick a folder (for example your project’s <code>data</code> folder). Rumi keeps <code>' + m.file + '</code> there up to date. It is plain JSON and listed in <code>.gitignore</code>, so it is never committed by accident.' }));
      actions.appendChild(el('button', { class: 'btn', type: 'button', on: { click: function () {
        Sync.Mirror.choose().then(function () { toast('Folder connected', 'ok'); render(); }, function (err) { if (err && err.name !== 'AbortError') toast(err.message, 'error'); });
      } } }, 'Choose folder'));
    } else {
      card.appendChild(el('div', { class: 'kv-list' }, [
        infoRow('Folder', m.name),
        infoRow('File', m.file),
        infoRow('Status', m.perm !== 'granted' ? 'Needs permission (click Reconnect)' : (m.error ? 'Error: ' + m.error : (m.lastWrite ? 'Saved ' + fmtClock(m.lastWrite) : 'Ready')))
      ]));
      if (m.perm !== 'granted') actions.appendChild(el('button', { class: 'btn primary', type: 'button', on: { click: function () { Sync.Mirror.reconnect().then(function () { render(); }); } } }, 'Reconnect'));
      else actions.appendChild(el('button', { class: 'btn', type: 'button', on: { click: function () { Sync.Mirror.write().then(function () { toast('Saved to folder', 'ok'); render(); }); } } }, 'Save now'));
      actions.appendChild(el('button', { class: 'btn ghost', type: 'button', on: { click: function () { Sync.Mirror.forget().then(function () { render(); }); } } }, 'Stop'));
    }
    card.appendChild(actions);
    return card;
  }

  // ====== Styled select lists ======
  // Every <select> gets a glass button; its list opens as a popover (or a bottom sheet
  // on phones). The real <select> stays in the page, hidden, so all existing code that
  // reads or sets .value and listens for 'change' keeps working.
  var SEL_VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  var SEL_INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  var csOpen = null; // { sel, btn, menu, scrim }

  function enhanceSelect(sel) {
    if (sel._cs || sel.multiple || sel.closest('.lock')) return;
    var btn = el('button', { type: 'button', class: 'cselect', 'aria-haspopup': 'listbox' }, [
      el('span', { class: 'cs-label' }),
      el('span', { html: '<svg class="ico cs-caret" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>' })
    ]);
    if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
    sel._cs = btn;
    sel.classList.add('cs-native');
    sel.tabIndex = -1;
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    function refresh() {
      var o = sel.options[SEL_INDEX.get.call(sel)];
      btn.querySelector('.cs-label').textContent = o ? o.textContent : '';
    }
    sel._csRefresh = refresh;
    // Keep the button label right when code sets the value directly.
    Object.defineProperty(sel, 'value', { configurable: true, get: function () { return SEL_VALUE.get.call(this); }, set: function (v) { SEL_VALUE.set.call(this, v); refresh(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: function () { return SEL_INDEX.get.call(this); }, set: function (v) { SEL_INDEX.set.call(this, v); refresh(); } });
    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, characterData: true });
    sel.addEventListener('change', refresh);
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (csOpen && csOpen.sel === sel) closeSelect(); else openSelect(sel); });
    refresh();
  }

  function openSelect(sel) {
    closeSelect();
    var btn = sel._cs;
    var phone = window.matchMedia('(max-width: 720px)').matches;
    var menu = el('div', { class: 'cs-menu glass-strong' + (phone ? ' as-sheet' : ''), role: 'listbox' });
    var scrim = null;
    if (phone) {
      scrim = el('div', { class: 'modal-backdrop cs-scrim', style: 'z-index:390' });
      document.body.appendChild(scrim);
      var lbl = sel.closest('label');
      var title = lbl && lbl.querySelector('span') ? lbl.querySelector('span').textContent : '';
      if (title) menu.appendChild(el('div', { class: 'cs-sheet-title' }, title));
    }
    var cur = SEL_INDEX.get.call(sel);
    Array.prototype.forEach.call(sel.options, function (o, i) {
      menu.appendChild(el('button', { type: 'button', class: 'cs-option' + (i === cur ? ' sel' : ''), role: 'option', on: { click: function () {
        if (i !== SEL_INDEX.get.call(sel)) {
          SEL_INDEX.set.call(sel, i);
          sel._csRefresh();
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeSelect();
        btn.focus();
      } } }, [el('span', {}, o.textContent), i === cur ? el('span', { html: '<svg class="ico" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>' }) : null]));
    });
    document.body.appendChild(menu);
    if (!phone) {
      var r = btn.getBoundingClientRect();
      menu.style.minWidth = Math.max(180, r.width) + 'px';
      var mh = menu.offsetHeight;
      var below = window.innerHeight - r.bottom;
      menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
      menu.style.top = (below < mh + 12 && r.top > below ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
    }
    btn.classList.add('open');
    csOpen = { sel: sel, btn: btn, menu: menu, scrim: scrim };
    var selEl = menu.querySelector('.cs-option.sel');
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }
  function closeSelect() {
    if (!csOpen) return;
    csOpen.menu.remove();
    if (csOpen.scrim) csOpen.scrim.remove();
    csOpen.btn.classList.remove('open');
    csOpen = null;
  }
  function bindSelects() {
    $$('select').forEach(enhanceSelect);
    document.addEventListener('pointerdown', function (e) {
      if (csOpen && !csOpen.menu.contains(e.target) && !csOpen.btn.contains(e.target)) closeSelect();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && csOpen) { e.stopImmediatePropagation(); closeSelect(); } }, true);
    window.addEventListener('resize', closeSelect);
    document.addEventListener('scroll', function (e) { if (csOpen && !csOpen.menu.contains(e.target)) closeSelect(); }, true);
  }

  // ====== Shell (mobile tab bar, More sheet, sync pill, number fields) ======
  function bindShellHandlers() {
    $('#lockForm').addEventListener('submit', submitLock);
    $('#lockAlt').addEventListener('click', function () {
      setLockMode(Lock.mode === 'setup' ? 'connect' : (Sec.hasPassword() ? 'unlock' : 'setup'));
    });
    $('#lockReset').addEventListener('click', resetDevice);
    $('#tabAdd').addEventListener('click', function () { openOrderForm(null); });
    $('#tabMore').addEventListener('click', function () { openModal('moreSheet'); });
    $$('.lock-now').forEach(function (b) { b.addEventListener('click', lockNow); });
    $$('.sync-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!Sync.isConfigured()) { navigate('settings'); return; }
        Sync.syncNow({ force: true }).catch(function (err) { toast(err.message, 'error'); });
      });
    });
    bindAutoLock();
    bindSelects();

    // Number fields: plain digits while typing, grouped (1,250,000) once you leave the field.
    document.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.num) t.value = toEnglishDigits(t.value).replace(/,/g, '');
    });
    document.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.num) formatNumInput(t);
    });
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('input[data-num]')) formatNumInput(n);
          if (n.matches && n.matches('select')) enhanceSelect(n);
          if (n.querySelectorAll) { $$('input[data-num]', n).forEach(formatNumInput); $$('select', n).forEach(enhanceSelect); }
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function registerServiceWorker() {
    // Service workers need a secure context (https) or localhost — they don't run
    // on file://. Register only where supported so the app still works either way.
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    // Each deploy stamps a new version into sw.js. A home-screen app is usually *resumed*,
    // not reloaded, so check for a new version whenever it comes back to the foreground
    // (and every 30 minutes) and reload into it as soon as you are not typing.
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; } // first install, nothing to update
      if (reloading) return;
      toast('Rumi was updated — reloading…', 'ok');
      (function waitIdle() {
        if (Lock.unlocked && isEditing()) { setTimeout(waitIdle, 2000); return; }
        reloading = true;
        location.reload();
      })();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        function check() { if (navigator.onLine) reg.update().catch(function () {}); }
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
        window.addEventListener('online', check);
        setInterval(check, 30 * 60000);
      }).catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  function start() {
    registerServiceWorker();
    bindGlobalHandlers();
    bindShellHandlers();
    Sync.init({
      onStatus: paintSyncStatus,
      onRemoteChange: renderWhenIdle,
      askPassword: promptPassword,
      chooseFirstSync: chooseFirstSync
    });
    DB.open().then(function () { return DB.getMeta('calMode'); }).then(function (m) {
      if (m === 'gregorian' || m === 'jalali') state.calMode = m;
      showLock();
    }).catch(function (err) {
      $('#lockSub').textContent = 'Could not open the local database: ' + (err && err.message || err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
