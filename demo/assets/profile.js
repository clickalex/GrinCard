/*!
 * profile.js — renders the public profile page (§8.1).
 *
 * The URL is the API. Everything about what this page shows comes from three
 * inputs: the `u` parameter (whose profile), the `t` parameter (a temporary
 * token) and the viewer identity (an approved follower's session).
 *
 * In production those inputs arrive as /c/:username, ?t=... and a session
 * cookie; the resolution logic in lib/access.js is identical either way.
 */
(function () {
  'use strict';

  var Access = window.AccessRules;
  var Store = window.Store;
  var TPL = window.CardTemplates;
  var root = document.getElementById('profile-root');

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

  function scenarioLinks(username, params, tokenInfo) {
    var base = location.pathname;
    function href(extra) {
      var q = new URLSearchParams();
      q.set('u', username);
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
          '<a href="../docs/ARCHITECTURE.md">ARCHITECTURE.md</a>.'
      })
    ]);
  }

  function notFound(username) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'profile-head' }, [
      el('div', { class: 'profile-monogram', text: '404' }),
      el('h1', { class: 'profile-name', text: 'No profile here' })
    ]));
    root.appendChild(el('div', { class: 'empty-links' }, [
      el('p', { text: 'There is no profile called “' + (username || '') + '”.' }),
      el('p', {
        html: 'Try the demo: <a href="' + location.pathname + '?u=rahul123">rahul123</a> or ' +
          '<a href="' + location.pathname + '?u=meera9">meera9</a>, or ' +
          '<a href="../dashboard/">create your own</a>.'
      })
    ]));
  }

  function render(profile, access, params) {
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

    root.appendChild(scenarioLinks(profile.username, params, access.token));

    root.appendChild(el('footer', { class: 'profile-foot no-print' }, [
      el('p', {
        html: 'Powered by <a href="../index.html">QR Link Card</a> — free and open source (MIT).'
      }),
      el('p', { class: 'tiny', html:
        'This URL never changes. Edit the links and every printed card updates itself.' })
    ]));
  }

  function boot() {
    var params = qs();
    var username = (params.u || params.username || '').trim();

    if (!username) {
      // No ?u= — fall back to whatever was edited most recently in this browser,
      // then to the demo profile so the page is never blank.
      username = Store.getLastUsername() || 'rahul123';
    }

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
