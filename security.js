// Password lock + encryption helpers (WebCrypto). Exposes window.Sec.
//
// The password is never stored. PBKDF2-SHA256 turns it into 512 bits:
//   - the first half, hashed, is the "verifier" used to check the password;
//   - the second half is an AES-GCM key that encrypts the GitHub token on this
//     device and, when the data repo is public, the synced data file itself.

(function () {
  'use strict';

  var AUTH_KEY = 'appavet-auth';
  var ITER = 210000;
  var enc = new TextEncoder(), dec = new TextDecoder();

  function supported() { return !!(window.crypto && crypto.subtle && window.isSecureContext !== false); }

  function b64(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function randomBytes(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; }

  // -> { verifier: base64, key: CryptoKey }
  function derive(password, saltB64, iter) {
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, 512);
      })
      .then(function (bits) {
        var b = new Uint8Array(bits);
        return Promise.all([
          crypto.subtle.digest('SHA-256', b.slice(0, 32)),
          crypto.subtle.importKey('raw', b.slice(32, 64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
        ]);
      })
      .then(function (r) { return { verifier: b64(r[0]), key: r[1] }; });
  }

  function getAuth() {
    try { var a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); return a && a.verifier ? a : null; }
    catch (e) { return null; }
  }
  function setAuth(a) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }
  function hasPassword() { return !!getAuth(); }

  // Check a password against an auth record (local or from the synced file).
  // Resolves to the AES key, or null when the password is wrong.
  function verify(auth, password) {
    if (!auth) return Promise.resolve(null);
    return derive(password, auth.salt, auth.iter || ITER).then(function (d) {
      return d.verifier === auth.verifier ? d.key : null;
    });
  }

  function createAuth(password) {
    var salt = b64(randomBytes(16));
    return derive(password, salt, ITER).then(function (d) {
      return { auth: { v: 1, salt: salt, iter: ITER, verifier: d.verifier, setAt: new Date().toISOString() }, key: d.key };
    });
  }

  function setPassword(password) {
    return createAuth(password).then(function (r) { setAuth(r.auth); return r.key; });
  }
  function unlock(password) { return verify(getAuth(), password); }

  function encryptText(key, text) {
    var iv = randomBytes(12);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text))
      .then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }
  function decryptText(key, box) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))
      .then(function (pt) { return dec.decode(pt); });
  }

  // Public part of the auth record (safe to put in the synced file).
  function publicAuth(a) {
    a = a || getAuth();
    return a ? { v: a.v || 1, salt: a.salt, iter: a.iter || ITER, verifier: a.verifier, setAt: a.setAt || '' } : null;
  }

  window.Sec = {
    supported: supported,
    hasPassword: hasPassword,
    getAuth: getAuth,
    setAuth: setAuth,
    publicAuth: publicAuth,
    setPassword: setPassword,
    createAuth: createAuth,
    unlock: unlock,
    verify: verify,
    encryptText: encryptText,
    decryptText: decryptText,
    b64: b64,
    unb64: unb64
  };
})();
