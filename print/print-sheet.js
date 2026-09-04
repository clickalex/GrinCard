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
    var url = profile.profile_url ||
      (location.origin + location.pathname.replace(/\/print-sheet\.html$/, '/profile.html') +
        '?u=' + encodeURIComponent(profile.username));
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

  function boot() {
    var params = new URLSearchParams(location.search);
    var username = params.get('u') || Store.getLastUsername() || 'rahul123';
    var ecl = params.get('ecl') || 'Q';

    Store.loadProfile(username).then(function (profile) {
      if (!profile) {
        sheet.innerHTML = '';
        sheet.appendChild(el('div', { class: 'empty-links' }, [
          el('p', { text: 'No profile called “' + username + '”.' }),
          el('p', { html: 'Try <a href="?u=rahul123">rahul123</a> or build one in the ' +
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
      location.href = '../dashboard/?u=' + encodeURIComponent(username);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
