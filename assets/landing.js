/*!
 * landing.js — the two live bits of the homepage: the hero QR (which you can
 * point at your own URL) and the card showcase drawn from the demo profiles.
 */
(function () {
  'use strict';

  var Card = window.Card;
  var TPL = window.CardTemplates;

  var DEMO_URL = 'demo/profile.html?u=rahul123';

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

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch (e) { return url; }
  }

  // ---------------------------------------------------------------------------
  // Hero QR
  // ---------------------------------------------------------------------------

  function renderHeroQr() {
    var box = document.getElementById('hero-qr');
    if (!box) return;
    var target = absolute(DEMO_URL);
    box.innerHTML = window.QRCode.toSVG(target, {
      margin: 2, width: 132, colorDark: '#16161d', colorLight: '#ffffff',
      title: 'Scan to open the demo profile'
    });
    var cap = document.getElementById('hero-qr-cap');
    cap.textContent = target.replace(/^https?:\/\//, '');

    // Scanning it from a phone only works if this host is reachable from the
    // phone, so say what it encodes and let the reader swap in their own domain.
    box.parentElement.title = 'Encodes ' + target + ' — click to point it at your own URL';
    box.parentElement.addEventListener('click', function () {
      var own = window.prompt(
        'Encode your own profile URL (this is what would be printed on your card):',
        'https://your-domain.example/c/yourname'
      );
      if (!own) return;
      try {
        box.innerHTML = window.QRCode.toSVG(own, {
          margin: 2, width: 132, colorDark: '#16161d', colorLight: '#ffffff', title: own
        });
        cap.textContent = own.replace(/^https?:\/\//, '');
      } catch (err) {
        cap.textContent = 'too long to encode';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Card showcase
  // ---------------------------------------------------------------------------

  var SHOWCASE = [
    { username: 'rahul123', template: 'template-1', blurb: 'Freelance illustrator' },
    { username: 'meera9', template: 'template-2', blurb: 'Shop owner, Delhi' },
    { username: 'rahul123', template: 'template-3', blurb: 'High contrast, no colour ink' }
  ];

  function renderShowcase(profiles) {
    var box = document.getElementById('showcase');
    if (!box) return;
    box.innerHTML = '';

    SHOWCASE.forEach(function (item) {
      var profile = profiles[item.username];
      if (!profile) return;
      var template = TPL.get(item.template);
      var variant = JSON.parse(JSON.stringify(profile));
      variant.card_settings = Object.assign({}, profile.card_settings, { template_id: item.template });
      var url = variant.profile_url || absolute(DEMO_URL);

      var card;
      try {
        card = Card.buildCard(variant, { profileUrl: url, ecl: 'Q' });
      } catch (err) {
        box.appendChild(el('div', { class: 'notice notice-danger small', text: template.name + ': ' + err.message }));
        return;
      }

      var duo = el('div', { class: 'duo' }, [
        sideFigure(card, 'front', 'Front'),
        sideFigure(card, 'back', 'Back')
      ]);

      box.appendChild(el('div', { class: 'showcase-item' }, [
        duo,
        el('h3', { text: template.name }),
        el('p', { text: item.blurb }),
        el('p', { class: 'mini', html:
          '<a href="' + (variant.profile_url || DEMO_URL) + '">See the page this card opens →</a>' })
      ]));
    });
  }

  function sideFigure(card, side, caption) {
    var node = el('figure');
    node.insertAdjacentHTML('beforeend', Card.toSVG(card, side, { pxPerMm: 5 }));
    node.appendChild(el('figcaption', { text: caption }));
    return node;
  }

  function boot() {
    renderHeroQr();

    var wanted = SHOWCASE.map(function (s) { return s.username; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });

    Promise.all(wanted.map(function (username) {
      return fetch('profile-data/' + username + '.json', { cache: 'no-store' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; })
        .then(function (p) { return [username, p]; });
    })).then(function (pairs) {
      var profiles = {};
      pairs.forEach(function (pair) { if (pair[1]) profiles[pair[0]] = pair[1]; });
      if (!Object.keys(profiles).length) {
        var box = document.getElementById('showcase');
        if (box) {
          box.innerHTML = '';
          box.appendChild(el('div', { class: 'notice notice-warn small' }, [
            el('div', { html: 'Card previews need the demo profiles to be fetched over http. ' +
              'Run <code>python3 -m http.server</code> in the repo — see ' +
              '<a href="SETUP.md">SETUP.md</a>.' })
          ]));
        }
        return;
      }
      renderShowcase(profiles);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
