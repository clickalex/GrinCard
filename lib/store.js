/*!
 * store.js — where V1 keeps its data (§5.1, §10.1).
 *
 * Two sources, merged at read time:
 *
 *   1. `profile-data/*.json` in the repo — static, works on GitHub Pages,
 *      version-controlled, and is what a self-hoster edits by hand.
 *   2. localStorage — what the dashboard writes when you edit a profile,
 *      mint a temporary token, or approve a follower.
 *
 * localStorage wins on conflict, so you can play with the demo without editing
 * files. "Reset demo data" clears it again.
 *
 * V2 replaces this module with an API client; nothing else has to change,
 * because every page talks to the store instead of to fetch() directly.
 */
(function (root, factory) {
  var AccessRules = (typeof module === 'object' && module.exports) ? require('./access.js') : root.AccessRules;
  var api = factory(AccessRules);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== 'undefined' ? self : this, function (AccessRules) {
  'use strict';

  var KEY_PREFIX = 'qrlinkcard.v1.';
  var KEY_PROFILE = KEY_PREFIX + 'profile.';   // + username
  var KEY_TOKENS = KEY_PREFIX + 'tokens.';     // + username
  var KEY_VIEWER = KEY_PREFIX + 'viewer';      // who am I, for the follower demo
  var KEY_LAST = KEY_PREFIX + 'lastUsername';

  var memory = {};   // used when localStorage is unavailable (private mode, file://)

  function ls() {
    try {
      if (typeof localStorage === 'undefined') return null;
      var probe = KEY_PREFIX + 'probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  function read(key) {
    var store = ls();
    var raw = store ? store.getItem(key) : memory[key];
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function write(key, value) {
    var store = ls();
    var raw = JSON.stringify(value);
    if (store) {
      try { store.setItem(key, raw); return true; } catch (e) { /* quota: fall through */ }
    }
    memory[key] = raw;
    return false;
  }

  function remove(key) {
    var store = ls();
    if (store) store.removeItem(key);
    delete memory[key];
  }

  // ---------------------------------------------------------------------------
  // Fetching the static files
  // ---------------------------------------------------------------------------

  /**
   * Resolve a repo-relative path from the current page. Pages are served both as
   * `/card-builder/` (a directory URL, where pathname ends in "/") and as
   * `/demo/profile.html`, so this normalises before walking up.
   */
  function pageRelative(relPath) {
    if (typeof location === 'undefined') return relPath;
    var path = location.pathname;
    if (path.charAt(path.length - 1) === '/') path += 'index.html';
    return path.replace(/[^/]*$/, '') + relPath;
  }

  function dataDir() {
    if (typeof document === 'undefined') return 'profile-data/';
    // Works from /demo/, /dashboard/ or the repo root.
    var depth = (document.body && document.body.getAttribute('data-base-depth')) || null;
    if (depth) return '../'.repeat(parseInt(depth, 10)) + 'profile-data/';
    var path = location.pathname.replace(/[^/]*$/, '');
    if (/\/demo\/?$/.test(path)) return '../profile-data/';
    if (/\/(dashboard|card-builder|qr-generator)\/?$/.test(path)) return '../profile-data/';
    return 'profile-data/';
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
        return res.json();
      });
  }

  function fetchQuiet(url) {
    return fetchJson(url).catch(function () { return null; });
  }

  /** Every profile the static directory knows about (best effort). */
  function listProfiles() {
    return Promise.all([
      fetchQuiet(dataDir() + 'rahul123.json'),
      fetchQuiet(dataDir() + 'meera9.json'),
      fetchQuiet(dataDir() + 'demo-template.json')
    ]).then(function (list) {
      return list.filter(Boolean).map(function (p) {
        return { username: p.username, display_name: p.display_name, designation: p.designation };
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------

  /**
   * Load a profile: localStorage first, then the static file.
   * Resolves to null when neither exists (the caller renders a 404 state).
   */
  function loadProfile(username) {
    var local = read(KEY_PROFILE + username);
    if (local) {
      local._source = 'local';
      write(KEY_LAST, local.username || username);
      return Promise.resolve(local);
    }
    return fetchQuiet(dataDir() + encodeURIComponent(username) + '.json').then(function (remote) {
      if (!remote) return null;
      remote._source = 'repo';
      write(KEY_LAST, remote.username || username);
      return remote;
    });
  }

  /** Save a profile locally (what the dashboard's Save button does). */
  function saveProfile(profile) {
    var v = AccessRules.validateProfile(profile);
    if (!v.ok) return { ok: false, errors: v.errors };
    var clean = v.profile;
    delete clean._source;
    var persisted = write(KEY_PROFILE + clean.username, clean);
    write(KEY_LAST, clean.username);
    return { ok: true, profile: clean, errors: [], warnings: v.warnings, persisted: persisted };
  }

  function deleteLocalProfile(username) { remove(KEY_PROFILE + username); }
  function hasLocalProfile(username) { return !!read(KEY_PROFILE + username); }

  // ---------------------------------------------------------------------------
  // Token + follower registries
  // ---------------------------------------------------------------------------

  /**
   * Load and merge the registry for one profile. Local entries win, because a
   * token minted in this browser must work in this browser.
   */
  function loadRegistry(username) {
    var local = read(KEY_TOKENS + username) || { tokens: [], followers: [] };
    return fetchQuiet(dataDir() + 'tokens.json').then(function (remote) {
      var merged = { tokens: [], followers: [] };
      var remoteTokens = (remote && remote.tokens) || [];
      var remoteFollowers = (remote && remote.followers) || [];

      function forProfile(list) {
        return list.filter(function (item) {
          return !item.profile_username || item.profile_username === username;
        });
      }

      var localTokens = forProfile(local.tokens || []);
      var localTokenIds = {};
      localTokens.forEach(function (t) { localTokenIds[t.token_value] = true; });
      merged.tokens = localTokens.concat(
        forProfile(remoteTokens).filter(function (t) { return !localTokenIds[t.token_value]; })
      );

      var localFollowers = forProfile(local.followers || []);
      var localIds = {};
      localFollowers.forEach(function (f) { localIds[f.follower_id] = true; });
      merged.followers = localFollowers.concat(
        forProfile(remoteFollowers).filter(function (f) { return !localIds[f.follower_id]; })
      );

      merged._remoteTokens = forProfile(remoteTokens);
      merged._remoteFollowers = forProfile(remoteFollowers);
      merged._localTokens = localTokens;
      merged._localFollowers = localFollowers;

      // validateRegistry() returns a NEW object containing only { tokens,
      // followers }, so the provenance fields have to be re-attached. Without
      // them the dashboard cannot tell its own tokens from read-only demo data,
      // and revoking a demo token would silently copy it into localStorage.
      var validated = AccessRules.validateRegistry(merged);
      validated._remoteTokens = merged._remoteTokens;
      validated._remoteFollowers = merged._remoteFollowers;
      validated._localTokens = merged._localTokens;
      validated._localFollowers = merged._localFollowers;
      return validated;
    });
  }

  function saveRegistry(username, registry) {
    // Only local entries are writable; the repo file is read-only at runtime.
    return write(KEY_TOKENS + username, {
      tokens: registry.tokens || [],
      followers: registry.followers || []
    });
  }

  /**
   * Replace only the entries that came from localStorage, leaving repo-seeded
   * demo data intact. Used by approve/remove so the demo resets cleanly.
   */
  function saveLocalRegistry(username, registry) {
    var remoteTokenValues = {};
    (registry._remoteTokens || []).forEach(function (t) { remoteTokenValues[t.token_value] = true; });
    var remoteFollowerIds = {};
    (registry._remoteFollowers || []).forEach(function (f) { remoteFollowerIds[f.follower_id] = true; });

    var localTokens = (registry.tokens || []).filter(function (t) {
      return !remoteTokenValues[t.token_value];
    });
    var localFollowers = (registry.followers || []).filter(function (f) {
      return !remoteFollowerIds[f.follower_id];
    });
    return write(KEY_TOKENS + username, { tokens: localTokens, followers: localFollowers });
  }

  // ---------------------------------------------------------------------------
  // Viewer identity (the follower-tier demo)
  // ---------------------------------------------------------------------------

  function getViewer() { return read(KEY_VIEWER) || null; }
  function setViewer(viewerId) {
    if (!viewerId) remove(KEY_VIEWER);
    else write(KEY_VIEWER, viewerId);
  }

  /** The last username edited in this browser — used as the demo default. */
  function getLastUsername() { return read(KEY_LAST) || null; }
  function setLastUsername(username) { write(KEY_LAST, username); }

  // ---------------------------------------------------------------------------
  // Housekeeping
  // ---------------------------------------------------------------------------

  function clearLocal() {
    var store = ls();
    var doomed = [];
    if (store) {
      for (var i = 0; i < store.length; i++) {
        var k = store.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) doomed.push(k);
      }
      doomed.forEach(function (k) { store.removeItem(k); });
    }
    Object.keys(memory).forEach(function (k) { delete memory[k]; });
    return doomed.length;
  }

  function localKeys() {
    var store = ls();
    if (!store) return Object.keys(memory);
    var keys = [];
    for (var i = 0; i < store.length; i++) {
      var k = store.key(i);
      if (k && k.indexOf(KEY_PREFIX) === 0) keys.push(k);
    }
    return keys;
  }

  return {
    KEY_PREFIX: KEY_PREFIX,
    dataDir: dataDir,
    pageRelative: pageRelative,
    listProfiles: listProfiles,
    loadProfile: loadProfile,
    saveProfile: saveProfile,
    deleteLocalProfile: deleteLocalProfile,
    hasLocalProfile: hasLocalProfile,
    loadRegistry: loadRegistry,
    saveRegistry: saveRegistry,
    saveLocalRegistry: saveLocalRegistry,
    getViewer: getViewer,
    setViewer: setViewer,
    getLastUsername: getLastUsername,
    setLastUsername: setLastUsername,
    clearLocal: clearLocal,
    localKeys: localKeys
  };
});
