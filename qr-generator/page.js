/**
 * qr-generator/page.js — the UI for the standalone QR tool.
 *
 * Two modes over the same encoder:
 *   1. Single QR  — one code, live preview, PNG/SVG/PDF download.
 *   2. Print sheet — a pasted list of URLs laid out on real paper sizes, with
 *      labels, exported as a multi-page vector PDF.
 *
 * Everything happens locally. Nothing is uploaded and nothing is stored except
 * your own list of URLs, kept in localStorage so a refresh does not lose work.
 */
(function () {
  'use strict';

  var Gen = window.QrGenerator;
  var QR = window.QRCode;
  var Pdf = window.SimplePdf;
  var Exporter = window.Exporter;

  var LS_LIST = 'qrlinkcard.v1.qrgen.list';
  var LS_OPTIONS = 'qrlinkcard.v1.qrgen.options';
  var PX_PER_MM = 300 / 25.4;      // 300 DPI

  var EXAMPLES = {
    profile: 'https://clickalex.github.io/GrinCard/demo/profile.html?u=rahul123',
    wifi: 'WIFI:T:WPA;S:Studio Guest;P:welcome2026;H:false;;',
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Rahul Kumar\nTITLE:Freelance Illustrator\nTEL;TYPE=CELL:+91 98765 43210\nEMAIL:rahul@example.com\nURL:https://rahul.example\nEND:VCARD',
    upi: 'upi://pay?pa=rahul@okbank&pn=Rahul%20Kumar&am=250&cu=INR&tn=Illustration%20commission'
  };

  var DEMO_LIST = [
    '# One entry per line: "Label | URL", "Label, URL" or just the URL.',
    'Instagram | https://instagram.com/rahul.illustrates',
    'Portfolio | https://rahul.example',
    'Pricing list | https://rahul.example/pricing',
    'WhatsApp | https://wa.me/919876543210',
    'Email | mailto:rahul@example.com',
    'Phone | tel:+919876543210',
    'Studio Wi-Fi | WIFI:T:WPA;S:Studio Guest;P:welcome2026;;',
    'UPI | upi://pay?pa=rahul@okbank&pn=Rahul%20Kumar&cu=INR',
    'Map | https://maps.google.com/?q=Hauz+Khas+Delhi',
    'Feedback form | https://forms.example/rahul-feedback'
  ].join('\n');

  function $(id) { return document.getElementById(id); }
  function num(id, fallback) {
    var n = parseFloat($(id).value);
    return isFinite(n) ? n : fallback;
  }
  function str(id, fallback) {
    var v = $(id).value;
    return (v == null || v === '') ? fallback : v;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k === 'onchange') node.addEventListener('change', v);
      else if (k === 'oninput') node.addEventListener('input', v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  /**
   * Show a message in one of the two alert areas. Each area keeps its own timer:
   * a shared one meant that a later message silently cancelled the dismissal of
   * an earlier one (and vice versa).
   */
  function alert_(area, message, kind) {
    var box = $(area);
    clear(box);
    box.appendChild(el('div', { class: 'notice notice-' + (kind || 'ok'), text: message }));
    clearTimeout(box._alertTimer);
    box._alertTimer = setTimeout(function () { clear(box); }, 9000);
  }

  function readStore(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------------------
  // Shared option state
  // ---------------------------------------------------------------------------

  var state = {
    mode: 'single',
    list: readStore(LS_LIST, DEMO_LIST),
    options: Object.assign({
      ecl: 'M', sizeMm: 25, quietZoneModules: 4, color: '#111111', background: '#ffffff',
      paper: 'a4', marginMm: 10, gapMm: 4, showLabels: true, labelMm: 5, showIndex: false
    }, readStore(LS_OPTIONS, {}))
  };

  function singleOptions() {
    return {
      ecl: str('q-ecl', 'M'),
      sizeMm: num('q-size', 25),
      quietZoneModules: num('q-quiet', 4),
      color: str('q-color', '#111111'),
      background: str('q-bg', '#ffffff')
    };
  }

  function sheetOptions() {
    return {
      ecl: str('s-ecl', 'M'),
      sizeMm: num('s-size', 25),
      marginMm: num('s-margin', 10),
      gapMm: num('s-gap', 4),
      quietZoneModules: 4,
      color: str('s-color', '#111111'),
      background: '#ffffff',
      paper: str('s-paper', 'a4'),
      showLabels: $('s-labels').checked,
      labelMm: 5,
      showIndex: $('s-index').checked
    };
  }

  function persistOptions() {
    writeStore(LS_OPTIONS, Object.assign({}, sheetOptions(), singleOptions()));
  }

  // ---------------------------------------------------------------------------
  // Single QR
  // ---------------------------------------------------------------------------

  function renderSingle() {
    var text = $('q-text').value.trim();
    var box = $('q-preview');
    clear(box);
    if (!text) {
      box.appendChild(el('p', { class: 'muted', text: 'Type something above to see the code.' }));
      return;
    }

    var o = singleOptions();
    var svg;
    var qrInfo;
    try {
      svg = Gen.singleSvg(text, o);
      qrInfo = QR.create(text, { ecl: o.ecl, margin: 0 });
    } catch (err) {
      box.appendChild(el('div', { class: 'notice notice-danger', text: 'Could not encode that: ' + err.message }));
      return;
    }

    var holder = el('div', { class: 'qr-holder', html: svg });
    var built = Gen.runs(text, o);
    var boxMm = built.symbolMm + built.quietMm * 2;
    var meta = el('div', { class: 'qr-meta' }, [
      el('dl', {}, [
        el('dt', { text: 'Version' }),
        el('dd', { text: qrInfo.version + ' (' + qrInfo.size + ' × ' + qrInfo.size + ' modules)' }),
        el('dt', { text: 'Error correction' }),
        el('dd', { text: o.ecl + ' — recovers ' + { L: '7%', M: '15%', Q: '25%', H: '30%' }[o.ecl] }),
        el('dt', { text: 'Symbol size' }),
        el('dd', { text: built.symbolMm + ' mm' }),
        el('dt', { text: 'With quiet zone' }),
        el('dd', { text: Math.round(boxMm * 10) / 10 + ' mm' }),
        el('dt', { text: 'Module' }),
        el('dd', { text: Math.round(built.moduleMm * 1000) / 1000 + ' mm (' +
          Math.round(built.moduleMm * PX_PER_MM) + ' px at 300 DPI)' }),
        el('dt', { text: 'Payload' }),
        el('dd', { text: text.length + ' bytes' })
      ])
    ]);
    box.appendChild(holder);
    box.appendChild(meta);

    if (built.symbolMm < 20) {
      alert_('q-alerts', 'Below 20 mm this code is hard to scan from a normal distance. ' +
        '25 mm is the size we print on cards.', 'warn');
    }
  }

  function currentSingleSvg() {
    return Gen.singleSvg($('q-text').value.trim(), singleOptions());
  }

  function downloadSinglePng() {
    var text = $('q-text').value.trim();
    if (!text) { alert_('q-alerts', 'Nothing to encode yet.', 'warn'); return; }
    var o = singleOptions();
    var svg = Gen.singleSvg(text, o);
    var built = Gen.runs(text, o);
    var boxMm = built.symbolMm + built.quietMm * 2;
    var px = Math.max(1, Math.round(boxMm * PX_PER_MM));

    Exporter.rasteriseSvg(svg, px, px, o.background === 'none' ? '#ffffff' : o.background)
      .then(function (blob) {
        if (!blob) {
          alert_('q-alerts', 'This browser cannot rasterise SVG. Download the SVG instead — ' +
            'it prints sharper anyway.', 'warn');
          return;
        }
        Exporter.download(blob, 'qr_' + safeSlug(text) + '_300dpi.png');
        alert_('q-alerts', 'PNG saved at ' + px + ' × ' + px + ' px (300 DPI).');
      })
      .catch(function (err) {
        alert_('q-alerts', 'PNG export failed: ' + err.message, 'danger');
      });
  }

  function downloadSinglePdf() {
    var text = $('q-text').value.trim();
    if (!text) { alert_('q-alerts', 'Nothing to encode yet.', 'warn'); return; }
    var o = singleOptions();
    var built = Gen.runs(text, o);
    var boxMm = built.symbolMm + built.quietMm * 2;
    var doc = new Pdf({ title: 'QR — ' + text.slice(0, 60), author: 'open-qr-link-card' });
    var page = doc.addPage(boxMm, boxMm);
    if (o.background && o.background !== 'none') page.rect(0, 0, boxMm, boxMm, o.background);
    built.runs.forEach(function (run) {
      page.rect(built.quietMm + run.x, built.quietMm + run.y, run.w, built.moduleMm, o.color);
    });
    Exporter.download(new Blob([doc.build()], { type: 'application/pdf' }),
      'qr_' + safeSlug(text) + '.pdf');
    alert_('q-alerts', 'Vector PDF saved: one page, exactly ' + boxMm + ' mm square.');
  }

  function safeSlug(text) {
    var m = /^https?:\/\/([^/?#]+)/.exec(text);
    var base = m ? m[1].replace(/^www\./, '') : text;
    return base.replace(/[^a-z0-9._-]/gi, '-').toLowerCase().slice(0, 40) || 'code';
  }

  // ---------------------------------------------------------------------------
  // Sheet
  // ---------------------------------------------------------------------------

  function renderSheet() {
    var entries = Gen.parseList($('q-list').value);
    var preview = $('s-preview');
    var stats = $('s-stats');
    clear(preview); clear(stats);

    if (!entries.length) {
      preview.appendChild(el('p', { class: 'page-tag', text: 'Add some URLs on the left.' }));
      return;
    }

    var o = sheetOptions();
    var lo = Gen.layout(entries, o);

    stats.appendChild(el('span', { html: '<b>' + entries.length + '</b> codes' }));
    stats.appendChild(el('span', { html: '<b>' + lo.pageCount + '</b> page' + (lo.pageCount === 1 ? '' : 's') }));
    stats.appendChild(el('span', { html: lo.paper.label.replace(/\s*\(.*\)/, '') + ' <b>' +
      lo.columns + ' × ' + lo.rows + '</b> grid (' + lo.perPage + ' per page)' }));
    stats.appendChild(el('span', { html: 'QR <b>' + Math.round(lo.symbolMm * 10) / 10 + ' mm</b> + ' +
      Math.round(lo.quietMm * 10) / 10 + ' mm quiet zone each side' }));
    if (lo.symbolMm > o.sizeMm + 0.05) {
      stats.appendChild(el('span', { html: 'longest code sets the module size, so the others print larger' }));
    }
    stats.appendChild(el('span', { html: 'cell <b>' + Math.round(lo.cell.width) + ' × ' +
      Math.round(lo.cell.height) + ' mm</b>' }));

    for (var p = 0; p < lo.pageCount; p++) {
      var svg = Gen.sheetSvg(entries, p, o);
      preview.appendChild(el('div', { class: 'page-tag', text: 'Page ' + (p + 1) + ' of ' + lo.pageCount }));
      preview.appendChild(el('div', { class: 'sheet-page', html: svg }));
    }

    if (o.sizeMm < 20) {
      alert_('s-alerts', 'Codes under 20 mm are hard to scan from arm\'s length. ' +
        'For table tents and stickers, 25 mm is the safe minimum.', 'warn');
    }
  }

  function downloadSheetPdf() {
    var entries = Gen.parseList($('q-list').value);
    if (!entries.length) { alert_('s-alerts', 'Nothing to lay out yet.', 'warn'); return; }
    var o = sheetOptions();
    var bytes = Gen.sheetPdf(entries, o);
    Exporter.download(new Blob([bytes], { type: 'application/pdf' }),
      'qr-sheet_' + entries.length + '-codes_' + o.paper + '.pdf');
    var lo = bytes.layout;
    alert_('s-alerts', 'PDF saved: ' + lo.pageCount + ' × ' + lo.paper.label + ', ' +
      entries.length + ' codes at ' + o.sizeMm + ' mm.' +
      (bytes.warnings && bytes.warnings.length ? ' (' + bytes.warnings.length + ' character substitutions)' : ''));
  }

  function downloadSheetSvg() {
    var entries = Gen.parseList($('q-list').value);
    if (!entries.length) { alert_('s-alerts', 'Nothing to lay out yet.', 'warn'); return; }
    var o = sheetOptions();
    var lo = Gen.layout(entries, o);
    if (lo.pageCount > 1) {
      alert_('s-alerts', 'SVG holds one page; you have ' + lo.pageCount + '. ' +
        'The PDF download includes every page.', 'warn');
    }
    var svg = Gen.sheetSvg(entries, 0, o);
    Exporter.download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'qr-sheet_page1.svg');
  }

  /** Load the demo profiles so the sheet tool and the card tool share data. */
  function loadDemoProfiles() {
    var users = ['rahul123', 'meera9'];
    var lines = [];
    var pending = users.map(function (u) {
      return fetch('../profile-data/' + u + '.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (p) {
          if (!p) { lines.push(u + ' | (profile not found)'); return; }
          var base = location.origin + location.pathname.replace(/[^/]*$/, '') + '../demo/profile.html';
          lines.push(p.display_name + ' — card | ' + base + '?u=' + u);
          (p.links || []).forEach(function (l) {
            if (l.visibility === 'public') lines.push(l.label + ' | ' + l.url);
          });
        });
    });
    Promise.all(pending).then(function () {
      $('q-list').value = '# Generated from profile-data/ — public links only.\n' + lines.join('\n');
      writeStore(LS_LIST, $('q-list').value);
      renderSheet();
      alert_('s-alerts', 'Loaded ' + lines.length + ' codes from the demo profiles.');
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function setMode(mode) {
    state.mode = mode;
    $('mode-single').classList.toggle('hidden', mode !== 'single');
    $('mode-sheet').classList.toggle('hidden', mode !== 'sheet');
    $('tab-single').setAttribute('aria-selected', String(mode === 'single'));
    $('tab-sheet').setAttribute('aria-selected', String(mode === 'sheet'));
    if (mode === 'sheet') renderSheet(); else renderSingle();
  }

  function init() {
    // Paper sizes come from the layout engine so the list can never drift.
    var paper = $('s-paper');
    Object.keys(Gen.PAPER).forEach(function (key) {
      paper.appendChild(el('option', { value: key, text: Gen.PAPER[key].label }));
    });

    // Seed the form from saved state.
    $('q-list').value = state.list;
    var o = state.options;
    if (o.ecl) { $('q-ecl').value = o.ecl; $('s-ecl').value = o.ecl; }
    if (o.color) { $('q-color').value = o.color; $('s-color').value = o.color; }
    if (o.background) $('q-bg').value = o.background;
    if (o.sizeMm) { $('q-size').value = o.sizeMm; $('s-size').value = o.sizeMm; }
    if (o.quietZoneModules != null) $('q-quiet').value = o.quietZoneModules;
    if (o.paper) $('s-paper').value = o.paper;
    if (o.marginMm != null) $('s-margin').value = o.marginMm;
    if (o.gapMm != null) $('s-gap').value = o.gapMm;
    if (o.showLabels != null) $('s-labels').checked = o.showLabels;
    if (o.showIndex != null) $('s-index').checked = o.showIndex;

    // A profile URL in the address bar pre-fills the single-QR field, so you can
    // deep-link here from the dashboard.
    var params = new URLSearchParams(location.search);
    if (params.get('url')) $('q-text').value = params.get('url');
    if (params.get('mode') === 'sheet') state.mode = 'sheet';

    ['q-text', 'q-ecl', 'q-size', 'q-quiet', 'q-color', 'q-bg'].forEach(function (id) {
      $(id).addEventListener('input', function () { renderSingle(); persistOptions(); });
      $(id).addEventListener('change', function () { renderSingle(); persistOptions(); });
    });
    $('q-list').addEventListener('input', function () {
      writeStore(LS_LIST, $('q-list').value);
      renderSheet();
    });
    ['s-paper', 's-size', 's-margin', 's-gap', 's-ecl', 's-color', 's-labels', 's-index'].forEach(function (id) {
      $(id).addEventListener('input', function () { renderSheet(); persistOptions(); });
      $(id).addEventListener('change', function () { renderSheet(); persistOptions(); });
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-example]'), function (btn) {
      btn.addEventListener('click', function () {
        $('q-text').value = EXAMPLES[btn.getAttribute('data-example')];
        renderSingle();
      });
    });

    $('q-png').addEventListener('click', downloadSinglePng);
    $('q-svg').addEventListener('click', function () {
      if (!$('q-text').value.trim()) { alert_('q-alerts', 'Nothing to encode yet.', 'warn'); return; }
      Exporter.download(new Blob([currentSingleSvg()], { type: 'image/svg+xml;charset=utf-8' }),
        'qr_' + safeSlug($('q-text').value.trim()) + '.svg');
      alert_('q-alerts', 'SVG saved — infinitely scalable, and the best choice for print.');
    });
    $('q-pdf').addEventListener('click', downloadSinglePdf);
    $('q-copy').addEventListener('click', function () {
      Exporter.copyText(currentSingleSvg()).then(function (ok) {
        alert_('q-alerts', ok ? 'SVG markup copied to the clipboard.' :
          'The clipboard is blocked here; use the SVG download instead.', ok ? 'ok' : 'warn');
      });
    });

    $('s-pdf').addEventListener('click', downloadSheetPdf);
    $('s-svg').addEventListener('click', downloadSheetSvg);
    $('s-print').addEventListener('click', function () { window.print(); });
    $('q-load-demo').addEventListener('click', function () {
      $('q-list').value = DEMO_LIST;
      writeStore(LS_LIST, DEMO_LIST);
      renderSheet();
    });
    $('q-load-profiles').addEventListener('click', loadDemoProfiles);
    $('q-clear').addEventListener('click', function () {
      $('q-list').value = '';
      writeStore(LS_LIST, '');
      renderSheet();
    });

    $('tab-single').addEventListener('click', function () { setMode('single'); });
    $('tab-sheet').addEventListener('click', function () { setMode('sheet'); });

    setMode(state.mode);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
