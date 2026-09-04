/*!
 * dashboard.js — the owner dashboard (§8.2).
 *
 * Everything here is client-side: the profile lives in localStorage and in the
 * JSON file you can download and commit to profile-data/. There is no account,
 * no upload, no tracking.
 *
 * Sections:
 *   1. Profile editor          4. Share controls (temporary links)
 *   2. Link manager            5. Follower approvals
 *   3. Card design + preview   6. Profile JSON export
 */
(function () {
  'use strict';

  var Access = window.AccessRules;
  var Store = window.Store;
  var TPL = window.CardTemplates;
  var Card = window.Card;
  var Exporter = window.Exporter;

  var state = {
    profile: null,       // the profile being edited (draft)
    saved: null,         // what is persisted, for dirty checking
    registry: null,      // { tokens, followers, _remoteTokens, _remoteFollowers }
    ecl: 'Q',
    dirty: false
  };

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

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

  function alert(kind, message, ttl) {
    var box = $('alerts');
    var note = el('div', { class: 'notice notice-' + kind, role: 'status' }, [
      el('div', { html: message })
    ]);
    box.appendChild(note);
    if (ttl !== 0) setTimeout(function () { note.remove(); }, ttl || 7000);
    return note;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function timeLeft(iso) {
    if (!iso) return 'never expires';
    var ms = Date.parse(iso) - Date.now();
    if (isNaN(ms)) return 'no expiry';
    if (ms <= 0) return 'expired';
    var mins = Math.round(ms / 60000);
    if (mins < 60) return mins + ' min left';
    var hours = Math.round(mins / 60);
    if (hours < 48) return hours + ' h left';
    return Math.round(hours / 24) + ' days left';
  }

  // ---------------------------------------------------------------------------
  // Loading and saving
  // ---------------------------------------------------------------------------

  /**
   * The permanent URL for a profile: derived, never typed.
   *
   * Store.profileUrlFor() builds <site root>/c/<username>/ from the URL this script
   * was served from, so the same code produces the right link on a fork, on a
   * custom domain, and in a subdirectory — and an explicit absolute profile_url in
   * the JSON still wins, which is how someone points a card at their own domain.
   */
  function defaultProfileUrl(username, profile) {
    return Store.profileUrlFor(username || (state.profile && state.profile.username), profile);
  }

  function blankProfile() {
    return {
      username: '',
      display_name: '',
      designation: '',
      tagline: '',
      photo_url: '',
      profile_url: '',
      created_at: new Date().toISOString(),
      links: [
        { id: 'lnk_1', label: '', url: '', visibility: 'public', order: 1 }
      ],
      card_settings: { template_id: 'template-1', primary_color: '#1a1a2e', show_photo: true }
    };
  }

  function load(username) {
    var target = username || new URLSearchParams(location.search).get('u') ||
      Store.getLastUsername() || 'rahul123';

    return Promise.all([Store.loadProfile(target), Store.loadRegistry(target)])
      .then(function (results) {
        var profile = results[0];
        state.registry = results[1] || { tokens: [], followers: [] };
        if (!profile) {
          profile = blankProfile();
          profile.username = target === 'rahul123' ? '' : target;
          alert('warn', 'No saved profile for <strong>' + escapeHtml(target) +
            '</strong> — starting a fresh one. Nothing is lost; your other profiles are still there.');
        }
        // profile_url stays empty unless the JSON set an override: the URL is derived.
        if (!profile.card_settings) profile.card_settings = { template_id: 'template-1', show_photo: true };
        state.profile = profile;
        state.saved = JSON.stringify(strip(profile));
        fillForm();
        renderAll();
      })
      .catch(function (err) {
        alert('danger', 'Could not load data: ' + escapeHtml(err.message) +
          '.<br>Serve this folder over http (see <a href="../SETUP.md">SETUP.md</a>) — ' +
          'opening the file directly blocks the JSON fetch.', 0);
      });
  }

  /** Fields that are internal bookkeeping, not part of the profile schema. */
  function strip(profile) {
    var copy = JSON.parse(JSON.stringify(profile));
    delete copy._source;
    return copy;
  }

  function markDirty() {
    state.dirty = JSON.stringify(strip(state.profile)) !== state.saved;
    renderSubtitle();
  }

  function readForm() {
    var p = state.profile;
    p.username = $('f-username').value.trim();
    p.display_name = $('f-name').value.trim();
    p.designation = $('f-role').value.trim();
    p.tagline = $('f-tagline').value.trim();
    p.profile_url = ($('f-profile-url-override').value || '').trim();
    p.card_settings.show_photo = $('f-show-photo').checked;
    return p;
  }

  function save() {
    readForm();
    var p = state.profile;
    if (!p.username) { alert('danger', 'Pick a username first — it is your permanent URL.', 0); return; }
    // No override needed — defaultProfileUrl() derives it at render time.

    var result = Store.saveProfile(p);
    if (!result.ok) {
      alert('danger', 'Could not save:<ul>' + result.errors.map(function (e) {
        return '<li>' + escapeHtml(e) + '</li>';
      }).join('') + '</ul>', 0);
      return;
    }
    state.profile = result.profile;
    state.saved = JSON.stringify(strip(result.profile));
    state.dirty = false;

    // Re-read the registry so freshly saved data and repo demo data merge again.
    return Store.loadRegistry(result.profile.username).then(function (reg) {
      state.registry = reg;
      fillForm();
      renderAll();
      var msg = 'Saved to this browser.';
      if (result.warnings && result.warnings.length) {
        msg += '<ul>' + result.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('') + '</ul>';
      }
      if (result.persisted === false) {
        msg += ' <strong>localStorage was unavailable</strong>, so this is kept in memory only — ' +
          'download the JSON to keep it.';
      }
      alert(result.warnings && result.warnings.length ? 'warn' : 'ok', msg);
      return Store.loadProfile(result.profile.username).then(function (fresh) {
        // The public page reads the repo file unless a local one exists; make
        // sure the local copy is what we just saved.
        if (fresh && fresh.username === result.profile.username) return;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Form <-> state
  // ---------------------------------------------------------------------------

  function fillForm() {
    var p = state.profile;
    $('f-username').value = p.username || '';
    $('f-name').value = p.display_name || '';
    $('f-role').value = p.designation || '';
    $('f-tagline').value = p.tagline || '';
    var derived = defaultProfileUrl(p.username, p);
    $('f-profile-url').value = derived;
    $('btn-open-url').href = derived;
    // Show an override only if one was actually set, so the field stays empty by default.
    $('f-profile-url-override').value =
      (p.profile_url && /^[a-z][a-z0-9+.-]*:\/\//i.test(p.profile_url)) ? p.profile_url : '';
    $('f-show-photo').checked = p.card_settings.show_photo !== false;
    $('username-prefix').textContent = '/c/';

    var preview = $('photo-preview');
    if (p.photo_url) { preview.src = p.photo_url; preview.hidden = false; }
    else { preview.removeAttribute('src'); preview.hidden = true; }
    $('f-photo-url').value = /^https?:/i.test(p.photo_url || '') ? p.photo_url : '';

    renderTemplatePicker();
    renderEclPicker();
    renderLinkRows();
    renderTokenLinkOptions();
  }

  function renderSubtitle() {
    var p = state.profile || {};
    var name = p.display_name || p.username || 'a new profile';
    var where = p._source === 'local' ? 'saved in this browser' : (p._source === 'repo' ? 'from profile-data/' : 'not saved yet');
    $('dash-subtitle').innerHTML = escapeHtml(name) + ' · <span class="muted">' + where + '</span>' +
      (state.dirty ? ' <span class="unsaved">unsaved changes</span>' : '');
  }

  function renderTemplatePicker() {
    var box = $('template-picker');
    clear(box);
    TPL.TEMPLATES.forEach(function (t) {
      var bg = t.front.background;
      var swatchStyle = bg.type === 'gradient'
        ? 'background:linear-gradient(135deg,' + bg.from + ',' + bg.to + ')'
        : 'background:' + bg.color;
      var current = (state.profile.card_settings.template_id || 'template-1') === t.id;
      box.appendChild(el('button', {
        type: 'button',
        class: 'template-option',
        'aria-pressed': current ? 'true' : 'false',
        onclick: function () {
          state.profile.card_settings.template_id = t.id;
          markDirty(); renderTemplatePicker(); renderPreview();
        }
      }, [
        el('span', { class: 'swatch', style: swatchStyle + ';--dot:' + t.front.accent }),
        el('span', { class: 'name', text: t.name }),
        el('span', { class: 'desc', text: t.description })
      ]));
    });
    $('preview-template').textContent = TPL.get(state.profile.card_settings.template_id).name;
  }

  function renderEclPicker() {
    Array.prototype.forEach.call($('ecl-picker').children, function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-ecl') === state.ecl ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------------------
  // Link manager
  // ---------------------------------------------------------------------------

  function renderLinkRows() {
    var box = $('link-rows');
    clear(box);
    var links = Access.sortedLinks(state.profile);
    var limit = Access.LIMITS.maxPublicLinks;
    var publicCount = links.filter(function (l) { return !Access.isPrivate(l); }).length;

    links.forEach(function (link, index) {
      var row = el('div', { class: 'row link-row' }, [
        el('div', { class: 'link-main' }, [
          el('input', {
            type: 'text', value: link.label, placeholder: 'Label (Instagram)',
            'aria-label': 'Link ' + (index + 1) + ' label',
            oninput: function (e) { link.label = e.target.value; markDirty(); }
          }),
          el('input', {
            type: 'url', value: link.url, placeholder: 'https://…',
            'aria-label': 'Link ' + (index + 1) + ' URL',
            oninput: function (e) { link.url = e.target.value; markDirty(); }
          })
        ]),
        el('div', { class: 'link-main' }, [
          el('div', { class: 'segmented vis-toggle', role: 'group', 'aria-label': 'Visibility' }, [
            el('button', {
              type: 'button', text: 'Public',
              'aria-pressed': !Access.isPrivate(link) ? 'true' : 'false',
              onclick: function () { link.visibility = 'public'; markDirty(); renderLinkRows(); renderPreview(); }
            }),
            el('button', {
              type: 'button', text: 'Followers only',
              'aria-pressed': Access.isPrivate(link) ? 'true' : 'false',
              onclick: function () { link.visibility = 'followers_only'; markDirty(); renderLinkRows(); renderPreview(); }
            })
          ]),
          el('div', { class: 'row-tools' }, [
            el('button', {
              type: 'button', class: 'icon-btn', text: '↑', title: 'Move up',
              'aria-label': 'Move link up', disabled: index === 0,
              onclick: function () { moveLink(index, -1); }
            }),
            el('button', {
              type: 'button', class: 'icon-btn', text: '↓', title: 'Move down',
              'aria-label': 'Move link down', disabled: index === links.length - 1,
              onclick: function () { moveLink(index, 1); }
            }),
            el('button', {
              type: 'button', class: 'icon-btn danger', text: '✕', title: 'Delete link',
              'aria-label': 'Delete link',
              onclick: function () {
                var i = state.profile.links.indexOf(link);
                if (i >= 0) state.profile.links.splice(i, 1);
                renumber(); markDirty(); renderLinkRows(); renderTokenLinkOptions(); renderPreview();
              }
            })
          ])
        ])
      ]);
      box.appendChild(row);
    });

    $('link-count').innerHTML =
      '<span class="count-pill' + (publicCount > limit ? ' over' : '') + '">' + publicCount + ' public</span> · ' +
      '<span class="count-pill">' + (links.length - publicCount) + ' followers-only</span>';
    $('link-limit-help').textContent = publicCount > limit
      ? 'The hosted free tier allows ' + limit + ' public links. Self-hosting has no limit — this is just a reminder.'
      : 'Free tier allows ' + limit + ' public links; followers-only links are unlimited.';
  }

  function moveLink(index, delta) {
    var sorted = Access.sortedLinks(state.profile);
    var target = index + delta;
    if (target < 0 || target >= sorted.length) return;
    var a = sorted[index], b = sorted[target];
    var tmp = a.order; a.order = b.order; b.order = tmp;
    if (a.order === b.order) { a.order = index + 1; b.order = target + 1; }
    markDirty(); renderLinkRows(); renderPreview();
  }

  function renumber() {
    Access.sortedLinks(state.profile).forEach(function (link, i) { link.order = i + 1; });
  }

  function addLink() {
    var links = state.profile.links;
    var maxOrder = links.reduce(function (m, l) { return Math.max(m, l.order || 0); }, 0);
    var id = 'lnk_' + Date.now().toString(36);
    while (links.some(function (l) { return l.id === id; })) id = 'lnk_' + Math.random().toString(36).slice(2, 7);
    links.push({ id: id, label: '', url: '', visibility: 'public', order: maxOrder + 1 });
    markDirty(); renderLinkRows(); renderTokenLinkOptions(); renderPreview();
    var inputs = $('link-rows').querySelectorAll('input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  // ---------------------------------------------------------------------------
  // Preview + export
  // ---------------------------------------------------------------------------

  var renderPreview = debounce(function () {
    readForm();
    var profile = strip(state.profile);
    if (!profile.username) profile.username = 'yourname';
    if (!profile.display_name) profile.display_name = 'Your Name';

    var url = profile.profile_url || defaultProfileUrl(profile.username);
    var opts = { profileUrl: url, ecl: state.ecl };
    var card;
    try {
      card = Card.buildCard(profile, opts);
    } catch (err) {
      alert('danger', 'Card preview failed: ' + escapeHtml(err.message), 0);
      return;
    }
    $('preview-front').src = Card.toDataURL(card, 'front', { pxPerMm: 6 });
    $('preview-back').src = Card.toDataURL(card, 'back', { pxPerMm: 6 });
    state.card = card;
    renderVisitorLinks(profile, url);
  }, 180);

  function currentCard() {
    readForm();
    var profile = strip(state.profile);
    if (!profile.username) { alert('warn', 'Add a username first — it is part of the URL in the QR.'); return null; }
    var url = profile.profile_url || defaultProfileUrl(profile.username);
    return Exporter.prepareCard(profile, { profileUrl: url, ecl: state.ecl });
  }

  function showWarnings(warnings) {
    var box = $('export-warnings');
    clear(box);
    (warnings || []).forEach(function (w) {
      box.appendChild(el('div', { class: 'notice notice-warn small', html: escapeHtml(w) }));
    });
  }

  function downloadPdf(sheet) {
    var promise = currentCard();
    if (!promise) return;
    promise.then(function (prepared) {
      var out = Exporter.exportPdf(prepared, state.profile.username, {
        sides: sheet ? 'sheet' : ['front', 'back'],
        bleed: !!sheet
      });
      showWarnings(out.warnings);
      if (out.warnings.length) alert('warn', 'Exported with warnings:<ul>' + out.warnings.map(function (w) {
        return '<li>' + escapeHtml(w) + '</li>';
      }).join('') + '</ul>');
    }).catch(function (e) { alert('danger', 'PDF export failed: ' + escapeHtml(e.message), 0); });
  }

  function downloadPng() {
    if (!Exporter.canRasteriseSvg()) {
      alert('warn', 'This browser cannot turn SVG into PNG (a long-standing Firefox limitation). ' +
        'Use the PDF — it is vector, so it prints sharper anyway.', 0);
      return;
    }
    var promise = currentCard();
    if (!promise) return;
    promise.then(function (prepared) {
      showWarnings(prepared.warnings);
      return Promise.all([
        Exporter.exportPng(prepared, 'front', state.profile.username),
        Exporter.exportPng(prepared, 'back', state.profile.username)
      ]);
    }).then(function () {
      alert('ok', 'Downloaded both sides at 300 DPI (1051 × 591 px).');
    }).catch(function (e) { alert('danger', 'PNG export failed: ' + escapeHtml(e.message), 0); });
  }

  function downloadSvg() {
    var promise = currentCard();
    if (!promise) return;
    promise.then(function (prepared) {
      showWarnings(prepared.warnings);
      Exporter.exportSvg(prepared, 'front', state.profile.username);
      Exporter.exportSvg(prepared, 'back', state.profile.username);
      alert('ok', 'Downloaded both sides as SVG.');
    }).catch(function (e) { alert('danger', 'SVG export failed: ' + escapeHtml(e.message), 0); });
  }

  function downloadQrOnly() {
    readForm();
    var url = state.profile.profile_url || defaultProfileUrl(state.profile.username);
    var svg = window.QRCode.toSVG(url, { margin: 4, width: 600, colorDark: '#111111', title: url });
    Exporter.download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      Exporter.safeName(state.profile.username || 'card', 'qr', 'svg'));
    alert('ok', 'Downloaded the QR on its own — handy for an email signature or a poster.');
  }

  function openPrintSheet() {
    if (!state.profile.username) { alert('warn', 'Save a username first.'); return; }
    save().then(function () {
      window.open('../print/?u=' + encodeURIComponent(state.profile.username), '_blank');
    });
  }

  // ---------------------------------------------------------------------------
  // Visitor simulation
  // ---------------------------------------------------------------------------

  function renderVisitorLinks(profile, url) {
    var box = $('visitor-links');
    clear(box);
    var registry = state.registry || { tokens: [], followers: [] };
    // Scenarios are built on the canonical /c/<username>/ URL, the one that gets printed.
    var profilePage = Store.rootRelative('c/' + encodeURIComponent(profile.username) + '/');

    var liveToken = (registry.tokens || []).filter(function (t) {
      return !t.expires_at || Date.parse(t.expires_at) > Date.now();
    })[0];

    var scenarios = [
      { key: 'public', label: 'Stranger', params: {} },
      { key: 'temp', label: 'Temporary link', params: liveToken ? { t: liveToken.token_value } : null },
      { key: 'follower', label: 'Approved follower', params: { viewer: firstApprovedFollower(registry) } }
    ];

    scenarios.forEach(function (scenario) {
      var params = scenario.params;
      var enabled = params && Object.keys(params).every(function (k) { return params[k]; });
      var access = Access.resolveAccess(profile, {
        token: enabled ? params.t : null,
        viewerId: enabled ? params.viewer : null
      }, registry);

      var qs = new URLSearchParams({ u: profile.username });
      if (enabled) Object.keys(params).forEach(function (k) { if (params[k]) qs.set(k, params[k]); });

      box.appendChild(el('div', { class: 'row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'title', text: scenario.label }),
          el('div', { class: 'sub', text: enabled
            ? access.visibleLinks.length + ' links · ' + access.visibleLinks.map(function (l) { return l.label || l.url; }).join(', ')
            : (scenario.key === 'temp' ? 'No active temporary link yet' : 'No approved follower yet') })
        ]),
        el('a', {
          class: 'btn btn-ghost btn-sm', href: profilePage + '?' + qs.toString(),
          target: '_blank', rel: 'noopener', text: 'Open',
          'aria-disabled': enabled ? null : 'true'
        })
      ]));
    });

    fillQrToolLink(profile);
  }

  /**
   * Point the QR generator at this card's URL. It accepts ?url= so you can go
   * from "my card" to "an A4 sheet of my codes" in one click.
   */
  function fillQrToolLink(profile) {
    var link = $('btn-qr-tool');
    if (!link || !profile) return;
    var url = profile.profile_url || defaultProfileUrl(profile.username);
    link.setAttribute('href',
      Store.pageRelative('../qr-generator/') + '?url=' + encodeURIComponent(url));
  }

  function firstApprovedFollower(registry) {
    var found = (registry.followers || []).filter(function (f) { return f.status === 'approved'; })[0];
    return found ? found.follower_id : null;
  }

  // ---------------------------------------------------------------------------
  // Temporary links
  // ---------------------------------------------------------------------------

  function renderTokenLinkOptions() {
    var select = $('f-token-link');
    clear(select);
    var links = Access.sortedLinks(state.profile);
    var privateLinks = links.filter(Access.isPrivate);
    var options = privateLinks.length ? privateLinks : links;
    options.forEach(function (link) {
      select.appendChild(el('option', {
        value: link.id,
        text: (link.label || link.url || link.id) + (Access.isPrivate(link) ? ' · followers only' : ' · public')
      }));
    });
    if (!privateLinks.length) {
      select.appendChild(el('option', { value: '', text: '— mark a link "followers only" first —' }));
      select.value = '';
    }
  }

  function makeToken() {
    var linkId = $('f-token-link').value;
    if (!linkId) { alert('warn', 'Choose which link the temporary URL should unlock.'); return; }
    if (!state.profile.username) { alert('warn', 'Save the profile first — a token belongs to a username.'); return; }

    var duration = parseInt($('f-token-duration').value, 10);
    var maxUses = parseInt($('f-token-uses').value, 10);
    var remoteValues = {};
    (state.registry._remoteTokens || []).forEach(function (t) { remoteValues[t.token_value] = true; });
    var active = ownTokens().filter(function (t) {
      return !t.expires_at || Date.parse(t.expires_at) > Date.now();
    });
    if (active.length >= Access.LIMITS.maxActiveTokens) {
      alert('warn', 'The free tier keeps ' + Access.LIMITS.maxActiveTokens +
        ' temporary link active at a time. Revoke the existing one first (self-hosters can ignore this).');
    }

    var token = Access.createToken({
      profileUsername: state.profile.username,
      linkId: linkId,
      durationSeconds: duration,
      maxUses: maxUses
    });
    state.registry.tokens = (state.registry.tokens || []).concat([token]);
    Store.saveLocalRegistry(state.profile.username, state.registry);

    var link = state.profile.links.filter(function (l) { return l.id === linkId; })[0];
    var url = withParam(profileUrlFor(state.profile), 't', token.token_value);
    var out = $('token-output');
    clear(out);
    out.appendChild(el('div', { class: 'token-out' }, [
      el('div', { class: 'small muted', text: 'Unlocks “' + ((link && link.label) || linkId) + '” · ' + timeLeft(token.expires_at) }),
      el('div', { class: 'token-line', text: url }),
      el('div', { class: 'btn-row mt1' }, [
        el('button', { type: 'button', class: 'btn btn-sm', text: 'Copy link', onclick: function () { copy(url); } }),
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', text: 'Open as visitor',
          onclick: function () { window.open(url, '_blank', 'noopener'); }
        })
      ])
    ]));
    renderTokenList();
    renderVisitorLinks(strip(state.profile), profileUrlFor(state.profile));
  }

  function revokeToken(tokenValue) {
    state.registry.tokens = (state.registry.tokens || []).filter(function (t) {
      return t.token_value !== tokenValue;
    });
    Store.saveLocalRegistry(state.profile.username, state.registry);
    renderTokenList();
    renderVisitorLinks(strip(state.profile), profileUrlFor(state.profile));
    alert('ok', 'Revoked. The URL now shows public links only.');
  }

  /** Tokens minted in this browser (the ones you can actually revoke). */
  function ownTokens() {
    var remote = {};
    (state.registry._remoteTokens || []).forEach(function (t) { remote[t.token_value] = true; });
    return (state.registry.tokens || []).filter(function (t) { return !remote[t.token_value]; });
  }

  function renderTokenList() {
    var box = $('token-list');
    clear(box);
    var own = ownTokens();
    var mine = el('div', { id: 'own-tokens', class: 'rows' });
    box.appendChild(mine);
    if (!own.length) {
      mine.appendChild(el('p', { class: 'small muted', text: 'No temporary links yet.' }));
    }
    own.forEach(function (token) {
      var link = (state.profile.links || []).filter(function (l) { return l.id === token.target_link_id; })[0];
      var expired = token.expires_at && Date.parse(token.expires_at) <= Date.now();
      var used = token.max_uses > 0 && (token.current_uses || 0) >= token.max_uses;
      var url = withParam(profileUrlFor(state.profile), 't', token.token_value);
      mine.appendChild(el('div', { class: 'row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'title' }, [
            document.createTextNode((link && link.label) || token.target_link_id),
            ' ',
            el('span', {
              class: 'badge ' + (expired || used ? 'badge-pending' : 'badge-private'),
              text: expired ? 'expired' : (used ? 'used up' : 'active')
            })
          ]),
          el('div', { class: 'sub', text: token.token_value + ' · ' + timeLeft(token.expires_at) +
            (token.max_uses ? ' · ' + (token.current_uses || 0) + '/' + token.max_uses + ' uses' : ' · unlimited uses') })
        ]),
        el('div', { class: 'actions' }, [
          el('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy',
            onclick: function () { copy(url); }
          }),
          el('button', {
            type: 'button', class: 'btn btn-danger btn-sm', text: 'Revoke',
            onclick: function () { revokeToken(token.token_value); }
          })
        ])
      ]));
    });

    var remote = state.registry._remoteTokens || [];
    if (remote.length) {
      box.appendChild(el('div', { class: 'demo-tokens mt2' }, [
        el('h3', { class: 'sub-head', text: 'Tokens committed in profile-data/tokens.json' }),
        el('p', { class: 'tiny muted', html:
          'Shipped with the repo so the docs and the demo links always work. They are read-only at ' +
          'runtime — edit the JSON file to change them. In V2 these rows live in your database and ' +
          'revoking one really deletes it.' })
      ]));
      remote.forEach(function (token) {
        var link = (state.profile.links || []).filter(function (l) { return l.id === token.target_link_id; })[0];
        var expired = token.expires_at && Date.parse(token.expires_at) <= Date.now();
        box.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'grow' }, [
            el('div', { class: 'title' }, [
              document.createTextNode((link && link.label) || token.target_link_id),
              ' ',
              el('span', { class: 'badge badge-pending', text: expired ? 'expired demo' : 'demo' })
            ]),
            el('div', { class: 'sub', text: token.token_value + ' · ' + timeLeft(token.expires_at) })
          ]),
          el('div', { class: 'actions' }, [
            el('button', {
              type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy link',
              onclick: function () {
                copy(withParam(profileUrlFor(state.profile), 't', token.token_value));
              }
            })
          ])
        ]));
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Followers
  // ---------------------------------------------------------------------------

  function setFollowerStatus(followerId, status) {
    var follower = (state.registry.followers || []).filter(function (f) {
      return f.follower_id === followerId;
    })[0];
    if (!follower) return;
    follower.status = status;
    follower.approved_at = status === 'approved' ? new Date().toISOString() : null;
    Store.saveLocalRegistry(state.profile.username, state.registry);
    renderFollowerList();
    renderVisitorLinks(strip(state.profile), profileUrlFor(state.profile));
    alert('ok', status === 'approved'
      ? 'Approved ' + escapeHtml(follower.follower_name || follower.follower_email || followerId) +
        '. They now see every followers-only link.'
      : 'Access ' + status + '. They are back to public links only.');
  }

  function renderFollowerList() {
    var box = $('follower-list');
    clear(box);
    var followers = state.registry.followers || [];
    if (!followers.length) {
      box.appendChild(el('p', { class: 'small muted', text: 'Nobody has requested access yet.' }));
      return;
    }
    followers.forEach(function (f) {
      var badgeClass = f.status === 'approved' ? 'badge-public'
        : (f.status === 'pending' ? 'badge-pending' : 'badge-private');
      box.appendChild(el('div', { class: 'row' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'title' }, [
            document.createTextNode(f.follower_name || f.follower_email || f.follower_id),
            ' ',
            el('span', { class: 'badge ' + badgeClass, text: f.status })
          ]),
          el('div', { class: 'sub', text: (f.follower_email || 'no email') + ' · requested ' +
            (f.requested_at ? new Date(f.requested_at).toLocaleDateString() : '—') })
        ]),
        el('div', { class: 'actions' }, [
          f.status === 'approved'
            ? el('button', {
              type: 'button', class: 'btn btn-danger btn-sm', text: 'Remove',
              onclick: function () { setFollowerStatus(f.follower_id, 'removed'); }
            })
            : el('button', {
              type: 'button', class: 'btn btn-sm', text: 'Approve',
              onclick: function () { setFollowerStatus(f.follower_id, 'approved'); }
            }),
          f.status === 'pending'
            ? el('button', {
              type: 'button', class: 'btn btn-ghost btn-sm', text: 'Reject',
              onclick: function () { setFollowerStatus(f.follower_id, 'rejected'); }
            })
            : null
        ])
      ]));
    });
  }

  function simulateRequest() {
    if (!state.profile.username) { alert('warn', 'Save a username first.'); return; }
    var names = ['Kavya Rao', 'Dev Patel', 'Ananya Iyer', 'Rohan Das', 'Fatima Sheikh'];
    var name = names[Math.floor(Math.random() * names.length)];
    var request = Access.createFollowerRequest({
      profileUsername: state.profile.username,
      followerName: name,
      followerEmail: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com'
    });
    state.registry.followers = (state.registry.followers || []).concat([request]);
    Store.saveLocalRegistry(state.profile.username, state.registry);
    renderFollowerList();
    alert('info', 'In V2 this is what a signed-up visitor triggers from your profile page. ' +
      'Here it is simulated so you can see the approval flow.');
  }

  // ---------------------------------------------------------------------------
  // Photo handling
  // ---------------------------------------------------------------------------

  function onPhotoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('danger', 'That file is not an image.'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      Exporter.toEmbeddedDataUrl(reader.result, 600, 0.92).then(function (dataUrl) {
        state.profile.photo_url = dataUrl;
        markDirty(); fillForm(); renderPreview();
        alert('ok', 'Photo resized to 600 px and embedded (' + Math.round(dataUrl.length / 1024) + ' KB). ' +
          'Save to keep it.');
      }).catch(function (err) {
        alert('danger', 'Could not read that image: ' + escapeHtml(err.message));
      });
    };
    reader.onerror = function () { alert('danger', 'Could not read that file.'); };
    reader.readAsDataURL(file);
  }

  // ---------------------------------------------------------------------------
  // JSON export
  // ---------------------------------------------------------------------------

  function profileJson() {
    readForm();
    var p = strip(state.profile);
    renumber();
    p.links = Access.sortedLinks(p);
    delete p._source;
    return JSON.stringify(p, null, 2);
  }

  function downloadJson() {
    var username = state.profile.username || 'profile';
    Exporter.download(new Blob([profileJson() + '\n'], { type: 'application/json' }),
      username + '.json');
    alert('ok', 'Saved as <code>' + escapeHtml(username) + '.json</code>. Drop it into ' +
      '<code>profile-data/</code>, run <code>npm run build</code>, and your URL works with no server code at all.');
  }

  function copy(text) {
    Exporter.copyText(text).then(function (ok) {
      alert(ok ? 'ok' : 'warn', ok ? 'Copied to the clipboard.' : 'Copy blocked by the browser — select the text instead.', 2500);
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  /** Join a query parameter onto a profile URL that may already have one. */
  function withParam(url, key, value) {
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    if (url.charAt(url.length - 1) === '?' || url.charAt(url.length - 1) === '&') sep = '';
    return url + sep + key + '=' + encodeURIComponent(value);
  }

  function profileUrlFor(profile) {
    return profile.profile_url || defaultProfileUrl(profile.username);
  }

  function wire() {
    ['f-username', 'f-name', 'f-role', 'f-tagline', 'f-profile-url'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        // Read the form first: markDirty() compares state against what is saved,
        // so comparing before reading would always report "no changes".
        readForm(); markDirty(); renderPreview();
      });
    });
    $('f-show-photo').addEventListener('change', function () {
      state.profile.card_settings.show_photo = this.checked;
      markDirty(); renderPreview();
    });
    $('f-photo-file').addEventListener('change', function () { onPhotoFile(this.files && this.files[0]); });
    $('f-photo-url').addEventListener('change', function () {
      state.profile.photo_url = this.value.trim();
      markDirty(); fillForm(); renderPreview();
    });
    $('btn-photo-clear').addEventListener('click', function () {
      state.profile.photo_url = '';
      $('f-photo-file').value = '';
      markDirty(); fillForm(); renderPreview();
    });

    $('btn-add-link').addEventListener('click', addLink);
    $('btn-save').addEventListener('click', function () { save(); });
    $('btn-load-demo').addEventListener('click', function () { load('rahul123'); });
    $('btn-reset').addEventListener('click', function () {
      if (!window.confirm('Delete everything this browser saved (profiles, tokens, approvals) and reload the demo?')) return;
      var n = Store.clearLocal();
      alert('ok', 'Cleared ' + n + ' local item(s). Reloading…');
      setTimeout(function () { location.href = location.pathname; }, 700);
    });

    $('btn-copy-url').addEventListener('click', function (ev) {
      var button = ev.currentTarget;
      var label = button.textContent;
      copy($('f-profile-url').value);
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = label; }, 1400);
    });

    Array.prototype.forEach.call($('ecl-picker').children, function (btn) {
      btn.addEventListener('click', function () {
        state.ecl = btn.getAttribute('data-ecl');
        renderEclPicker(); renderPreview();
      });
    });

    $('btn-make-token').addEventListener('click', makeToken);
    $('btn-simulate-request').addEventListener('click', simulateRequest);

    $('btn-download-pdf').addEventListener('click', function () { downloadPdf(false); });
    $('btn-download-png').addEventListener('click', downloadPng);
    $('btn-download-svg').addEventListener('click', downloadSvg);
    $('btn-download-qr').addEventListener('click', downloadQrOnly);
    $('btn-print-sheet').addEventListener('click', openPrintSheet);

    $('btn-download-json').addEventListener('click', downloadJson);
    $('btn-copy-json').addEventListener('click', function () { copy(profileJson()); });
    $('btn-toggle-json').addEventListener('click', function () {
      var view = $('json-view');
      view.hidden = !view.hidden;
      this.textContent = view.hidden ? 'Show' : 'Hide';
      if (!view.hidden) view.textContent = profileJson();
    });

    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    // Ctrl/Cmd+S saves.
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    });
  }

  function renderAll() {
    renderSubtitle();
    renderLinkRows();
    renderTokenList();
    renderFollowerList();
    renderTokenLinkOptions();
    renderPreview();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /**
   * Token durations are generated from AccessRules.LIMITS rather than written
   * into the HTML, so a self-hoster who edits the limits edits the picker too.
   */
  function fillDurations() {
    var select = $('f-token-duration');
    var options = Access.durationOptions();
    options.forEach(function (d) {
      var opt = document.createElement('option');
      opt.value = String(d.seconds);
      opt.textContent = d.label;
      if (d.key === '24h') opt.selected = true;   // a day is the useful default
      select.appendChild(opt);
    });
    if (!select.options.length) {
      var opt = document.createElement('option');
      opt.value = '86400'; opt.textContent = '24 hours';
      select.appendChild(opt);
    }
  }

  function start() {
    fillDurations();
    wire();
    load();
  }
})();
