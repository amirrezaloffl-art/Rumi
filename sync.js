// Cloud sync through a JSON file in a GitHub repository + optional local-folder mirror.
// Exposes window.Sync.
//
// How it works
//  - Every device keeps the full dataset in IndexedDB, so the app works offline.
//  - Each local change marks the device "dirty" and schedules a push (debounced).
//  - A sync = download the file, merge record-by-record (newest `updatedAt` wins,
//    tombstones win over older records), save the merge locally, upload it if it
//    differs. A rejected upload (someone else pushed first) just triggers another round.
//  - When the repo is public the file is encrypted with the password key (AES-GCM);
//    in a private repo it is plain, readable JSON.

(function () {
  'use strict';

  var CFG_KEY = 'appavet-sync';
  var DIRTY_KEY = 'appavet-sync-dirty';
  var API = 'https://api.github.com';
  var PUSH_DELAY = 1500;
  var POLL_MS = 30000;

  var session = { key: null, prevKey: null, token: null };
  var hooks = { onRemoteChange: null, onStatus: null, askPassword: null, chooseFirstSync: null };
  var status = { state: 'off', message: '', lastSync: null };
  var running = null, again = false, pushTimer = null, pollTimer = null;

  // ---------------------------------------------------------------- config
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveConfig(c) {
    if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY);
  }
  function isConfigured() { var c = getConfig(); return !!(c && c.owner && c.repo && c.tokenBox); }
  function isDirty() { return localStorage.getItem(DIRTY_KEY) === '1'; }
  function setDirty(v) { if (v) localStorage.setItem(DIRTY_KEY, '1'); else localStorage.removeItem(DIRTY_KEY); }

  function setStatus(state, message) {
    status.state = state; status.message = message || '';
    var c = getConfig(); status.lastSync = c && c.lastSync || null;
    status.pending = isDirty();
    if (hooks.onStatus) hooks.onStatus(getStatus());
  }
  function getStatus() {
    var c = getConfig();
    return {
      state: status.state, message: status.message, pending: isDirty(),
      lastSync: c && c.lastSync || null, configured: isConfigured(),
      encrypted: !!(c && shouldEncrypt(c)), repo: c ? c.owner + '/' + c.repo : '', path: c ? c.path : '',
      branch: c ? c.branch : '', isPrivate: c ? !!c.isPrivate : false, encrypt: c ? c.encrypt || 'auto' : 'auto',
      mirror: Mirror.state()
    };
  }
  function shouldEncrypt(c) { return c.encrypt === 'always' || !c.isPrivate; }

  // ---------------------------------------------------------------- helpers
  function utf8ToB64(text) { return Sec.b64(new TextEncoder().encode(text)); }
  function b64ToUtf8(b) { return new TextDecoder().decode(Sec.unb64(String(b).replace(/\s/g, ''))); }

  // Deterministic JSON so "did anything change?" is a string compare.
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function dataPart(d) {
    var out = { settings: d.settings || null, tombstones: d.tombstones || {} };
    DB.STORES.forEach(function (s) { out[s] = (d[s] || []).slice().sort(function (a, b) { return a.id - b.id; }); });
    return out;
  }
  function sameData(a, b) { return stable(dataPart(a)) === stable(dataPart(b)); }

  function deviceLabel() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Mac/.test(ua)) return 'Mac';
    return 'browser';
  }

  // ---------------------------------------------------------------- merge (pure)
  function ts(r) { return String((r && (r.updatedAt || r.createdAt)) || ''); }
  function newer(a, b) {
    var ta = ts(a), tb = ts(b);
    if (ta !== tb) return ta > tb ? a : b;
    return stable(a) >= stable(b) ? a : b; // deterministic tie-break
  }
  function merge(a, b) {
    a = a || {}; b = b || {};
    var out = { tombstones: {} };
    // tombstones: union, keep latest delete time
    [a.tombstones || {}, b.tombstones || {}].forEach(function (tb) {
      Object.keys(tb).forEach(function (s) {
        var dst = out.tombstones[s] = out.tombstones[s] || {};
        Object.keys(tb[s] || {}).forEach(function (id) {
          if (!dst[id] || tb[s][id] > dst[id]) dst[id] = tb[s][id];
        });
      });
    });
    DB.STORES.forEach(function (s) {
      var map = {};
      (a[s] || []).concat(b[s] || []).forEach(function (r) {
        if (!r || r.id == null) return;
        map[r.id] = map[r.id] ? newer(map[r.id], r) : r;
      });
      // copy, so renumbering below never mutates the inputs we compare against
      Object.keys(map).forEach(function (k) { map[k] = JSON.parse(JSON.stringify(map[k])); });
      var tomb = out.tombstones[s] || {};
      out[s] = Object.keys(map).map(function (k) { return map[k]; })
        .filter(function (r) { return !(tomb[r.id] && tomb[r.id] >= ts(r)); })
        .sort(function (x, y) { return x.id - y.id; });
      // a record edited after its delete "revives" it — drop that tombstone
      Object.keys(tomb).forEach(function (id) { if (map[id] && tomb[id] < ts(map[id])) delete tomb[id]; });
    });
    var sa = a.settings, sb = b.settings;
    out.settings = !sa ? (sb || null) : !sb ? sa : (String(sa.updatedAt || '') >= String(sb.updatedAt || '') ? sa : sb);
    renumberOrders(out.orders);
    return out;
  }
  // "Keep this copy": `keep` wins outright; records only in `drop` are deleted everywhere.
  function replaceWith(keep, drop) {
    var t = new Date().toISOString();
    var out = merge(keep, null);
    DB.STORES.forEach(function (s) {
      var have = {};
      out[s].forEach(function (r) { have[r.id] = true; r.updatedAt = t; });
      ((drop && drop[s]) || []).forEach(function (r) {
        if (!have[r.id]) (out.tombstones[s] = out.tombstones[s] || {})[r.id] = t;
      });
    });
    if (out.settings) out.settings = { value: out.settings.value, updatedAt: t };
    return out;
  }
  // Two devices offline can both create "order #42". Keep the earliest, renumber the rest.
  function renumberOrders(orders) {
    var max = orders.reduce(function (m, o) { return Math.max(m, Number(o.no) || 0); }, 0);
    var seen = {};
    orders.slice().sort(function (x, y) {
      return String(x.createdAt || '').localeCompare(String(y.createdAt || '')) || x.id - y.id;
    }).forEach(function (o) {
      var n = Number(o.no) || 0;
      if (!n || seen[n]) {
        o.no = ++max; o.updatedAt = new Date().toISOString();
        seen[o.no] = true;
      } else seen[n] = true;
    });
  }

  // ---------------------------------------------------------------- GitHub client
  function gh(method, path, body, extra) {
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + session.token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (extra) for (var k in extra) headers[k] = extra[k];
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(API + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  }
  function apiError(res, what) {
    return res.text().then(function (t) {
      var msg = '';
      try { msg = JSON.parse(t).message || ''; } catch (e) { msg = t.slice(0, 120); }
      var e = new Error(what + ' failed (' + res.status + (msg ? ': ' + msg : '') + ')');
      e.status = res.status;
      throw e;
    });
  }
  function contentsPath(c) {
    return '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' +
      String(c.path || 'data/rumi-data.json').split('/').map(encodeURIComponent).join('/');
  }
  function getRepo(c) {
    return gh('GET', '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo)).then(function (res) {
      if (!res.ok) return apiError(res, 'Opening the repository');
      return res.json();
    });
  }
  // -> null (no file yet) | { notModified: true } | { sha, etag, text }
  function getFile(c, etag) {
    var extra = etag ? { 'If-None-Match': etag } : null;
    return gh('GET', contentsPath(c) + '?ref=' + encodeURIComponent(c.branch || 'main'), null, extra).then(function (res) {
      if (res.status === 304) return { notModified: true };
      if (res.status === 404) return null;
      if (!res.ok) return apiError(res, 'Downloading the data file');
      var newEtag = res.headers.get('ETag');
      return res.json().then(function (j) {
        if (j.encoding === 'base64' && j.content) return { sha: j.sha, etag: newEtag, text: b64ToUtf8(j.content) };
        // Files over 1 MB come without content — fetch the blob instead.
        return gh('GET', '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/git/blobs/' + j.sha).then(function (r2) {
          if (!r2.ok) return apiError(r2, 'Downloading the data file');
          return r2.json().then(function (b) { return { sha: j.sha, etag: newEtag, text: b64ToUtf8(b.content) }; });
        });
      });
    });
  }
  function putFile(c, text, sha, message) {
    var body = { message: message, content: utf8ToB64(text), branch: c.branch || 'main' };
    if (sha) body.sha = sha;
    return gh('PUT', contentsPath(c), body).then(function (res) {
      if (res.status === 409 || res.status === 422) { var e = new Error('conflict'); e.conflict = true; throw e; }
      if (!res.ok) return apiError(res, 'Uploading the data file');
      return res.json().then(function (j) { return j.content && j.content.sha; });
    });
  }

  // ---------------------------------------------------------------- file format
  function buildFile(data, encrypt) {
    var auth = Sec.publicAuth();
    var plain = {
      appavet: true, schemaVersion: DB.SCHEMA_VERSION, updatedAt: new Date().toISOString(),
      updatedBy: deviceLabel(), auth: auth, settings: data.settings || null, tombstones: data.tombstones || {}
    };
    DB.STORES.forEach(function (s) { plain[s] = data[s] || []; });
    if (!encrypt) return Promise.resolve(JSON.stringify(plain, null, 2));
    var inner = JSON.stringify(dataPart(data));
    return Sec.encryptText(session.key, inner).then(function (box) {
      return JSON.stringify({
        appavet: true, encrypted: true, schemaVersion: DB.SCHEMA_VERSION, updatedAt: plain.updatedAt,
        updatedBy: plain.updatedBy, auth: auth, cipher: 'AES-256-GCM/PBKDF2-SHA256', iv: box.iv, ct: box.ct
      }, null, 2);
    });
  }
  // -> { data, auth }
  function readFile(text, key) {
    var j = JSON.parse(text);
    if (!j || j.appavet !== true) throw new Error('The file in the repository is not a Rumi data file.');
    if (Number(j.schemaVersion || 0) > DB.SCHEMA_VERSION) throw new Error('The cloud data was saved by a newer Rumi. Reload the app to update it.');
    if (!j.encrypted) return Promise.resolve({ data: DB.upgradeData(j), auth: j.auth || null });
    return Sec.decryptText(key, { iv: j.iv, ct: j.ct }).then(function (t) {
      var d = JSON.parse(t); d.schemaVersion = j.schemaVersion;
      return { data: DB.upgradeData(d), auth: j.auth || null };
    }, function () {
      var e = new Error('wrong-key'); e.wrongKey = true; e.auth = j.auth; throw e;
    });
  }

  // ---------------------------------------------------------------- password changes across devices
  // Remote auth differs from ours. Newer one wins; adopting needs the other password once.
  function reconcileAuth(remoteAuth) {
    var local = Sec.getAuth();
    if (!remoteAuth || !remoteAuth.verifier) return Promise.resolve(false);
    if (local && local.verifier === remoteAuth.verifier) return Promise.resolve(false);
    if (local && String(local.setAt || '') > String(remoteAuth.setAt || '')) return Promise.resolve(false); // ours is newer: push it
    return askAndAdopt(remoteAuth, 'The password was changed on another device. Enter the new password to keep syncing.');
  }
  function askAndAdopt(remoteAuth, message) {
    if (!hooks.askPassword) return Promise.reject(new Error('Password needed'));
    function attempt(msg) {
      return hooks.askPassword(msg).then(function (pw) {
        if (pw == null) { var e = new Error('Sync paused until the password is entered.'); e.paused = true; throw e; }
        return Sec.verify(remoteAuth, pw).then(function (key) {
          if (!key) return attempt('That password did not match. Try again.');
          Sec.setAuth(remoteAuth);
          session.key = key;
          return storeToken(session.token).then(function () { return true; });
        });
      });
    }
    return attempt(message);
  }

  function storeToken(token) {
    var c = getConfig(); if (!c) return Promise.resolve();
    return Sec.encryptText(session.key, token).then(function (box) { c.tokenBox = box; saveConfig(c); });
  }

  // ---------------------------------------------------------------- the sync round
  function syncNow(opts) {
    opts = opts || {};
    if (running) { again = true; return running; }
    running = round(opts, 0).then(function (r) {
      running = null;
      if (again) { again = false; return syncNow(); }
      return r;
    }, function (err) {
      running = null; again = false;
      throw err;
    });
    return running;
  }

  function round(opts, attempt) {
    var c = getConfig();
    if (!c || !c.tokenBox) { setStatus('off'); return Promise.resolve('off'); }
    if (!session.token) { setStatus('locked', 'Unlock to sync'); return Promise.resolve('locked'); }
    if (!navigator.onLine) { setStatus('offline', isDirty() ? 'Changes saved on this device — will sync when online' : 'Offline'); return Promise.resolve('offline'); }
    setStatus('syncing');
    var seq0 = DB.writeSeq();
    var useEtag = !opts.force && !isDirty() && c.etag && !opts.first;
    return getFile(c, useEtag ? c.etag : null).then(function (remote) {
      if (remote && remote.notModified) return finish(c, null, 'unchanged');
      var remoteP = remote
        ? readFile(remote.text, session.key).catch(function (e) {
            if (!e.wrongKey) throw e;
            // We changed the password here; the cloud copy still uses the old one.
            if (session.prevKey) return readFile(remote.text, session.prevKey);
            throw e;
          }).catch(function (e) {
            if (!e.wrongKey) throw e;
            return askAndAdopt(e.auth, 'This data is locked with a different password. Enter the password used on your other devices.')
              .then(function () { return readFile(remote.text, session.key); });
          })
        : Promise.resolve(null);
      return remoteP.then(function (parsed) {
        return (parsed ? reconcileAuth(parsed.auth) : Promise.resolve(false)).then(function () {
          return DB.exportAll().then(function (local) {
            return decideFirst(opts, local, parsed && parsed.data).then(function (choice) {
              var remoteData = parsed && parsed.data;
              var merged;
              if (choice === 'remote') merged = replaceWith(remoteData, local);
              else if (choice === 'local') merged = replaceWith(local, remoteData);
              else if (!remoteData) merged = merge(local, null);
              else merged = merge(local, remoteData);
              var localChanged = !sameData(local, merged);
              var authOutdated = parsed && (!parsed.auth || parsed.auth.verifier !== (Sec.getAuth() || {}).verifier);
              var remoteChanged = !remoteData || !sameData(remoteData, merged) || authOutdated ||
                (parsed && !!JSON.parse(remote.text).encrypted !== shouldEncrypt(c));
              // A local edit landed while we were downloading: start over with fresh data.
              if (DB.writeSeq() !== seq0) return round(opts, attempt);
              var applyP = localChanged ? DB.applyData(merged) : Promise.resolve();
              return applyP.then(function () {
                if (localChanged) { Mirror.schedule(); if (hooks.onRemoteChange) hooks.onRemoteChange(); }
                if (!remoteChanged) {
                  c.etag = remote && remote.etag; c.sha = remote && remote.sha;
                  return finish(c, seq0, localChanged ? 'pulled' : 'unchanged');
                }
                return buildFile(merged, shouldEncrypt(c)).then(function (text) {
                  var msg = 'Rumi: update from ' + deviceLabel() + ' (' + merged.orders.length + ' orders)';
                  return putFile(c, text, remote && remote.sha, msg);
                }).then(function (sha) {
                  session.prevKey = null;
                  c.sha = sha; c.etag = null; // next poll does a full GET once, then ETags again
                  return finish(c, seq0, 'pushed');
                });
              });
            });
          });
        });
      });
    }).catch(function (err) {
      if (err.conflict && attempt < 4) {
        return new Promise(function (r) { setTimeout(r, 600 * (attempt + 1)); }).then(function () { return round(opts, attempt + 1); });
      }
      if (err.paused) { setStatus('error', err.message); return 'paused'; }
      if (!navigator.onLine || err instanceof TypeError) { setStatus('offline', 'Offline — changes are saved on this device'); return 'offline'; }
      setStatus('error', err.message || String(err));
      throw err;
    });
  }

  function decideFirst(opts, local, remote) {
    if (!opts.first || !remote) return Promise.resolve('merge');
    var localHas = DB.STORES.some(function (s) { return (local[s] || []).length; });
    var remoteHas = DB.STORES.some(function (s) { return (remote[s] || []).length; });
    if (!localHas || !remoteHas || sameData(local, remote) || !hooks.chooseFirstSync) return Promise.resolve('merge');
    return hooks.chooseFirstSync({
      local: { orders: local.orders.length, products: local.products.length, customers: local.customers.length },
      remote: { orders: remote.orders.length, products: remote.products.length, customers: remote.customers.length }
    });
  }

  function finish(c, seq0, result) {
    c.lastSync = new Date().toISOString();
    saveConfig(c);
    if (seq0 != null && DB.writeSeq() === seq0) setDirty(false);
    setStatus('idle', result);
    if (isDirty()) schedulePush();
    return result;
  }

  // ---------------------------------------------------------------- scheduling
  function schedulePush() {
    if (!isConfigured()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { syncNow().catch(function () {}); }, PUSH_DELAY);
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') syncNow().catch(function () {});
    }, POLL_MS);
  }

  // ---------------------------------------------------------------- public API
  function init(h) {
    for (var k in h) hooks[k] = h[k];
    DB.onChange(function () {
      if (isConfigured()) { setDirty(true); setStatus(status.state === 'off' ? 'idle' : status.state); schedulePush(); }
      Mirror.schedule();
    });
    window.addEventListener('online', function () { syncNow().catch(function () {}); });
    window.addEventListener('offline', function () { setStatus('offline', isDirty() ? 'Changes saved on this device — will sync when online' : 'Offline'); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') syncNow().catch(function () {});
    });
    setStatus(isConfigured() ? 'locked' : 'off');
  }

  // Called after unlock with the password-derived key.
  function setSession(key, opts) {
    session.key = key;
    var c = getConfig();
    Mirror.restore();
    if (!c || !c.tokenBox) { setStatus('off'); return Promise.resolve(); }
    return Sec.decryptText(key, c.tokenBox).then(function (tok) {
      session.token = tok;
      startPolling();
      return syncNow(opts).catch(function () {});
    }, function () {
      setStatus('error', 'Could not read the saved GitHub token — reconnect in Settings.');
    });
  }
  function rekey(newKey) { // local password changed
    session.prevKey = session.key;
    session.key = newKey;
    var p = session.token ? storeToken(session.token) : Promise.resolve();
    return p.then(function () { if (isConfigured()) { setDirty(true); schedulePush(); } });
  }

  // Connect a repo. cfg: { owner, repo, branch, path, token, encrypt }
  function connect(cfg) {
    if (!session.key) return Promise.reject(new Error('Unlock first'));
    var c = {
      owner: String(cfg.owner || '').trim(), repo: String(cfg.repo || '').trim(),
      branch: String(cfg.branch || '').trim() || 'main',
      path: String(cfg.path || '').trim().replace(/^\/+/, '') || 'data/rumi-data.json',
      encrypt: cfg.encrypt === 'always' ? 'always' : 'auto'
    };
    if (!c.owner || !c.repo) return Promise.reject(new Error('Enter the repository owner and name.'));
    if (!cfg.token) return Promise.reject(new Error('Paste a GitHub access token.'));
    session.token = String(cfg.token).trim();
    return getRepo(c).then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) throw new Error('This token can read the repository but not write to it. Give it "Contents: Read and write".');
      c.isPrivate = !!repo.private;
      if (!cfg.branch && repo.default_branch) c.branch = repo.default_branch;
      return Sec.encryptText(session.key, session.token);
    }).then(function (box) {
      c.tokenBox = box;
      saveConfig(c);
      setDirty(true);
      startPolling();
      return syncNow({ first: true, force: true });
    }).catch(function (e) {
      if (!getConfig() || !getConfig().tokenBox) session.token = null;
      throw e;
    });
  }
  function disconnect() {
    clearInterval(pollTimer); clearTimeout(pushTimer);
    session.token = null;
    saveConfig(null); setDirty(false);
    setStatus('off');
  }
  function setEncrypt(mode) {
    var c = getConfig(); if (!c) return;
    c.encrypt = mode === 'always' ? 'always' : 'auto';
    saveConfig(c); setDirty(true);
    return syncNow({ force: true });
  }
  // A brand-new device: pull everything with just repo + token + password (from the lock screen).
  // Returns the adopted key.
  function connectNewDevice(cfg, password) {
    var c = {
      owner: String(cfg.owner || '').trim(), repo: String(cfg.repo || '').trim(),
      branch: String(cfg.branch || '').trim(), path: String(cfg.path || '').trim().replace(/^\/+/, '') || 'data/rumi-data.json',
      encrypt: cfg.encrypt === 'always' ? 'always' : 'auto'
    };
    session.token = String(cfg.token || '').trim();
    if (!c.owner || !c.repo || !session.token) return Promise.reject(new Error('Fill in the repository and the token.'));
    return getRepo(c).then(function (repo) {
      c.isPrivate = !!repo.private;
      if (!c.branch) c.branch = repo.default_branch || 'main';
      return getFile(c, null);
    }).then(function (remote) {
      var auth = null;
      if (remote) { try { auth = JSON.parse(remote.text).auth || null; } catch (e) { throw new Error('The data file in the repository is not valid JSON.'); } }
      if (auth && auth.verifier) {
        return Sec.verify(auth, password).then(function (key) {
          if (!key) throw new Error('Wrong password for this data.');
          Sec.setAuth(auth);
          return key;
        });
      }
      return Sec.setPassword(password); // no file (or no password in it) yet: this password becomes the one
    }).then(function (key) {
      session.key = key;
      return Sec.encryptText(key, session.token).then(function (box) {
        c.tokenBox = box; saveConfig(c);
        return key;
      });
    }).catch(function (e) { session.token = null; throw e; });
  }

  // ---------------------------------------------------------------- local folder mirror (desktop Chrome / Edge)
  var Mirror = (function () {
    var handle = null, perm = 'none', timer = null, lastWrite = null, err = '';
    var FILE = 'rumi-data.local.json';
    function supported() { return typeof window.showDirectoryPicker === 'function'; }
    function state() { return { supported: supported(), connected: !!handle, perm: perm, name: handle ? handle.name : '', lastWrite: lastWrite, file: FILE, error: err }; }
    function emit() { if (hooks.onStatus) hooks.onStatus(getStatus()); }
    function restore() {
      if (!supported()) return Promise.resolve();
      return DB.getMeta('mirrorDir').then(function (h) {
        if (!h) return;
        handle = h;
        return h.queryPermission({ mode: 'readwrite' }).then(function (p) { perm = p; emit(); if (p === 'granted') schedule(); });
      }).catch(function () {});
    }
    function choose() {
      return window.showDirectoryPicker({ mode: 'readwrite', id: 'appavet-data' }).then(function (h) {
        handle = h; perm = 'granted';
        return DB.setMeta('mirrorDir', h).then(function () { return write(); });
      });
    }
    function reconnect() {
      if (!handle) return choose();
      return handle.requestPermission({ mode: 'readwrite' }).then(function (p) { perm = p; emit(); if (p === 'granted') return write(); });
    }
    function forget() { handle = null; perm = 'none'; return DB.setMeta('mirrorDir', null).then(emit); }
    function schedule() {
      if (!handle || perm !== 'granted') return;
      clearTimeout(timer);
      timer = setTimeout(function () { write().catch(function () {}); }, 800);
    }
    function write() {
      if (!handle || perm !== 'granted') return Promise.resolve();
      return DB.exportAll().then(function (data) {
        return handle.getFileHandle(FILE, { create: true }).then(function (fh) {
          return fh.createWritable().then(function (w) {
            return w.write(JSON.stringify(data, null, 2)).then(function () { return w.close(); });
          });
        });
      }).then(function () { lastWrite = new Date().toISOString(); err = ''; emit(); },
              function (e) { err = e.message || String(e); emit(); });
    }
    return { supported: supported, state: state, restore: restore, choose: choose, reconnect: reconnect, forget: forget, schedule: schedule, write: write };
  })();

  window.Sync = {
    init: init,
    setSession: setSession,
    rekey: rekey,
    connect: connect,
    connectNewDevice: connectNewDevice,
    disconnect: disconnect,
    setEncrypt: setEncrypt,
    syncNow: syncNow,
    schedulePush: schedulePush,
    getConfig: getConfig,
    getStatus: getStatus,
    isConfigured: isConfigured,
    lock: function () { /* keeps syncing in the background; nothing to clear */ },
    merge: merge,
    Mirror: Mirror
  };
})();
