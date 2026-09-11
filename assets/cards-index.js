/*!
 * assets/cards-index.js — renders the site root: every card on this deployment.
 *
 * Two jobs, both derived rather than configured:
 *
 *   1. List the profiles in profile-data/ with the permanent URL to print for
 *      each one. The URL comes from Store.profileUrlFor(), which works out the
 *      site root from where these scripts are being served, so a fork's cards
 *      point at the fork without anyone editing a config file.
 *   2. Recognise an untouched fork — the starter profile is still there — and
 *      show the three-step setup panel instead of an empty page.
 */
(function () {
  'use strict';

  var Store = window.Store;
  var Access = window.AccessRules;
  var QR = window.QRCode;
  var TPL = window.CardTemplates;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value == null) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'html') node.innerHTML = String(value);
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    });
    (children || []).forEach(function (child) {
      if (!child) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /** Clipboard with a fallback: file:// and some browsers block the async API. */
  function copy(text, button) {
    function done(ok) {
      if (!button) return;
      var label = button.textContent;
      button.textContent = ok ? 'Copied' : 'Press ⌘C';
      button.disabled = true;
      setTimeout(function () { button.textContent = label; button.disabled = false; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacy()); });
    } else {
      done(legacy());
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
  }

  /** A scannable thumbnail of the permanent URL, sized so it stays readable. */
  function qrThumb(url) {
    var badge = el('div', { class: 'qr-badge' });
    try {
      var svg = QR.toSVG(url, { margin: 1, size: 132, light: '#ffffff', dark: '#16161d' });
      badge.innerHTML = svg;
    } catch (err) {
      badge.appendChild(el('span', { class: 'tiny muted', text: 'QR unavailable' }));
    }
    badge.appendChild(el('span', { class: 'cap tiny muted', text: url }));
    return badge;
  }

  function tierSummary(profile) {
    var links = profile.links || [];
    var pub = links.filter(function (l) { return l.visibility === 'public'; }).length;
    var priv = links.length - pub;
    var over = pub > Access.LIMITS.maxPublicLinks;
    return el('p', { class: 'tiny ' + (over ? 'danger-text' : 'muted') }, [
      document.createTextNode(pub + ' public' + (priv ? ' + ' + priv + ' private' : '')),
      over ? document.createTextNode(' — over the free limit of ' + Access.LIMITS.maxPublicLinks) : null
    ].filter(Boolean));
  }

  function cardRow(summary, profile) {
    var url = summary.url || Store.profileUrlFor(summary.username, profile);
    var name = summary.display_name || summary.username;
    var starter = summary._starter || (profile && profile._starter);

    var urlRow = el('div', { class: 'url-row' }, [
      el('code', { class: 'url-value', text: url }),
      el('button', {
        class: 'btn btn-sm', type: 'button', text: 'Copy link',
        onclick: function (ev) { copy(url, ev.currentTarget); }
      }),
      el('a', {
        class: 'btn btn-sm btn-ghost', href: url, target: '_blank', rel: 'noopener', text: 'Open'
      })
    ]);

    var actions = el('div', { class: 'btn-row card-actions' }, [
      el('a', {
        class: 'btn btn-sm btn-ghost',
        href: 'dashboard/?u=' + encodeURIComponent(summary.username), text: 'Edit links'
      }),
      el('a', {
        class: 'btn btn-sm btn-ghost',
        href: 'card-builder/?u=' + encodeURIComponent(summary.username), text: 'Design card'
      }),
      el('a', {
        class: 'btn btn-sm btn-ghost',
        href: 'print/?u=' + encodeURIComponent(summary.username), text: 'Print sheet'
      }),
      el('a', {
        class: 'btn btn-sm btn-ghost',
        href: 'qr-generator/?url=' + encodeURIComponent(url), text: 'Bigger QR'
      })
    ]);

    var body = el('div', { class: 'card-index-body' }, [
      el('div', { class: 'card-index-head' }, [
        el('h3', { text: name }),
        starter ? el('span', { class: 'badge badge-muted', text: 'starter — edit me' }) : null
      ].filter(Boolean)),
      summary.designation ? el('p', { class: 'small muted card-index-role', text: summary.designation }) : null,
      el('p', { class: 'tiny muted' }, [
        document.createTextNode('Permanent URL — this is what the QR encodes, and it never changes:')
      ]),
      urlRow,
      tierSummary(profile || {}),
      actions
    ].filter(Boolean));

    return el('li', { class: 'card-index-row', 'data-username': summary.username }, [
      qrThumb(url),
      body
    ]);
  }

  /**
   * The index is generated, and a person editing JSON in GitHub's web UI cannot run a
   * generator. So both ways of refreshing it are offered, web UI first: this page is
   * often the first thing a new fork owner sees, and telling them to install Node.js
   * is how a template loses them.
   */
  function refreshHint() {
    return 'Add your username to the <code>profiles</code> list in ' +
      '<code>profile-data/index.json</code> — one line, editable right in GitHub\'s web ' +
      'UI — or run <code>npm run build</code> if you have Node.js.';
  }

  /**
   * Shown when the manifest names profiles that are not there any more: somebody
   * renamed or deleted a JSON file without regenerating the index. Their cards still
   * work, because /c/<username>/ loads <username>.json by name and 404.html serves the
   * path either way. Only this list is stale, and saying so beats looking broken.
   */
  function staleNotice(missing) {
    return el('div', { class: 'notice notice-warn mt2' }, [
      el('strong', { text: 'This list is out of date.' }),
      el('p', { class: 'small', html:
        'It still names ' + missing.map(function (name) {
          return '<code>' + escapeHtml(name) + '</code>';
        }).join(', ') + ', but there is no matching file in <code>profile-data/</code>.' }),
      el('p', { class: 'small', html:
        'Your links are not affected — <code>' + escapeHtml(Store.siteRoot()) +
        'c/&lt;username&gt;/</code> works whether or not this page is current. ' + refreshHint() })
    ]);
  }

  /**
   * A profile whose "username" field does not match its filename. The filename wins,
   * because that is what the URL is built from — but saying nothing leaves somebody
   * staring at a card whose URL is not the name they typed inside the file.
   */
  function mismatchNotice(mismatched) {
    return el('div', { class: 'notice notice-warn mt2' }, [
      el('strong', { text: mismatched.length === 1
        ? 'A username does not match its filename.'
        : mismatched.length + ' usernames do not match their filenames.' }),
      el('ul', { class: 'small' }, mismatched.map(function (m) {
        return el('li', { html:
          '<code>profile-data/' + escapeHtml(m.name) + '.json</code> says ' +
          '<code>"username": "' + escapeHtml(m.declared) + '"</code>. The filename is what ' +
          'your URL is built from, so this card is at <code>' + escapeHtml(Store.siteRoot()) +
          'c/' + escapeHtml(m.name) + '/</code> — set <code>"username"</code> to ' +
          '<code>' + escapeHtml(m.name) + '</code> so the two agree.' });
      }))
    ]);
  }

  function renderEmpty(target, missing) {
    target.innerHTML = '';
    target.appendChild(el('div', { class: 'empty-links' }, [
      el('p', { text: missing && missing.length ? 'No cards to list yet.' : 'No profiles yet.' }),
      el('p', { class: 'small', html:
        'Add a JSON file to <code>profile-data/</code>, named after the username you want ' +
        'in your URL — <code>profile-data/riley.json</code> becomes ' +
        '<code>/c/riley/</code>. Or copy one of the ' +
        '<a href="examples/">example profiles</a> and edit it.' }),
      el('p', { class: 'small', html: refreshHint() }),
      el('p', {}, [
        el('a', { class: 'btn', href: 'dashboard/', text: 'Open the dashboard' })
      ])
    ]));
    if (missing && missing.length) target.appendChild(staleNotice(missing));
  }

  /**
   * The themes this deployment can offer, read straight from the template registry
   * so a contributed template shows up here without anyone editing the page.
   */
  function renderThemes() {
    var strip = document.getElementById('theme-strip');
    if (!strip) return;
    var draw = function () {
      strip.innerHTML = '';
      TPL.all().forEach(function (t) {
        var bg = t.front.background;
        var swatch = bg.type === 'gradient'
          ? 'background:linear-gradient(135deg,' + bg.from + ' 0%,' + bg.to + ' 58%,' +
            t.front.accent + ' 58%,' + t.front.accent + ' 100%)'
          : 'background:' + bg.color + ';border-color:' + t.front.accent;
        strip.appendChild(el('div', { class: 'theme-card' }, [
          el('div', { class: 'theme-swatch', style: swatch, 'aria-hidden': 'true' }),
          el('h3', { text: t.name }),
          el('p', { class: 'small muted', text: t.description }),
          el('p', { class: 'tiny muted mb0' }, [
            el('a', { href: 'templates/', text: 'Preview both sides' })
          ])
        ]));
      });
      if (!strip.children.length) {
        strip.appendChild(el('p', { class: 'tiny muted', text: 'No templates registered.' }));
      }
    };
    // Community templates load asynchronously; render after them so a contributed
    // theme is not silently missing from the list. loadCommunity never rejects.
    if (typeof TPL.loadCommunity === 'function') {
      TPL.loadCommunity(Store.rootRelative('card-templates/community/')).then(draw, draw);
    } else {
      draw();
    }
  }

  function start() {
    renderThemes();
    var target = document.getElementById('cards');
    var count = document.getElementById('card-count');
    var firstRun = document.getElementById('first-run');

    Store.listProfilesDetailed()
      .then(function (result) {
        var summaries = result.profiles;
        // Usernames the manifest still names, but which have no file any more.
        var missing = result.missing.slice();
        var mismatched = (result.mismatched || []).slice();

        if (!summaries.length) {
          if (firstRun) firstRun.hidden = false;
          if (count) count.textContent = '0 cards';
          renderEmpty(target, missing);
          return;
        }

        // Load the full profiles so the counts and the starter flag are accurate.
        return Promise.all(summaries.map(function (s) {
          return Store.loadProfile(s.username).then(function (p) { return { summary: s, profile: p }; });
        })).then(function (loaded) {
          // A profile can still fail here — malformed JSON, or a localStorage copy that
          // was cleared mid-flight — so keep the guard even though the manifest names
          // were already resolved above. Rendering a card for somebody whose data did
          // not load is worse than rendering nothing: it looks like the site works while
          // the one card the owner cares about is missing.
          var rows = loaded.filter(function (r) { return !!r.profile; });
          loaded.forEach(function (r) {
            if (!r.profile && missing.indexOf(r.summary.username) < 0) {
              missing.push(r.summary.username);
            }
          });

          if (!rows.length) {
            if (firstRun) firstRun.hidden = false;
            if (count) count.textContent = '0 cards';
            renderEmpty(target, missing);
            return;
          }

          var starterOnly = rows.every(function (r) {
            return (r.summary._starter) || (r.profile && r.profile._starter);
          });
          if (firstRun) firstRun.hidden = !starterOnly;
          if (count) {
            count.textContent = rows.length + (rows.length === 1 ? ' card' : ' cards') +
              ' · ' + Store.siteRoot();
          }

          target.innerHTML = '';
          var list = el('ul', { class: 'card-index-list' });
          rows.forEach(function (r) {
            var checked = Access.validateProfile(r.profile || {});
            var row = cardRow(r.summary, r.profile);
            if (!checked.ok) {
              row.appendChild(el('p', { class: 'tiny danger-text', text:
                'This profile has problems: ' + checked.errors.slice(0, 3).join('; ') }));
            }
            list.appendChild(row);
          });
          target.appendChild(list);

          if (mismatched.length) target.appendChild(mismatchNotice(mismatched));
          if (missing.length) target.appendChild(staleNotice(missing));

          target.appendChild(el('p', { class: 'tiny muted mt2', html:
            'Every URL above is <code>' + escapeHtml(Store.siteRoot()) + 'c/&lt;username&gt;/</code>, derived ' +
            'from where this site is served. Put it in a QR and print it — see ' +
            '<a href="docs/PRINTING.md">PRINTING.md</a> for the card spec and ' +
            '<a href="print/">the print sheet</a>.' }));
        });
      })
      .catch(function (err) {
        target.innerHTML = '';
        target.appendChild(el('div', { class: 'notice notice-danger' }, [
          el('strong', { text: 'Could not read your profiles.' }),
          el('p', { class: 'small', text: String(err && err.message || err) }),
          el('p', { class: 'small', html:
            'This page fetches <code>profile-data/index.json</code>, so it needs to be served over http ' +
            '(<code>python3 -m http.server</code>) rather than opened as a file. If you just added a ' +
            'profile, run <code>npm run build</code> to refresh the index.' })
        ]));
      });
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
