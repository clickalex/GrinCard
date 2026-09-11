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

  /**
   * Is this the demo? The examples gallery links here as "Design a card for this
   * person", with ?demo=1 and a fixture username. That makes the page an
   * evaluation view, and an evaluation view must not lead to the dashboard —
   * the dashboard is the owner's console. In demo mode everything marked
   * data-owner-tool in the markup is stripped, and Save writes to this browser
   * (the demo pages read it back) instead of navigating away.
   */
  var DEMO = !!(Store && Store.isDemoRequest && Store.isDemoRequest());

  /**
   * The blank card a new fork starts from.
   *
   * Deliberately the same identity as profile-data/yourname.json, so "open the
   * builder" and "edit the starter profile" describe one person rather than two.
   * The example people live in examples/ and are reachable from the gallery; they
   * are fixtures for the tests, not a template for someone's own card.
   */
  var draft = {
    username: 'yourname',
    display_name: 'Your Name',
    designation: 'What you do',
    tagline: 'One line people remember you by',
    photo_url: '',
    profile_url: '',          // derived at render time; see defaultUrl()
    created_at: new Date().toISOString(),
    links: [
      { id: 'lnk_1', label: 'Website', url: 'https://example.com', visibility: 'public', order: 1 },
      { id: 'lnk_2', label: 'Email me', url: 'mailto:you@example.com', visibility: 'public', order: 2 },
      { id: 'lnk_3', label: 'Book a call', url: 'https://cal.com/yourname', visibility: 'public', order: 3 },
      { id: 'lnk_4', label: 'Pricing (private)', url: 'https://example.com/pricing', visibility: 'followers_only', order: 4 }
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

  /**
   * The URL that goes into the QR: derived, never typed.
   *
   * Store.profileUrlFor() reads where these scripts are being served from, so a
   * fork's cards encode the fork's own /c/<username>/ link with no configuration,
   * and an absolute profile_url in the JSON still wins for custom domains.
   */
  function defaultUrl(username, profile) {
    return Store.profileUrlFor(username || draft.username, profile);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderTemplates() {
    var box = $('b-templates');
    clear(box);
    TPL.all().forEach(function (t) {
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
        el('span', { class: 'name', text: t.name + (t.community ? ' · contributed' : '') }),
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
    // b-url is read-only and derived: do NOT read it back into the draft, or an
    // absolute URL would be baked into the exported JSON and go stale if the site
    // moves. An override only arrives from a profile_url already in the JSON.
    if (draft.profile_url === undefined) draft.profile_url = '';
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
    // The demo saves into this browser — the demo pages read it back — but must
    // not open the dashboard. It is the owner's console, not part of the
    // evaluation, so the demo visitor stays right here.
    if (DEMO) {
      alert('ok', 'Saved to this browser. The demo pages now show this card; nothing was uploaded.');
      return;
    }
    location.href = '../dashboard/?u=' + encodeURIComponent(result.profile.username);
  }

  function downloadJson() {
    readForm();
    var p = JSON.parse(JSON.stringify(draft));
    Access.sortedLinks(p).forEach(function (l, i) { l.order = i + 1; });
    p.links = Access.sortedLinks(p);
    // Leave profile_url out of the exported file so the URL stays derived. Keeping
    // it would hardcode today's domain into someone's repository.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(p.profile_url || '')) delete p.profile_url;
    Exporter.download(
      new Blob([JSON.stringify(p, null, 2) + '\n'], { type: 'application/json' }),
      (p.username || 'profile') + '.json'
    );
    alert('ok', 'Downloaded <code>' + escapeHtml(p.username || 'profile') +
      '.json</code>. Put it in <code>profile-data/</code>, run <code>npm run build</code>, ' +
      'and your URL works with no server code.');
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
    // Carry the demo flag: the sheet this opens must also stay a demo page —
    // reading the fixtures and hiding the dashboard — rather than an owner page.
    window.open('../print/?' + (DEMO ? 'demo=1&' : '') + 'u=' +
      encodeURIComponent(draft.username) + '&ecl=' + ecl, '_blank');
  }

  // ---------------------------------------------------------------------------

  function wire() {
    ['b-name', 'b-role', 'b-tagline', 'b-username'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        readForm();
        // The printed URL follows the username, live, so what you see is what you print.
        $('b-url').value = defaultUrl(draft.username, draft);
        renderPreview();
      });
    });
    $('b-copy-url').addEventListener('click', function (ev) {
      var button = ev.currentTarget;
      var label = button.textContent;
      Exporter.copyText($('b-url').value).then(function (ok) {
        button.textContent = ok ? 'Copied' : 'Select it';
        setTimeout(function () { button.textContent = label; }, 1400);
      });
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

  /**
   * Turn the page into its demo form: no dashboard anywhere. The markup marks
   * the owner-only pieces with data-owner-tool; here they are removed (not
   * hidden) so nothing can re-show them, and the copy that promises the
   * dashboard is replaced with what the demo actually does.
   */
  function applyDemoMode() {
    if (!DEMO) return;
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-owner-tool]'),
      function (node) { node.remove(); });
    var save = $('b-save');
    if (save) save.textContent = 'Save to this browser';
    var copy = $('b-next-copy');
    if (copy) {
      copy.textContent = 'Nothing is uploaded — your changes stay in this browser, ' +
        'and the demo pages show them straight away. Download the profile JSON ' +
        'to take the card with you.';
    }
  }

  function start() {
    // Start from the last profile edited in this browser, if there is one.
    var last = Store.getLastUsername();
    var wanted = new URLSearchParams(location.search).get('u') || last;
    applyDemoMode();
    wire();
    // Contributed templates live in their own folder and are listed in a manifest,
    // because a static site cannot enumerate a directory. Load them first so the
    // picker shows everything this deployment has.
    CardTemplates.loadCommunity(Store.rootRelative('card-templates/community/'))
      .then(function () { renderTemplates(); renderPreview(); });
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
      $('b-url').value = defaultUrl(draft.username, draft);
      $('b-show-photo').checked = draft.card_settings.show_photo !== false;
      renderTemplates();
      renderLinks();
      renderPreview();
    }).catch(function () { renderLinks(); renderPreview(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
