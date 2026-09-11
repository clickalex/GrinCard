/*!
 * profile.js — renders the public profile page: the thing a QR code opens.
 *
 * There is one page and one link to share. What a visitor sees comes from three
 * inputs — whose profile, a temporary token, and the viewer identity — and
 * `profile/boot.js` resolves the first of those from whichever host is running us:
 *
 *   /profile/?u=rahul   owner preview and ?u= deep links
 *   /c/rahul/           the canonical printed URL (a generated stub)
 *   /anything           404.html, which boots us in place rather than erroring
 *
 * Every link this page emits goes through Store.rootRelative(), which derives
 * the climb back to the site root from the current path, so the same renderer
 * works at any depth with no per-page configuration.
 */
(function () {
  'use strict';

  var Access = window.AccessRules;
  var Store = window.Store;
  var TPL = window.CardTemplates;
  var Boot = null;
  var started = false;
  var generation = 0;     // incremented by every authoritative boot()
  var renderedAs = null;  // the username the DOM currently represents

  /** Link to a site-root-relative path, from wherever this page is running. */
  function link(path) { return Store.rootRelative(path); }

  function root_() { return document.getElementById('profile-root'); }

  var ICONS = [
    [/instagram\.com/i, '📸'], [/wa\.me|whatsapp/i, '💬'], [/linkedin\.com/i, '💼'],
    [/github\.com/i, '💻'], [/behance\.net|dribbble\.com/i, '🎨'], [/youtube\.com|youtu\.be/i, '▶️'],
    [/twitter\.com|x\.com/i, '🐦'], [/maps\.google|google\.com\/maps/i, '📍'],
    [/^mailto:/i, '✉️'], [/^tel:/i, '📞'], [/drive\.google|docs\.google|\.pdf/i, '📄'],
    [/t\.me/i, '✈️'], [/medium\.com|substack/i, '✍️'], [/calendly|cal\.com/i, '📅']
  ];

  function iconFor(url) {
    for (var i = 0; i < ICONS.length; i++) if (ICONS[i][0].test(url || '')) return ICONS[i][1];
    return '🔗';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else if (key.indexOf('data-') === 0 || key === 'aria-current') node.setAttribute(key, attrs[key]);
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  function qs() {
    var out = {};
    new URLSearchParams(location.search).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  /** Apply a template's palette so the page matches the printed card. */
  function applyTheme(profile) {
    var vars = TPL.toCssVars(TPL.get(profile.card_settings && profile.card_settings.template_id), profile);
    var page = profile.profile_settings || {};
    var hasPageImage = !!page.page_background_image;
    vars['--profile-page-color'] = page.page_color || vars['--bg'] || '#f6f6f4';
    vars['--profile-link-color'] = page.link_color || vars['--surface'] || '#ffffff';
    vars['--profile-page-image'] = hasPageImage ? 'url("' + String(page.page_background_image).replace(/"/g, '%22') + '")' : 'none';
    // The light veil exists to keep type readable over a photo. With no photo it must
    // not paint at all, or a dark theme's pale page colour is washed out under it and
    // its light text disappears.
    vars['--profile-page-veil'] = hasPageImage
      ? 'linear-gradient(rgba(246,246,244,.78), rgba(246,246,244,.78))'
      : 'linear-gradient(transparent, transparent)';
    // Anything painted in the accent — the Copy link button, for one — needs type in the
    // opposite lightness. Signal and Paper accent on near-black, so hardcoding dark ink
    // there would be invisible ink on an invisible button.
    vars['--accent-fg'] = TPL.isLight(vars['--accent']) ? '#1a1a12' : '#ffffff';
    Object.keys(vars).forEach(function (name) {
      document.documentElement.style.setProperty(name, vars[name]);
    });
  }

  /**
   * Clipboard with a fallback, so the copy button works on a plain-http deploy and
   * from file:// too — the same helper assets/cards-index.js uses.
   */
  function copyText(text, button) {
    function done(ok) {
      if (!button) return;
      var label = button.textContent;
      button.textContent = ok ? 'Copied' : 'Press ⌘C';
      button.disabled = true;
      setTimeout(function () { button.textContent = label; button.disabled = false; }, 1400);
    }
    function legacy() {
      try {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch (e) { return false; }
    }
    if (window.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacy()); });
    } else {
      done(legacy());
    }
  }

  function photoNode(profile) {
    if (profile.card_settings && profile.card_settings.show_photo === false) return monogram(profile);
    if (!profile.photo_url) return monogram(profile);
    var img = el('img', {
      class: 'profile-photo', src: profile.photo_url,
      alt: profile.display_name, width: '120', height: '120'
    });
    // If the photo fails (hotlink blocked, offline), fall back to the monogram.
    img.addEventListener('error', function () { img.replaceWith(monogram(profile)); });
    return img;
  }

  function monogram(profile) {
    return el('div', { class: 'profile-monogram', text: Access ? initialOf(profile) : '?', 'aria-hidden': 'true' });
  }

  function initialOf(profile) {
    var parts = String(profile.display_name || profile.username || '').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function linkNode(link, access) {
    var unlockedByToken = access.tier === 'temporary' && Access.isPrivate(link);
    var card = el('a', {
      class: 'link-card' + (link.image_url ? ' has-post-image' : ''), href: link.url, target: '_blank', rel: 'noopener noreferrer me'
    }, [
      // Every link gets a post-style visual panel. If no image is supplied,
      // CSS provides a colour/gradient cover so the page never falls back to a
      // plain vertical link stack in Pinterest mode.
      el('span', { class: 'post-image', 'aria-hidden': 'true' }),
      el('span', { class: 'icon', 'aria-hidden': 'true', text: iconFor(link.url) }),
      el('span', { class: 'body' }, [
        el('span', { class: 'label', text: link.label }),
        el('span', { class: 'url', text: link.url.replace(/^https?:\/\//, '').replace(/^mailto:/, '') })
      ]),
      unlockedByToken
        ? el('span', { class: 'badge badge-private flag', text: 'Unlocked' })
        : null
    ]);
    if (link.image_url) {
      var image = card.querySelector('.post-image');
      if (image) image.style.backgroundImage = 'url("' + String(link.image_url).replace(/"/g, '%22') + '")';
    }
    if (unlockedByToken) card.setAttribute('data-just-unlocked', 'true');
    return el('li', {}, [card]);
  }

  /**
   * The one link this page offers: the card's permanent URL, shown as text so it can
   * be selected, with a button that copies it. A visitor can forward it; the owner can
   * paste it into a bio. Nothing here is demo-only, because a shared card is the real
   * product — there is no second view of it to compare against.
   */
  function shareBlock(canonical) {
    var button = el('button', { class: 'btn btn-sm', type: 'button', text: 'Copy link' });
    button.addEventListener('click', function () { copyText(canonical, button); });

    return el('section', { class: 'share-block no-print', 'aria-labelledby': 'share-title' }, [
      el('h2', { id: 'share-title', text: 'Share this card' }),
      el('div', { class: 'url-row' }, [
        el('code', { class: 'url-value share-url', text: canonical }),
        button,
        el('a', { class: 'btn btn-sm btn-ghost', href: canonical, text: 'Open' })
      ]),
      el('p', { class: 'tiny muted', text:
        'This link is permanent. Editing the profile changes what it shows, never the address.' })
    ]);
  }

  function notFound(username) {
    var root = root_();
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'profile-head' }, [
      el('div', { class: 'profile-monogram', text: '404' }),
      el('h1', { class: 'profile-name', text: 'No profile here' })
    ]));
    var demo = Boot && Boot.demo;
    // The demo branch must not offer the dashboard: a demo link is an evaluation
    // view, and the dashboard is the owner's console. "Create your own" goes to
    // the builder — still flagged, so even that stays inside the demo.
    root.appendChild(el('div', { class: 'empty-links' }, [
      el('p', { text: 'There is no profile called “' + (username || '') + '”.' }),
      el('p', {
        html: demo
          ? 'Try <a href="' + link('examples/') + '">the example profiles</a>, or ' +
            '<a href="' + link('card-builder/?demo=1') + '">create your own</a>.'
          : '<a href="' + link('index.html') + '">See every card on this site</a>, or ' +
            '<a href="' + link('card-builder/') + '">make one</a>.'
      }),
      el('p', { class: 'tiny muted', html:
        'A profile is one JSON file in <code>profile-data/</code>, named after its ' +
        '<code>username</code>. Run <code>npm run build</code> after adding one so the ' +
        '<code>/c/' + (username || 'name') + '/</code> link and the index are generated.' })
    ]));
  }

  function render(profile, access) {
    var root = root_();
    root.innerHTML = '';
    applyTheme(profile);
    var profileSettings = profile.profile_settings || {};
    root.setAttribute('data-layout', profileSettings.layout || 'pinterest');
    root.setAttribute('data-link-shape', profileSettings.link_shape || 'rounded');
    document.title = profile.display_name + ' — QR Link Card';

    root.appendChild(el('header', { class: 'profile-head' }, [
      photoNode(profile),
      el('h1', { class: 'profile-name', text: profile.display_name }),
      profile.designation ? el('p', { class: 'profile-role', text: profile.designation }) : null,
      profile.tagline ? el('p', { class: 'profile-tagline', text: profile.tagline }) : null
    ]));

    (access.notices || []).forEach(function (notice) {
      root.appendChild(el('div', { class: 'notice notice-warn', role: 'status', text: notice.message }));
    });

    if (access.visibleLinks.length) {
      root.appendChild(el('ul', { class: 'links', id: 'links' },
        access.visibleLinks.map(function (link) { return linkNode(link, access); })));
    } else {
      root.appendChild(el('div', { class: 'empty-links', id: 'links' }, [
        el('p', { text: 'This profile has no public links yet.' })
      ]));
    }

    if (access.hiddenCount > 0) {
      root.appendChild(el('p', { class: 'tiny center mt2 no-print', text:
        access.hiddenCount + (access.hiddenCount === 1 ? ' link is' : ' links are') +
        ' private. ' + profile.display_name.split(' ')[0] +
        ' shares a link to those when someone needs them.' }));
    }

    // The canonical URL is derived, never typed: a fork's cards point at the fork.
    var canonical = Store.profileUrlFor(profile.username, profile);
    root.appendChild(shareBlock(canonical));

    var existingCanonical = document.querySelector('link[rel="canonical"]');
    if (existingCanonical) existingCanonical.setAttribute('href', canonical);
    else {
      var tag = document.createElement('link');
      tag.rel = 'canonical';
      tag.href = canonical;
      document.head.appendChild(tag);
    }

    root.appendChild(el('footer', { class: 'profile-foot no-print' }, [
      el('p', {
        html: 'Powered by <a href="' + link('index.html') + '">QR Link Card</a> — free and open source (MIT).'
      }),
      el('p', { class: 'tiny', html:
        'This URL never changes. Edit the links and every printed card updates itself.' })
    ]));
  }

  /**
   * Whose profile is this page for, when no host has told us?
   *
   * Mirrors resolveUsername() in profile/boot.js, and it has to exist here because a
   * host that injects scripts one at a time over the network — which is exactly what
   * 404.html does — can let selfStart() fire before boot.js has even downloaded, so
   * window.ProfileBoot is still undefined. Guessing "the first profile in the
   * manifest" at that moment renders somebody else at /c/<their-name>/, silently, and
   * on a single-profile deployment it looks perfectly correct.
   *
   * The order matches boot.js: an explicit host attribute first, then the query, then
   * the /c/<username>/ path segment.
   */
  function usernameFromPage(params) {
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

  function boot(api) {
    Boot = api || window.ProfileBoot || null;

    var params = Boot ? Boot.params : qs();
    var username = Boot ? Boot.username : usernameFromPage(params);

    // An earlier pass with no host and no username in the page may already have
    // rendered a guess. If we now know who this page is really for and it is somebody
    // else, render again — keeping the guess would leave the wrong person at this URL.
    if (started && username && username !== renderedAs) started = false;
    if (started) return;
    started = true;

    var gen = ++generation;

    if (!username) {
      // Nothing in the URL and nothing in the markup either: fall back to whoever was
      // edited most recently in this browser, then to the first profile this
      // deployment actually has. Legitimate only when the page named nobody.
      username = Store.getLastUsername() || '';
    }
    if (!username) {
      Store.listProfiles().then(function (list) {
        if (gen !== generation) return;   // an authoritative boot() took over
        var first = list.filter(function (p) { return !p._starter; })[0] || list[0];
        if (first) boot2(first.username, params, gen);
        else notFound('');
      }).catch(function () { if (gen === generation) notFound(''); });
      return;
    }
    boot2(username, params, gen);
  }

  function boot2(username, params, gen) {
    gen = gen || generation;
    renderedAs = username || null;

    // `?viewer=` stands in for a session cookie so the follower tier is
    // demonstrable without a backend. The dashboard sets the same key.
    if (params.viewer !== undefined) Store.setViewer(params.viewer || null);
    var viewerId = params.viewer !== undefined ? (params.viewer || null) : Store.getViewer();

    Promise.all([Store.loadProfile(username), Store.loadRegistry(username)])
      .then(function (results) {
        if (gen !== generation) return;   // a newer boot() owns the DOM now
        var profile = results[0];
        var registry = results[1];
        if (!profile) { notFound(username); return; }
        var checked = Access.validateProfile(profile);
        var access = Access.resolveAccess(checked.ok ? checked.profile : profile,
          { token: params.t || null, viewerId: viewerId }, registry);
        render(checked.ok ? checked.profile : profile, access);
      })
      .catch(function (err) {
        if (gen !== generation) return;
        var root = root_();
        root.innerHTML = '';
        root.appendChild(el('div', { class: 'notice notice-danger' }, [
          el('div', {}, [
            el('strong', { text: 'Could not load the profile.' }),
            el('p', { class: 'small', text: String(err && err.message || err) }),
            el('p', { class: 'small', html:
              'This page fetches JSON, so it needs to be served over http — open it with ' +
              '<code>python3 -m http.server</code> rather than by double-clicking the file. ' +
              'See <a href="../SETUP.md">SETUP.md</a>.' })
          ])
        ]));
      });
  }

  // boot.js calls this once it has resolved the username and built the chrome.
  window.ProfileRender = boot;

  /**
   * Fallback for a host page that loads this WITHOUT boot.js: `?u=` is enough.
   *
   * The deferred call matters. boot.js is loaded after this file, so its
   * DOMContentLoaded listener is registered second and runs second. Starting
   * synchronously here would win that race with no username in hand.
   *
   * One turn of the event loop is enough when both scripts are in the markup, because
   * boot.js executes during the same DOMContentLoaded dispatch and publishes
   * window.ProfileBoot before this timer fires. It is NOT enough when a host injects
   * the scripts one at a time over the network — 404.html does exactly that, so this
   * timer wins and boot() runs with no host at all. usernameFromPage() is what makes
   * that safe: it reads the username the host put in the markup, so the guess is the
   * right answer. boot() also re-renders if an authoritative api names somebody else.
   */
  function selfStart() {
    setTimeout(function () {
      if (started || window.ProfileBoot) return;
      boot(null);
    }, 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', selfStart);
  else selfStart();
})();
