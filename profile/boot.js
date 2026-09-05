/*!
 * profile/boot.js — makes the profile page runnable from anywhere.
 *
 * One renderer, three hosts, three different depths:
 *
 *   /repo/profile/?u=rahul      the owner's preview and the ?u= deep link
 *   /repo/c/rahul/              the canonical public URL a QR code encodes
 *   /repo/anything/unknown      404.html, which boots the app in place so the
 *                               visitor never sees an error page
 *
 * A static host cannot rewrite URLs, so `tools/build-links.js` writes a tiny
 * stub per username and 404.html catches the rest. Both set a base path and a
 * username; this file works out everything else, builds the page chrome, and
 * hands over to profile.js.
 */
(function () {
  'use strict';

  var Store = window.Store;

  /**
   * How far the current page sits below the site root, as a "../" prefix.
   * Derived rather than configured: `/repo/c/rahul/` -> `../../`.
   */
  function toRoot() {
    var rel = Store.rootRelative('');
    return rel || './';
  }

  /** Absolute-ish link to a site-root-relative path, from this page. */
  function link(path) {
    return toRoot() + String(path || '').replace(/^\.\//, '');
  }

  /**
   * Whose profile is this?
   * Precedence: an explicit stub attribute, a global set by the stub, the `?u=`
   * parameter, then the `/c/<username>/` path segment.
   */
  function resolveUsername(params) {
    var body = document.body;
    var fromAttr = body && body.getAttribute('data-username');
    if (fromAttr) return fromAttr.trim();
    if (window.QR_PROFILE_USERNAME) return String(window.QR_PROFILE_USERNAME).trim();
    if (params.u) return String(params.u).trim();
    if (params.username) return String(params.username).trim();

    var m = /\/c\/([^/?#]+)\/?$/.exec(location.pathname);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    return '';
  }

  function params() {
    var out = {};
    new URLSearchParams(location.search).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  /**
   * Is this a demo/example context rather than someone's real card?
   *
   * The tier switcher and the "this is not real access control" note are useful
   * to a person evaluating the project and noise (plus a small information leak)
   * on a real card, so they only render for examples — a page pointed at
   * `examples/`, or an explicit `?demo=1`.
   */
  function isDemoContext(p) {
    var body = document.body;
    if (p.demo === '1' || p.demo === 'true') return true;
    if (body && body.getAttribute('data-demo') === '1') return true;
    var dir = body && body.getAttribute('data-profile-dir');
    return !!dir && /examples/.test(dir);
  }

  /**
   * Build the page chrome if the host did not provide it. The stubs and
   * 404.html are deliberately tiny, so they ship almost no markup and let this
   * build the same shell `profile/index.html` has.
   */
  function ensureShell() {
    if (document.getElementById('profile-root')) return;

    document.body.classList.add('profile-page');

    var skip = document.createElement('a');
    skip.className = 'sr-only';
    skip.href = '#links';
    skip.textContent = 'Skip to links';

    var brand = document.createElement('a');
    brand.className = 'brand';
    brand.href = link('index.html');
    brand.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">' +
      '<rect width="22" height="22" rx="5" fill="#16161d"/>' +
      '<rect x="4" y="4" width="5" height="5" fill="#f2b134"/>' +
      '<rect x="13" y="4" width="5" height="5" fill="#fff"/>' +
      '<rect x="4" y="13" width="5" height="5" fill="#fff"/>' +
      '<rect x="13" y="13" width="2" height="2" fill="#fff"/>' +
      '<rect x="16" y="16" width="2" height="2" fill="#f2b134"/></svg>';
    brand.appendChild(document.createTextNode(' QR Link Card'));

    var nav = document.createElement('nav');
    [['index.html', 'Cards'], ['templates/', 'Templates'], ['dashboard/', 'Dashboard']]
      .forEach(function (item) {
        var a = document.createElement('a');
        a.href = link(item[0]);
        a.textContent = item[1];
        nav.appendChild(a);
      });

    var header = document.createElement('header');
    header.className = 'topbar no-print';
    header.appendChild(brand);
    header.appendChild(nav);

    var root = document.createElement('div');
    root.className = 'empty-links';
    root.textContent = 'Loading profile\u2026';

    var inner = document.createElement('div');
    inner.className = 'profile';
    inner.id = 'profile-root';
    inner.setAttribute('aria-live', 'polite');
    inner.appendChild(root);

    var shell = document.createElement('div');
    shell.className = 'profile-shell';
    shell.appendChild(inner);

    var main = document.createElement('main');
    main.id = 'main';
    main.appendChild(shell);

    document.body.insertBefore(skip, document.body.firstChild);
    document.body.appendChild(header);
    document.body.appendChild(main);
  }

  /** Load a stylesheet from the site root unless the host already did. */
  function ensureStyles() {
    var href = link('assets/styles.css');
    var existing = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < existing.length; i++) {
      if ((existing[i].getAttribute('href') || '').indexOf('styles.css') >= 0) return;
    }
    var el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    document.head.appendChild(el);
  }

  function boot() {
    ensureStyles();
    ensureShell();
    var p = params();
    var api = {
      username: resolveUsername(p),
      params: p,
      demo: isDemoContext(p),
      link: link,
      toRoot: toRoot,
      /** The permanent URL for this profile — what a QR code should encode. */
      canonicalUrl: function (username, profile) {
        return Store.profileUrlFor(username || api.username, profile);
      }
    };
    window.ProfileBoot = api;

    // Contributed templates live in their own folder and are loaded from a
    // manifest, because a static site cannot list a directory. This must happen
    // before rendering: a profile whose card_settings pick a community template
    // needs its palette registered, or the page would fall back to template-1 and
    // stop matching the printed card. loadCommunity() never rejects, so a missing
    // or broken folder degrades to the built-in templates instead of a blank page.
    var TPL = window.CardTemplates;
    var ready = (TPL && typeof TPL.loadCommunity === 'function')
      ? TPL.loadCommunity(link('card-templates/community/'))
      : Promise.resolve([]);

    ready.then(function () { handover(api); }, function () { handover(api); });
  }

  function handover(api) {
    // profile.js listens for this rather than assuming it owns startup, so a host
    // page can pre-render chrome without racing.
    var event = document.createEvent ? document.createEvent('Event') : null;
    if (event) {
      event.initEvent('profile:ready', true, false);
      document.dispatchEvent(event);
    }
    if (typeof window.ProfileRender === 'function') window.ProfileRender(api);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
