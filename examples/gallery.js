/*!
 * examples/gallery.js — renders the fixture profiles, one share link each.
 *
 * Every row shows the SAME permanent URL that the printed QR encodes, with a copy
 * button beside it: one card, one link, and the theme is the only thing that varies
 * from profile to profile. Each fixture wears a different card template so the page
 * doubles as the showcase for the built-in themes.
 *
 * Everything is read from examples/*.json — including the theme and the colours, so
 * the swatches here cannot drift out of sync with what the profile page paints.
 */
(function () {
  'use strict';

  var Store = window.Store;
  var Access = window.AccessRules;
  var TPL = window.CardTemplates;

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

  /**
   * Clipboard with a fallback, because file:// and plain-http deployments block the
   * async API. Same behaviour as the copy button on the site root.
   */
  function copy(text, button) {
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
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacy()); });
    } else {
      done(legacy());
    }
  }

  /**
   * The profile page for a fixture. `demo=1` is not decoration: this page reads
   * examples/ through <body data-profile-dir>, but navigating drops that attribute
   * with the page, so the destination needs the flag to know which directory to
   * load from. Without it every link here would render "No profile here".
   */
  function profileHref(username) {
    var q = new URLSearchParams();
    q.set('u', username);
    q.set('demo', '1');
    return Store.rootRelative('profile/?') + q.toString();
  }

  /** The template this demo is themed with, and its own colours. */
  function themeTag(profile) {
    var template = TPL.get(profile.card_settings && profile.card_settings.template_id);
    var bg = template.front.background;
    var swatch = bg.type === 'gradient'
      ? 'background:linear-gradient(135deg,' + bg.from + ',' + bg.to + ');--dot:' + template.front.accent
      : 'background:' + bg.color + ';--dot:' + template.front.accent;
    return el('span', { class: 'theme-tag' }, [
      el('span', { class: 'swatch-dot', style: swatch, 'aria-hidden': 'true' }),
      document.createTextNode(template.name + ' · ' + template.id)
    ]);
  }

  /**
   * One row: the permanent URL as selectable text, a button that copies it, and a
   * link that opens the card. That is the whole sharing story, for a demo exactly
   * as it is for a real card.
   */
  function shareRow(username, url) {
    var button = el('button', { class: 'btn btn-sm', type: 'button', text: 'Copy link' });
    button.addEventListener('click', function () { copy(url, button); });
    return el('div', { class: 'example-share' }, [
      el('div', { class: 'url-row' }, [
        el('code', { class: 'url-value', text: url }),
        button,
        el('a', {
          class: 'btn btn-sm btn-ghost', href: profileHref(username),
          target: '_blank', rel: 'noopener', text: 'Open card'
        })
      ])
    ]);
  }

  function profilePanel(summary, profile) {
    var links = profile.links || [];
    var pub = links.filter(function (l) { return l.visibility === 'public'; });
    var priv = links.length - pub.length;
    var url = Store.profileUrlFor(profile.username, profile);

    return el('section', { class: 'panel', 'data-username': profile.username }, [
      el('div', { class: 'panel-head' }, [
        el('h2', { text: profile.display_name || profile.username }),
        el('span', { class: 'hint', text: profile.designation || '' }),
        themeTag(profile),
        el('span', { class: 'badge badge-public', text: pub.length + ' public' }),
        priv ? el('span', { class: 'badge badge-private', text: priv + ' private' }) : null
      ]),
      shareRow(profile.username, url),
      el('p', { class: 'tiny muted mb0' }, [
        document.createTextNode(priv
          ? priv + (priv === 1 ? ' link is' : ' links are') + ' private and appear only on a link the owner sends.'
          : 'Every link here is public.')
      ]),
      el('div', { class: 'btn-row mt1' }, [
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

  /** Load every fixture profile and render one panel per person. */
  function renderGallery(target) {
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
        return Store.loadProfile(s.username).then(function (profile) {
          return { summary: s, profile: profile };
        });
      })).then(function (rows) {
        clear(target);
        rows.forEach(function (row) {
          if (!row.profile) return;
          var checked = Access.validateProfile(row.profile);
          target.appendChild(profilePanel(row.summary, checked.ok ? checked.profile : row.profile));
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

  function start() {
    var target = $('examples');
    var limit = $('limit-public');
    if (limit) limit.textContent = String(Access.LIMITS.maxPublicLinks);

    // Contributed templates are fetched at runtime, so a demo themed with one shows its
    // real name and swatch instead of falling back to template-1. loadCommunity never
    // rejects: a missing folder just means no extra templates.
    var ready = (TPL && typeof TPL.loadCommunity === 'function')
      ? TPL.loadCommunity(Store.rootRelative('card-templates/community/'))
      : Promise.resolve([]);
    ready.then(function () { renderGallery(target); }, function () { renderGallery(target); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
