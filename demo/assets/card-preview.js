/*!
 * card-preview.js — renders every template against a chosen demo profile (§7.1).
 * Useful for picking a design, and for checking that a new template renders
 * sensibly with long names, missing photos and both layouts.
 */
(function () {
  'use strict';

  var TPL = window.CardTemplates;
  var Card = window.Card;
  var Store = window.Store;
  var Access = window.AccessRules;

  var candidates = ['rahul123', 'meera9'];
  var profiles = {};
  var current = candidates[0];

  function $(id) { return document.getElementById(id); }

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

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function profileUrl(profile) {
    return profile.profile_url ||
      (location.origin + location.pathname.replace(/\/card-preview\.html$/, '/profile.html') +
        '?u=' + encodeURIComponent(profile.username));
  }

  function renderPicker() {
    var box = $('profile-picker');
    clear(box);
    candidates.forEach(function (username) {
      var p = profiles[username];
      if (!p) return;
      box.appendChild(el('button', {
        type: 'button', text: p.display_name + ' (' + username + ')',
        'aria-pressed': username === current ? 'true' : 'false',
        onclick: function () { current = username; renderPicker(); renderTemplates(); renderQr(); }
      }));
    });
  }

  function renderTemplates() {
    var box = $('templates');
    clear(box);
    var profile = profiles[current];
    if (!profile) return;
    var url = profileUrl(profile);

    TPL.TEMPLATES.forEach(function (template) {
      var variant = JSON.parse(JSON.stringify(profile));
      variant.card_settings = Object.assign({}, profile.card_settings, { template_id: template.id });
      var card = Card.buildCard(variant, { profileUrl: url, ecl: 'Q' });

      var panel = el('section', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('h2', { text: template.name }),
          el('span', { class: 'hint', text: template.description }),
          el('span', { class: 'badge badge-public', text: template.layout === 'centered' ? 'centred' : 'photo left' })
        ]),
        el('div', { class: 'card-duo' }, [
          figure(card, 'front', 'Front'),
          figure(card, 'back', 'Back')
        ])
      ]);

      // Long-content stress test: the same template with an awkward name.
      var stress = JSON.parse(JSON.stringify(variant));
      stress.display_name = 'Chandrasekhar Venkateswaran';
      stress.designation = 'Senior Consultant, Packaging & Brand Strategy';
      stress.tagline = 'Available for commissions across South India and remotely worldwide';
      var stressCard = Card.buildCard(stress, { profileUrl: url, ecl: 'Q' });
      panel.appendChild(el('div', { class: 'card-duo mt2' }, [
        figure(stressCard, 'front', 'Front · long text'),
        figure(stressCard, 'back', 'Back · long text')
      ]));
      panel.appendChild(el('p', { class: 'tiny muted mt1',
        text: 'Type is shrunk and then ellipsised so nothing can overflow the trim area.' }));

      box.appendChild(panel);
    });
  }

  function figure(card, side, caption) {
    var node = el('figure', { class: 'card-frame' });
    node.insertAdjacentHTML('beforeend', Card.toSVG(card, side, { pxPerMm: 5 }));
    node.appendChild(el('figcaption', { class: 'sr-only', text: caption }));
    return node;
  }

  function renderQr() {
    var profile = profiles[current];
    if (!profile) return;
    var url = profileUrl(profile);
    var qr = window.QRCode.create(url, { ecl: 'Q' });
    var box = $('qr-standalone');
    clear(box);
    box.insertAdjacentHTML('beforeend',
      window.QRCode.toSVG(url, { margin: 4, width: 280, colorDark: '#111111', title: url }));

    $('qr-content').textContent = url;
    $('qr-version').textContent = 'Version ' + qr.version + ' (auto-selected for this URL length)';
    $('qr-modules').textContent = qr.size + ' × ' + qr.size;
    $('qr-printed').textContent = TPL.GEOMETRY.qrSizeMm + ' mm on the card (spec minimum 20 mm) · ' +
      (TPL.GEOMETRY.qrSizeMm / qr.size).toFixed(2) + ' mm per module';
  }

  function boot() {
    Promise.all(candidates.map(function (username) {
      return Store.loadProfile(username).then(function (p) {
        if (!p) return null;
        var checked = Access.validateProfile(p);
        profiles[username] = checked.ok ? checked.profile : p;
        return username;
      });
    })).then(function () {
      var available = candidates.filter(function (u) { return profiles[u]; });
      if (!available.length) {
        $('templates').appendChild(el('div', { class: 'notice notice-danger' }, [
          el('div', { html: 'No demo profiles could be loaded. Serve this folder over http — see ' +
            '<a href="../SETUP.md">SETUP.md</a>.' })
        ]));
        return;
      }
      current = available[0];
      candidates = available;
      renderPicker();
      renderTemplates();
      renderQr();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
