/*!
 * print-sheet.js — lays both sides out at true millimetre size so the browser's
 * own print dialog produces a 1:1 sheet (§7.1, Appendix C).
 *
 * For a print shop, download the PDF from the dashboard instead: it is vector
 * and carries an exact 89 x 51 mm page size. This page is for the "print one on
 * my deskjet and check it" case.
 */
(function () {
  'use strict';

  var Store = window.Store;
  var Card = window.Card;
  var Access = window.AccessRules;

  var sheet = document.getElementById('sheet');
  var bleed = false;
  var card = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function render() {
    if (!card) return;
    sheet.innerHTML = '';
    ['front', 'back'].forEach(function (side) {
      var svg = Card.toSVG(card, side, { bleed: bleed, pxPerMm: 4 });
      var figure = el('figure', { class: 'sheet-card' + (bleed ? ' bleed' : '') });
      // Inline the SVG rather than using <img>: it keeps print scaling exact and
      // avoids a second network round trip for a data URL.
      figure.insertAdjacentHTML('beforeend', svg);
      figure.appendChild(el('figcaption', {
        text: side === 'front' ? 'Front' : 'Back — scan this side'
      }));
      sheet.appendChild(figure);
    });
    document.getElementById('sheet-note').textContent =
      (bleed ? 'With 3 mm bleed (95 × 57 mm): ' : 'Trim size (89 × 51 mm): ') +
      'print on ' + (bleed ? '95 × 57 mm or larger stock, then cut to 89 × 51 mm.' : 'standard card stock.');
  }

  function build(profile, ecl) {
    // The QR always encodes the permanent /c/<username>/ URL, derived from where
    // this site is served. It is never a destination and never a temporary token:
    // a printed code cannot be revoked, so it must not be able to expire.
    var url = Store.profileUrlFor(profile.username, profile);
    var opts = { profileUrl: url, ecl: ecl || 'Q' };

    var photo = profile.photo_url;
    if (photo && !/^data:/i.test(photo)) {
      // A remote photo may be blocked for cross-origin export, but it prints
      // fine in-page, so keep it and mention it.
      opts.photoDataUrl = photo;
    } else if (photo) {
      opts.photoDataUrl = photo;
    }
    card = Card.buildCard(profile, opts);
    render();
  }

  /**
   * Which profile to lay out? Explicit ?u= wins, then whoever was edited most
   * recently in this browser, then the first real profile this deployment has.
   * Never a hardcoded demo name: on a fork that person does not exist.
   */
  function resolveUsername(params) {
    var explicit = params.get('u') || Store.getLastUsername();
    if (explicit) return Promise.resolve(explicit);
    return Store.listProfiles().then(function (list) {
      var real = list.filter(function (p) { return !p._starter; })[0];
      return (real || list[0] || {}).username || '';
    }).catch(function () { return ''; });
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    var ecl = params.get('ecl') || 'Q';
    var resolvedUsername = '';   // read by the button handlers below, which are
                                 // wired before the profile promise settles

    // Contributed templates must be registered before we draw: a profile whose
    // card_settings pick one would otherwise fall back to template-1 and print a
    // card that does not match what the gallery showed.
    var community = window.CardTemplates.loadCommunity(
      Store.rootRelative('card-templates/community/'));

    Promise.all([resolveUsername(params), community]).then(function (resolved) {
      var username = resolved[0];
      return Store.loadProfile(username).then(function (profile) {
        return { username: username, profile: profile };
      });
    }).then(function (loaded) {
      var username = loaded.username;
      var profile = loaded.profile;
      resolvedUsername = username;
      if (!profile) {
        sheet.innerHTML = '';
        sheet.appendChild(el('div', { class: 'empty-links' }, [
          el('p', { text: username ? 'No profile called “' + username + '”.' : 'No profiles yet.' }),
          el('p', { html: 'Pick one from <a href="../index.html">your cards</a>, look at the ' +
            '<a href="../examples/">example profiles</a>, or build one in the ' +
            '<a href="../card-builder/">card builder</a>.' })
        ]));
        return;
      }
      var checked = Access.validateProfile(profile);
      build(checked.ok ? checked.profile : profile, ecl);
      document.title = (profile.display_name || username) + ' — print sheet';
    }).catch(function (err) {
      sheet.innerHTML = '';
      sheet.appendChild(el('div', { class: 'notice notice-danger' }, [
        el('div', {}, [
          el('strong', { text: 'Could not load the profile.' }),
          el('p', { class: 'small', text: String(err.message || err) })
        ])
      ]));
    });

    document.getElementById('btn-print').addEventListener('click', function () { window.print(); });
    document.getElementById('btn-bleed').addEventListener('click', function () {
      bleed = !bleed;
      this.textContent = bleed ? 'Remove 3 mm bleed' : 'Toggle 3 mm bleed';
      render();
    });
    document.getElementById('btn-pdf').addEventListener('click', function (e) {
      e.preventDefault();
      if (!resolvedUsername) { location.href = '../dashboard/'; return; }
      location.href = '../dashboard/?u=' + encodeURIComponent(resolvedUsername);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
