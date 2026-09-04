/*!
 * profile.js — renders the public profile page: the thing a QR code opens.
 *
 * The URL is the API. What this page shows comes from three inputs — whose
 * profile, a temporary token, and the viewer identity — and `profile/boot.js`
 * resolves the first of those from whichever host is running us:
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
    Object.keys(vars).forEach(function (name) {
      document.documentElement.style.setProperty(name, vars[name]);
    });
  }

  function tierLabel(tier) {
    return {
      public: 'Public view',
      temporary: 'Temporary access',
      follower: 'Approved follower'
    }[tier] || 'Public view';
  }

  function tierExplainer(tier) {
    return {
      public: 'Anyone who scans the card sees this. Private links stay hidden.',
      temporary: 'This link carries a temporary token, so one private link is unlocked until it expires.',
      follower: 'You are signed in and the owner approved you, so every link is visible.'
    }[tier];
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
      class: 'link-card', href: link.url, target: '_blank', rel: 'noopener noreferrer me'
    }, [
      el('span', { class: 'icon', 'aria-hidden': 'true', text: iconFor(link.url) }),
      el('span', { class: 'body' }, [
        el('span', { class: 'label', text: link.label }),
        el('span', { class: 'url', text: link.url.replace(/^https?:\/\//, '').replace(/^mailto:/, '') })
      ]),
      unlockedByToken
        ? el('span', { class: 'badge badge-private flag', text: 'Unlocked' })
        : null
    ]);
    if (unlockedByToken) card.setAttribute('data-just-unlocked', 'true');
    return el('li', {}, [card]);
  }

  /**
   * The four-visitor switcher. It is a teaching aid, so it renders only in a demo
   * context (a page pointed at examples/, or ?demo=1). On someone's real card it
   * would be noise — and it would advertise that private links exist.
   */
  function scenarioLinks(username, params, tokenInfo) {
    var base = location.pathname;
    function href(extra) {
      var q = new URLSearchParams();
      q.set('u', username);
      q.set('demo', '1');
      Object.keys(extra || {}).forEach(function (k) { if (extra[k]) q.set(k, extra[k]); });
      return base + '?' + q.toString();
    }
    var current = params.t ? (tokenInfo && tokenInfo.valid ? 'temp' : 'expired')
      : (params.viewer ? 'follower' : 'public');

    var items = [
      { key: 'public', what: 'Stranger scans the printed card', extra: {} },
      { key: 'temp', what: 'Owner shared a temporary link', extra: { t: 'temp_demo_live' } },
      { key: 'expired', what: 'Same temporary link, after it expired', extra: { t: 'temp_demo_expired' } },
      { key: 'follower', what: 'Approved follower, signed in', extra: { viewer: 'user_priya' } }
    ];

    return el('div', { class: 'scenario-switch no-print' }, [
      el('h2', { text: 'The same URL, four visitors' }),
      el('ul', { class: 'scenario-list' }, items.map(function (item) {
        return el('li', {}, [
          el('a', {
            href: href(item.extra),
            'aria-current': item.key === current ? 'true' : null
          }, [
            el('span', { text: item.what })
          ])
        ]);
      })),
      el('p', {
        class: 'tiny muted',
        html: 'In V1 these links simulate the tiers in the browser. The private URLs are already in the JSON ' +
          'your browser fetched, so this demonstrates the UX, not real access control — see ' +
          '<a href="' + link('docs/ARCHITECTURE.md') + '">ARCHITECTURE.md</a>.'
      })
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
    root.appendChild(el('div', { class: 'empty-links' }, [
      el('p', { text: 'There is no profile called “' + (username || '') + '”.' }),
      el('p', {
        html: demo
          ? 'Try <a href="' + link('examples/') + '">the example profiles</a>, or ' +
            '<a href="' + link('dashboard/') + '">create your own</a>.'
          : '<a href="' + link('index.html') + '">See every card on this site</a>, or ' +
            '<a href="' + link('card-builder/') + '">make one</a>.'
      }),
      el('p', { class: 'tiny muted', html:
        'A profile is one JSON file in <code>profile-data/</code>, named after its ' +
        '<code>username</code>. Run <code>npm run build</code> after adding one so the ' +
        '<code>/c/' + (username || 'name') + '/</code> link and the index are generated.' })
    ]));
  }

  function render(profile, access, params) {
    var root = root_();
    root.innerHTML = '';
    applyTheme(profile);
    document.title = profile.display_name + ' — QR Link Card';

    root.appendChild(el('header', { class: 'profile-head' }, [
      photoNode(profile),
      el('h1', { class: 'profile-name', text: profile.display_name }),
      profile.designation ? el('p', { class: 'profile-role', text: profile.designation }) : null,
      profile.tagline ? el('p', { class: 'profile-tagline', text: profile.tagline }) : null
    ]));

    root.appendChild(el('div', { class: 'tier-banner no-print' }, [
      el('span', { class: 'badge badge-tier', text: tierLabel(access.tier) }),
      el('span', { text: tierExplainer(access.tier) })
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
        ' private. Ask ' + profile.display_name.split(' ')[0] + ' for a temporary link or for approval.' }));
    }

    if (Boot && Boot.demo) {
      root.appendChild(scenarioLinks(profile.username, params, access.token));
    }

    // The canonical URL is derived, never typed: a fork's cards point at the fork.
    var canonical = Store.profileUrlFor(profile.username, profile);
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

  function boot(api) {
    if (started) return;
    started = true;
    Boot = api || window.ProfileBoot || null;

    var params = Boot ? Boot.params : qs();
    var username = Boot ? Boot.username : (params.u || params.username || '').trim();

    if (!username) {
      // Nothing in the URL: fall back to whoever was edited most recently in this
      // browser, then to the first profile this deployment actually has.
      username = Store.getLastUsername() || '';
    }
    if (!username) {
      Store.listProfiles().then(function (list) {
        var first = list.filter(function (p) { return !p._starter; })[0] || list[0];
        if (first) boot2(first.username, params);
        else notFound('');
      }).catch(function () { notFound(''); });
      return;
    }
    boot2(username, params);
  }

  function boot2(username, params) {

    // `?viewer=` stands in for a session cookie so the follower tier is
    // demonstrable without a backend. The dashboard sets the same key.
    if (params.viewer !== undefined) Store.setViewer(params.viewer || null);
    var viewerId = params.viewer !== undefined ? (params.viewer || null) : Store.getViewer();

    Promise.all([Store.loadProfile(username), Store.loadRegistry(username)])
      .then(function (results) {
        var profile = results[0];
        var registry = results[1];
        if (!profile) { notFound(username); return; }
        var checked = Access.validateProfile(profile);
        var access = Access.resolveAccess(checked.ok ? checked.profile : profile,
          { token: params.t || null, viewerId: viewerId }, registry);
        render(checked.ok ? checked.profile : profile, access, params);
      })
      .catch(function (err) {
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
   * synchronously here would win that race with no username in hand and fall back
   * to whichever profile happens to be first in the manifest — rendering the wrong
   * person, silently. One turn of the event loop is enough for boot.js to publish
   * window.ProfileBoot, after which this does nothing.
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
