/*!
 * examples/gallery.js — renders the fixture profiles with a link for each tier.
 *
 * The point of this page is that the four links in every row are the SAME URL with
 * different query parameters, which is the whole thesis of the project: print one
 * permanent code, and let the arrival decide what is shown.
 *
 * Everything is read from examples/*.json — including the tokens, so the temporary
 * and expired scenarios use real fixture values rather than hardcoded strings that
 * could drift out of sync with the data (and with the tests, which read the same
 * files).
 */
(function () {
  'use strict';

  var Store = window.Store;
  var Access = window.AccessRules;

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'html') node.innerHTML = String(value);
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (c) {
      if (!c) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /** The profile page, with whatever query parameters a scenario needs. */
  function scenarioHref(username, extra) {
    var q = new URLSearchParams();
    q.set('u', username);
    q.set('demo', '1');           // shows the tier switcher on the profile page
    Object.keys(extra || {}).forEach(function (k) { if (extra[k]) q.set(k, extra[k]); });
    return Store.rootRelative('profile/?') + q.toString();
  }

  /**
   * Pick the fixtures that make each scenario meaningful: one live token, one
   * expired, and one approved follower — for THIS profile, from examples/tokens.json.
   */
  function scenarioData(registry, username) {
    var tokens = (registry && registry.tokens) || [];
    var followers = (registry && registry.followers) || [];
    var mine = tokens.filter(function (t) { return t.profile_username === username; });

    // evaluateToken takes the token VALUE, the profile username and the registry —
    // the same call the profile page makes when a visitor arrives with ?t=. Using
    // the real function (rather than re-implementing expiry here) is what keeps this
    // gallery honest: if the rules change, these links change with them.
    function verdict(token) {
      return Access.evaluateToken(token.token_value, username, registry);
    }

    var live = mine.filter(function (t) { return verdict(t).valid; })[0];

    // Specifically a token that WAS valid and is no longer — not one that is
    // malformed or belongs to someone else. The scenario is labelled "after it
    // expired", so it has to actually be that.
    var expired = mine.filter(function (t) {
      var v = verdict(t);
      return !v.valid && (v.reason === 'expired' || v.reason === 'exhausted');
    })[0];
    var approved = followers.filter(function (f) {
      return f.profile_username === username && f.status === 'approved';
    })[0];

    return {
      live: live ? live.token_value : null,
      expired: expired ? expired.token_value : null,
      follower: approved ? approved.follower_id : null
    };
  }

  function scenarioRow(username, data) {
    var items = [
      {
        label: 'Stranger scans the card',
        href: scenarioHref(username),
        note: 'public links only'
      },
      {
        label: 'Temporary link you sent',
        href: data.live ? scenarioHref(username, { t: data.live }) : null,
        note: data.live ? 'public + one private link' : 'no live token in the fixtures'
      },
      {
        label: 'Same link, after it expired',
        href: data.expired ? scenarioHref(username, { t: data.expired }) : null,
        note: data.expired ? 'degrades to public, never 404' : 'no expired token in the fixtures'
      },
      {
        label: 'Approved follower, signed in',
        href: data.follower ? scenarioHref(username, { viewer: data.follower }) : null,
        note: data.follower ? 'every link, including private' : 'no approved follower in the fixtures'
      }
    ];

    return el('ul', { class: 'scenario-list example-scenarios' }, items.map(function (item) {
      return el('li', {}, [
        item.href
          ? el('a', { href: item.href }, [
              el('span', { class: 'scenario-label', text: item.label }),
              el('span', { class: 'scenario-note tiny muted', text: item.note })
            ])
          : el('span', { class: 'scenario-label muted', title: item.note }, [
              document.createTextNode(item.label + ' — ' + item.note)
            ])
      ]);
    }));
  }

  function profilePanel(summary, profile, registry) {
    var links = profile.links || [];
    var pub = links.filter(function (l) { return l.visibility === 'public'; });
    var priv = links.length - pub.length;
    var url = Store.profileUrlFor(profile.username, profile);
    var data = scenarioData(registry, profile.username);

    return el('section', { class: 'panel', 'data-username': profile.username }, [
      el('div', { class: 'panel-head' }, [
        el('h2', { text: profile.display_name || profile.username }),
        el('span', { class: 'hint', text: profile.designation || '' }),
        el('span', { class: 'badge badge-public', text: pub.length + ' public' }),
        priv ? el('span', { class: 'badge badge-private', text: priv + ' private' }) : null
      ]),
      el('p', { class: 'small muted' }, [
        document.createTextNode('Permanent URL: '),
        el('code', { text: url })
      ]),
      scenarioRow(profile.username, data),
      el('div', { class: 'btn-row mt1' }, [
        // Both carry demo=1. Navigating to another page loses this one's
        // <body data-profile-dir>, and without the flag the destination would read
        // profile-data/ — where these fixtures deliberately do not live — and show
        // an empty form instead of the person you clicked.
        el('a', {
          class: 'btn btn-sm btn-ghost',
          href: Store.rootRelative('card-builder/?demo=1&u=' + encodeURIComponent(profile.username)),
          text: 'Design a card for this person'
        }),
        el('a', {
          class: 'btn btn-sm btn-ghost',
          href: Store.rootRelative('print/?demo=1&u=' + encodeURIComponent(profile.username)),
          text: 'Print sheet'
        })
      ])
    ]);
  }

  function start() {
    var target = $('examples');
    var limit = $('limit-public');
    if (limit) limit.textContent = String(Access.LIMITS.maxPublicLinks);

    Store.listProfiles().then(function (summaries) {
      if (!summaries.length) {
        clear(target);
        target.appendChild(el('div', { class: 'notice notice-danger' }, [
          el('div', { html: 'No example profiles found. They live in <code>examples/*.json</code> and are ' +
            'listed in <code>examples/index.json</code> — rebuild it with ' +
            '<code>node tools/build-links.js --data examples --manifest-only</code>.' })
        ]));
        return;
      }
      return Promise.all(summaries.map(function (s) {
        return Promise.all([Store.loadProfile(s.username), Store.loadRegistry(s.username)])
          .then(function (pair) {
            return { summary: s, profile: pair[0], registry: pair[1] };
          });
      })).then(function (rows) {
        clear(target);
        rows.forEach(function (row) {
          if (!row.profile) return;
          var checked = Access.validateProfile(row.profile);
          target.appendChild(profilePanel(row.summary, checked.ok ? checked.profile : row.profile, row.registry));
        });
      });
    }).catch(function (err) {
      clear(target);
      target.appendChild(el('div', { class: 'notice notice-danger' }, [
        el('strong', { text: 'Could not load the examples.' }),
        el('p', { class: 'small', text: String(err && err.message || err) }),
        el('p', { class: 'small', html: 'This page fetches JSON, so it needs to be served over http ' +
          '(<code>python3 -m http.server</code>) rather than opened as a file.' })
      ]));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
