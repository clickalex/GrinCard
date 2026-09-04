/*!
 * builder.js — the card builder (§7.1, §8.2 step 2).
 *
 * Deliberately narrower than the dashboard: name, role, photo, template, links,
 * download. Tokens and follower approvals live in the dashboard so this page
 * stays a "get a card in two minutes" tool.
 */
(function () {
  'use strict';

  var Access = window.AccessRules;
  var Store = window.Store;
  var TPL = window.CardTemplates;
  var Card = window.Card;
  var Exporter = window.Exporter;

  var draft = {
    username: 'rahul123',
    display_name: 'Rahul Kumar',
    designation: 'Freelance Illustrator',
    tagline: 'Brands, packaging and the occasional mural',
    photo_url: '',
    profile_url: '',
    created_at: new Date().toISOString(),
    links: [
      { id: 'lnk_1', label: 'Instagram', url: 'https://instagram.com/rahul_art', visibility: 'public', order: 1 },
      { id: 'lnk_2', label: 'Portfolio', url: 'https://behance.net/rahulkumar', visibility: 'public', order: 2 },
      { id: 'lnk_3', label: 'Pricing List', url: 'https://docs.example.com/pricing', visibility: 'followers_only', order: 3 },
      { id: 'lnk_4', label: 'WhatsApp', url: 'https://wa.me/911234567890', visibility: 'followers_only', order: 4 }
    ],
    card_settings: { template_id: 'template-1', show_photo: true }
  };
  var ecl = 'Q';

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = !!value;
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) {
      if (child == null) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function alert(kind, message) {
    var note = el('div', { class: 'notice notice-' + kind, role: 'status', html: message });
    $('alerts').appendChild(note);
    setTimeout(function () { note.remove(); }, 8000);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments, self = this;
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function defaultUrl(username) {
    return location.origin + Store.pageRelative('../demo/profile.html') +
      '?u=' + encodeURIComponent(username || 'yourname');
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderTemplates() {
    var box = $('b-templates');
    clear(box);
    TPL.TEMPLATES.forEach(function (t) {
      var bg = t.front.background;
      var style = bg.type === 'gradient'
        ? 'background:linear-gradient(135deg,' + bg.from + ',' + bg.to + ')'
        : 'background:' + bg.color;
      box.appendChild(el('button', {
        type: 'button', class: 'template-option',
        'aria-pressed': draft.card_settings.template_id === t.id ? 'true' : 'false',
        onclick: function () {
          draft.card_settings.template_id = t.id;
          renderTemplates(); renderPreview();
        }
      }, [
        el('span', { class: 'swatch', style: style }),
        el('span', { class: 'name', text: t.name }),
        el('span', { class: 'desc', text: t.description })
      ]));
    });
    $('b-tpl-name').textContent = TPL.get(draft.card_settings.template_id).name;
  }

  function renderEcl() {
    Array.prototype.forEach.call($('b-ecl').children, function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-ecl') === ecl ? 'true' : 'false');
    });
  }

  function renderLinks() {
    var box = $('b-links');
    clear(box);
    Access.sortedLinks(draft).forEach(function (link, index) {
      box.appendChild(el('div', { class: 'row link-row' }, [
        el('div', { class: 'link-main' }, [
          el('input', {
            type: 'text', value: link.label, placeholder: 'Label',
            'aria-label': 'Link ' + (index + 1) + ' label',
            oninput: function (e) { link.label = e.target.value; }
          }),
          el('input', {
            type: 'url', value: link.url, placeholder: 'https://…',
            'aria-label': 'Link ' + (index + 1) + ' URL',
            oninput: function (e) { link.url = e.target.value; }
          })
        ]),
        el('div', { class: 'link-main' }, [
          el('div', { class: 'segmented', role: 'group', 'aria-label': 'Visibility' }, [
            el('button', {
              type: 'button', text: 'Public',
              'aria-pressed': link.visibility !== 'followers_only' ? 'true' : 'false',
              onclick: function () { link.visibility = 'public'; renderLinks(); }
            }),
            el('button', {
              type: 'button', text: 'Followers only',
              'aria-pressed': link.visibility === 'followers_only' ? 'true' : 'false',
              onclick: function () { link.visibility = 'followers_only'; renderLinks(); }
            })
          ]),
          el('div', { class: 'row-tools' }, [
            el('button', {
              type: 'button', class: 'icon-btn danger', text: '✕', title: 'Delete',
              'aria-label': 'Delete link',
              onclick: function () {
                var i = draft.links.indexOf(link);
                if (i >= 0) draft.links.splice(i, 1);
                Access.sortedLinks(draft).forEach(function (l, n) { l.order = n + 1; });
                renderLinks();
              }
            })
          ])
        ])
      ]));
    });
  }

  function profileForRender() {
    var p = JSON.parse(JSON.stringify(draft));
    if (!p.username) p.username = 'yourname';
    if (!p.display_name) p.display_name = 'Your Name';
    if (!p.profile_url) p.profile_url = defaultUrl(p.username);
    return p;
  }

  var renderPreview = debounce(function () {
    var card;
    try {
      card = Card.buildCard(profileForRender(), { profileUrl: profileForRender().profile_url, ecl: ecl });
    } catch (err) {
      alert('danger', 'Preview failed: ' + escapeHtml(err.message));
      return;
    }
    $('b-front').src = Card.toDataURL(card, 'front', { pxPerMm: 6 });
    $('b-back').src = Card.toDataURL(card, 'back', { pxPerMm: 6 });
  }, 160);

  function prepare() {
    readForm();
    return Exporter.prepareCard(profileForRender(), {
      profileUrl: draft.profile_url || defaultUrl(draft.username),
      ecl: ecl
    });
  }

  function showWarnings(warnings) {
    var box = $('b-warnings');
    clear(box);
    (warnings || []).forEach(function (w) {
      box.appendChild(el('div', { class: 'notice notice-warn small', html: escapeHtml(w) }));
    });
  }

  function readForm() {
    draft.username = $('b-username').value.trim();
    draft.display_name = $('b-name').value.trim();
    draft.designation = $('b-role').value.trim();
    draft.tagline = $('b-tagline').value.trim();
    draft.profile_url = $('b-url').value.trim();
    draft.card_settings.show_photo = $('b-show-photo').checked;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function addLink() {
    var order = draft.links.reduce(function (m, l) { return Math.max(m, l.order || 0); }, 0) + 1;
    draft.links.push({ id: 'lnk_' + Date.now().toString(36), label: '', url: '', visibility: 'public', order: order });
    renderLinks();
  }

  function onPhoto(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      Exporter.toEmbeddedDataUrl(reader.result, 600, 0.92).then(function (dataUrl) {
        draft.photo_url = dataUrl;
        $('b-show-photo').checked = true;
        renderPreview();
        alert('ok', 'Photo embedded (' + Math.round(dataUrl.length / 1024) + ' KB).');
      }).catch(function (err) {
        alert('danger', 'Could not read that image: ' + escapeHtml(err.message));
      });
    };
    reader.readAsDataURL(file);
  }

  function saveAndOpenDashboard() {
    readForm();
    if (!draft.username) { alert('danger', 'A username is required — it is the URL in the QR.'); return; }
    var result = Store.saveProfile(draft);
    if (!result.ok) {
      alert('danger', 'Could not save:<ul>' + result.errors.map(function (e) {
        return '<li>' + escapeHtml(e) + '</li>';
      }).join('') + '</ul>');
      return;
    }
    location.href = '../dashboard/?u=' + encodeURIComponent(result.profile.username);
  }

  function downloadJson() {
    readForm();
    var p = JSON.parse(JSON.stringify(draft));
    Access.sortedLinks(p).forEach(function (l, i) { l.order = i + 1; });
    p.links = Access.sortedLinks(p);
    if (!p.profile_url) p.profile_url = defaultUrl(p.username);
    Exporter.download(
      new Blob([JSON.stringify(p, null, 2) + '\n'], { type: 'application/json' }),
      (p.username || 'profile') + '.json'
    );
    alert('ok', 'Downloaded <code>' + escapeHtml(p.username || 'profile') +
      '.json</code>. Put it in <code>profile-data/</code> and your URL works with no server code.');
  }

  function downloadQrOnly() {
    readForm();
    var url = draft.profile_url || defaultUrl(draft.username);
    var svg = window.QRCode.toSVG(url, { margin: 4, width: 600, title: url });
    Exporter.download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      Exporter.safeName(draft.username, 'qr', 'svg'));
  }

  function openSheet() {
    readForm();
    if (!draft.username) { alert('danger', 'A username is required first.'); return; }
    Store.saveProfile(draft);
    window.open('../demo/print-sheet.html?u=' + encodeURIComponent(draft.username) + '&ecl=' + ecl, '_blank');
  }

  // ---------------------------------------------------------------------------

  function wire() {
    ['b-name', 'b-role', 'b-tagline', 'b-username', 'b-url'].forEach(function (id) {
      $(id).addEventListener('input', function () { readForm(); renderPreview(); });
    });
    $('b-show-photo').addEventListener('change', function () {
      draft.card_settings.show_photo = this.checked;
      renderPreview();
    });
    $('b-photo').addEventListener('change', function () { onPhoto(this.files && this.files[0]); });
    $('b-add-link').addEventListener('click', addLink);
    Array.prototype.forEach.call($('b-ecl').children, function (btn) {
      btn.addEventListener('click', function () { ecl = btn.getAttribute('data-ecl'); renderEcl(); renderPreview(); });
    });

    $('b-pdf').addEventListener('click', function () {
      prepare().then(function (prepared) {
        showWarnings(prepared.warnings);
        var out = Exporter.exportPdf(prepared, draft.username, { sides: ['front', 'back'] });
        showWarnings(out.warnings);
      });
    });
    $('b-png').addEventListener('click', function () {
      if (!Exporter.canRasteriseSvg()) {
        alert('warn', 'Firefox cannot rasterise an SVG blob. Use the PDF — it is vector, so it prints sharper.');
        return;
      }
      prepare().then(function (prepared) {
        showWarnings(prepared.warnings);
        return Promise.all([
          Exporter.exportPng(prepared, 'front', draft.username),
          Exporter.exportPng(prepared, 'back', draft.username)
        ]);
      }).then(function () { alert('ok', 'Both sides downloaded at 300 DPI.'); });
    });
    $('b-svg').addEventListener('click', function () {
      prepare().then(function (prepared) {
        showWarnings(prepared.warnings);
        Exporter.exportSvg(prepared, 'front', draft.username);
        Exporter.exportSvg(prepared, 'back', draft.username);
      });
    });
    $('b-sheet').addEventListener('click', openSheet);
    $('b-qr').addEventListener('click', downloadQrOnly);
    $('b-save').addEventListener('click', saveAndOpenDashboard);
    $('b-json').addEventListener('click', downloadJson);
  }

  function start() {
    // Start from the last profile edited in this browser, if there is one.
    var last = Store.getLastUsername();
    var wanted = new URLSearchParams(location.search).get('u') || last;
    wire();
    renderTemplates();
    renderEcl();
    $('b-url').value = defaultUrl(draft.username);

    if (!wanted) { renderLinks(); renderPreview(); return; }
    Store.loadProfile(wanted).then(function (profile) {
      if (!profile) { renderLinks(); renderPreview(); return; }
      delete profile._source;
      if (!profile.card_settings) profile.card_settings = { template_id: 'template-1', show_photo: true };
      draft = profile;
      $('b-name').value = draft.display_name || '';
      $('b-role').value = draft.designation || '';
      $('b-tagline').value = draft.tagline || '';
      $('b-username').value = draft.username || '';
      $('b-url').value = draft.profile_url || defaultUrl(draft.username);
      $('b-show-photo').checked = draft.card_settings.show_photo !== false;
      renderTemplates();
      renderLinks();
      renderPreview();
    }).catch(function () { renderLinks(); renderPreview(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
