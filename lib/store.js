/*!
 * store.js — where V1 keeps its data, and how a deployment finds itself.
 *
 * The second job matters as much as the first. This repository is a template:
 * people fork it, drop a JSON file in `profile-data/`, enable Pages, and print a
 * card. Nobody in that flow should ever have to type their own URL, so the
 * canonical link a QR code encodes is DERIVED from where the scripts are being
 * served — see siteRoot() and profileUrlFor().
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

  // ---------------------------------------------------------------------------
  // Where am I? (site root discovery)
  //
  // A fork can be served from `https://me.github.io/repo/`, from a custom domain
  // at `https://cards.me/`, or from a subdirectory of a larger site. Rather than
  // make the owner configure that, we read the URL of our own <script> tag: this
  // file always lives at `<site root>/lib/store.js`, so stripping that suffix
  // gives the root at any depth, on any host, with no build step.
  // ---------------------------------------------------------------------------

  var SELF_SRC = (typeof document !== 'undefined' && document.currentScript &&
    document.currentScript.src) || null;
  var SELF_SUFFIX = '/lib/store.js';
  var rootOverride = null;

  /** Absolute URL of the site root, always ending in "/". */
  function siteRoot() {
    if (rootOverride) return rootOverride;

    // 1. An explicit override wins: <body data-site-root="https://cards.me/">.
    if (typeof document !== 'undefined' && document.body) {
      var attr = document.body.getAttribute('data-site-root');
      if (attr) {
        rootOverride = /\/$/.test(attr) ? attr : attr + '/';
        return rootOverride;
      }
    }

    // 2. Our own script URL — correct at any depth, on any host.
    if (SELF_SRC) {
      var i = SELF_SRC.indexOf(SELF_SUFFIX);
      if (i > 0) {
        rootOverride = SELF_SRC.slice(0, i + 1);
        return rootOverride;
      }
    }

    // 3. Fall back to walking up from the current page.
    if (typeof location !== 'undefined') {
      var depth = (typeof document !== 'undefined' && document.body &&
        parseInt(document.body.getAttribute('data-base-depth') || '', 10)) || 0;
      var path = location.pathname;
      if (path.charAt(path.length - 1) !== '/') path = path.replace(/[^/]*$/, '');
      while (depth-- > 0) path = path.replace(/[^/]*\/$/, '/');
      rootOverride = location.origin + path;
      return rootOverride;
    }

    return '';   // Node: callers pass absolute URLs or use profileUrlFor(null)
  }

  /** The path portion of siteRoot(), e.g. "/repo/" or "/". */
  function basePath() {
    var root = siteRoot();
    if (!root) return '/';
    try { return new URL(root).pathname; } catch (e) { return '/'; }
  }

  /** Test hook: pretend the site is served from somewhere else. */
  function setSiteRoot(url) {
    rootOverride = url ? (/\/$/.test(url) ? url : url + '/') : null;
    return rootOverride;
  }

  /**
   * If this deployment is a GitHub Pages site, the owner and repo it belongs to.
   *
   * `https://alice.github.io/my-card/` → `{ owner: 'alice', repo: 'my-card' }`.
   * A user site at `https://alice.github.io/` has an empty `repo`. Anything that
   * is not github.io (localhost, a custom domain) returns null — the dashboard
   * then asks for the GitHub user/repo so it can still show a public link.
   */
  function githubPagesIdentity() {
    var url = siteRoot();
    if (!url) return null;
    try {
      var parsed = new URL(url);
      var host = String(parsed.hostname || '').toLowerCase();
      var match = /^([a-z0-9-]+)\.github\.io$/.exec(host);
      if (!match) return null;
      var segs = String(parsed.pathname || '/').split('/').filter(Boolean);
      return { owner: match[1], repo: segs.length ? segs[0] : '' };
    } catch (e) {
      return null;
    }
  }

  /**
   * The GitHub Pages origin for an owner/repo, always ending in "/".
   * Invalid names return "" rather than a URL that could never deploy.
   */
  function githubPagesRoot(owner, repo) {
    owner = String(owner || '').replace(/^\/+|\/+$/g, '');
    repo = String(repo || '').replace(/^\/+|\/+$/g, '');
    if (!owner || !/^[A-Za-z0-9-]+$/.test(owner)) return '';
    var host = owner.toLowerCase();
    if (!repo || repo.toLowerCase() === host + '.github.io') {
      return 'https://' + host + '.github.io/';
    }
    if (!/^[A-Za-z0-9._-]+$/.test(repo)) return '';
    return 'https://' + host + '.github.io/' + repo + '/';
  }

  /**
   * True when this page is the upstream project demo, not someone's own copy.
   *
   * The demo account's `/c/<username>/` is a real public link. The dashboard
   * uses this to show JSON-first copy ("edit profile-data/<you>.json") rather
   * than locking the GitHub fields the way a fork's own Pages host does.
   */
  function isUpstreamDemo() {
    var id = githubPagesIdentity();
    return !!(id && id.owner === 'clickalex' &&
      String(id.repo || '').toLowerCase() === 'grincard');
  }

  /**
   * The canonical, permanent, printable URL for a profile: `<root>/c/<username>/`.
   *
   * This is what a QR code should encode. It is derived, never typed, so a fork
   * produces cards that point at the fork. An absolute `profile_url` in the JSON
   * still wins — that is how you keep a custom domain or a pre-existing link.
   */
  function profileUrlFor(username, profile) {
    if (profile && typeof profile.profile_url === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(profile.profile_url)) {
      return profile.profile_url;
    }
    if (!username) return '';
    return siteRoot() + 'c/' + encodeURIComponent(username) + '/';
  }

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
   * Resolve a root-relative path against the current page's directory.
   *
   * Pages are served both as a directory URL (`/card-builder/`, where pathname
   * ends in "/") and as a file (`/profile/index.html`), and the profile app also
   * runs from generated stubs two levels down (`/c/rahul/`), so this normalises
   * before joining rather than assuming a fixed depth.
   */
  function pageRelative(relPath) {
    if (typeof location === 'undefined') return relPath;
    var path = location.pathname;
    if (path.charAt(path.length - 1) === '/') path += 'index.html';
    return path.replace(/[^/]*$/, '') + relPath;
  }

  /**
   * Is this URL asking for the shipped fixtures rather than the owner's own data?
   *
   * `?demo=1` already means "fixture context" to profile/boot.js, which uses it to
   * decide whether to render the four-tier switcher and the "this is not real access
   * control" note. It has to mean the same thing here, or the two halves disagree:
   * the switcher would offer scenarios for people whose JSON the page then cannot
   * find. The fixtures live in examples/, not profile-data/ — they moved there so a
   * fork ships exactly one obvious starter profile of its own.
   */
  function isDemoRequest() {
    if (typeof location === 'undefined' || !location.search) return false;
    var match = /[?&]demo=([^&#]*)/.exec(location.search);
    return !!match && (match[1] === '1' || match[1] === 'true');
  }

  /**
   * Where profile JSON lives, relative to the current page.
   *
   * Resolution order:
   *   1. `<body data-profile-dir="…">` — an explicit override. This is how
   *      examples/index.html and templates/index.html point at the fixtures, and how
   *      the tests repoint a page without changing its URL.
   *   2. `?demo=1` — the fixtures, for a page that has no body attribute of its own.
   *   3. `profile-data/` — the owner's own profiles, which is the normal case.
   *
   * (2) exists because a link like `/profile/?u=rahul123&demo=1` navigates to a page
   * that carries no attribute: the gallery builds those URLs, the README advertises
   * them, and without this they render "No profile here".
   */
  function dataDir() {
    if (typeof document !== 'undefined' && document.body) {
      var dir = document.body.getAttribute('data-profile-dir');
      if (dir) return /\/$/.test(dir) ? dir : dir + '/';
    }
    if (typeof document === 'undefined') return 'profile-data/';
    // rootRelative() already returns a path relative to this page, so composing it
    // with pageRelative() would produce "/dashboard/../profile-data/". That still
    // resolves in a browser, but it is wrong in any context that compares strings,
    // and it hides the depth the page is actually running at.
    return rootRelative(isDemoRequest() ? 'examples/' : 'profile-data/');
  }

  /** Express a site-root-relative path from the current page's directory. */
  function rootRelative(relPath) {
    if (typeof location === 'undefined') return relPath;
    var page = location.pathname;
    if (page.charAt(page.length - 1) !== '/') page = page.replace(/[^/]*$/, '');
    var base = basePath();
    if (page.indexOf(base) !== 0) return relPath;
    var depth = (page.slice(base.length).match(/\//g) || []).length;
    return '../'.repeat(depth) + relPath;
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
  /**
   * Every profile in the data directory, as summaries for the index page.
   *
   * A static site cannot list a directory, so `tools/build-links.js` writes
   * `index.json` beside the profiles and we read that. `npm run build`
   * regenerates it; the Pages workflow regenerates it on deploy; CI fails if it
   * is stale. Forgetting it is therefore a cosmetic problem (the index page does
   * not list the new person) and never a broken link, because `/c/<username>/`
   * loads `<username>.json` by name.
   */
  /**
   * Everything listProfiles() returns, plus the manifest names that did not resolve.
   *
   * A name in the manifest with no matching JSON file means somebody renamed or deleted
   * a profile without regenerating the index — common when the only editor is GitHub's
   * web UI and there is no build step to run. Dropping those names silently makes the
   * cards page look empty for no apparent reason, so callers that can explain the
   * situation are given the list.
   */
  function listProfilesDetailed() {
    return fetchQuiet(dataDir() + 'index.json').then(function (manifest) {
      var names = (manifest && (manifest.profiles || manifest.usernames)) || null;
      if (!names) return { profiles: [], missing: [], mismatched: [] };
      return Promise.all(names.map(function (name) {
        return fetchQuiet(dataDir() + encodeURIComponent(name) + '.json');
      })).then(function (list) {
        var profiles = [];
        var missing = [];
        var mismatched = [];
        list.forEach(function (p, i) {
          var name = String(names[i]);
          if (!p) { missing.push(name); return; }
          // The manifest name is the filename, and the filename is what the URL is built
          // from: /c/<filename>/ is the file the profile page fetches. So it is the
          // canonical username here, not whatever "username" the JSON declares.
          //
          // Honouring the declared field instead means a hand-edited profile whose field
          // does not match its filename makes this page list a card for a URL that does
          // not exist — and then report it missing, telling somebody who has a working
          // card that they have no cards at all.
          if (p.username && p.username !== name) {
            mismatched.push({ name: name, declared: String(p.username) });
          }
          profiles.push({
            username: name,
            display_name: p.display_name,
            designation: p.designation,
            tagline: p.tagline,
            theme: p.theme,
            link_count: (p.links || []).length,
            url: profileUrlFor(name, p),
            _starter: !!p._starter
          });
        });
        return { profiles: profiles, missing: missing, mismatched: mismatched };
      });
    });
  }

  function listProfiles() {
    return listProfilesDetailed().then(function (r) { return r.profiles; });
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
    isDemoRequest: isDemoRequest,
    siteRoot: siteRoot,
    basePath: basePath,
    setSiteRoot: setSiteRoot,
    githubPagesIdentity: githubPagesIdentity,
    githubPagesRoot: githubPagesRoot,
    isUpstreamDemo: isUpstreamDemo,
    profileUrlFor: profileUrlFor,
    dataDir: dataDir,
    pageRelative: pageRelative,
    rootRelative: rootRelative,
    listProfiles: listProfiles,
    listProfilesDetailed: listProfilesDetailed,
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
