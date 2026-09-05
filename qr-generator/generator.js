/**
 * qr-generator/generator.js — batch QR generation and print sheets.
 *
 * The card builder produces one card. This tool produces many QR codes at once:
 * paste a list of URLs, pick a size, and get an A4 sheet with labels underneath,
 * ready for the printer. Uses the same encoder as everything else, so a QR from
 * here and a QR from a card are bit-identical for the same input.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../lib/qr.js'), require('../lib/pdfdoc.js'));
  } else {
    root.QrGenerator = factory(root.QRCode, root.SimplePdf);
  }
}(typeof self !== 'undefined' ? self : this, function (QR, SimplePdf) {
  'use strict';

  var MM_PER_PT = 25.4 / 72;      // 1 pt = 0.3528 mm
  var PT_PER_MM = 72 / 25.4;

  var PAPER = {
    a4: { width: 210, height: 297, label: 'A4 (210 × 297 mm)' },
    letter: { width: 215.9, height: 279.4, label: 'US Letter (8.5 × 11 in)' },
    a5: { width: 148, height: 210, label: 'A5 (148 × 210 mm)' },
    a6: { width: 105, height: 148, label: 'A6 (105 × 148 mm)' }
  };

  /**
   * Parse a pasted list into entries.
   * Accepted line formats: "url", "label | url", "label, url", or tab-separated.
   * Blank lines and # comments are ignored.
   */
  function parseList(text) {
    return String(text || '').split(/\r?\n/).map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line && line.charAt(0) !== '#';
    }).map(function (line, index) {
      // Split at the last delimiter that is actually followed by a URL or URI
      // scheme. A naive split on "," would cut query strings like ?q=Delhi,India
      // in half, and people paste those constantly.
      var label = '';
      var url = line;
      var scheme = /^(https?:\/\/|mailto:|tel:|sms:|upi:\/\/|ftp:\/\/|\/\/|WIFI:|BEGIN:)/i;
      for (var i = line.length - 1; i > 0; i--) {
        var ch = line.charAt(i);
        if (ch !== ',' && ch !== '|' && ch !== '\t') continue;
        var right = line.slice(i + 1).trim();
        if (scheme.test(right)) {
          label = line.slice(0, i).trim();
          url = right;
          break;
        }
      }
      return { id: 'qr_' + (index + 1), label: label || guessLabel(url), url: url };
    });
  }

  /** Derive a readable label from a URL when the user did not supply one. */
  function guessLabel(url) {
    var m = /^https?:\/\/([^/]+)(\/.*)?$/i.exec(url || '');
    if (!m) return url || '';
    var host = m[1].replace(/^www\./, '');
    var last = (m[2] || '').split('?')[0].split('/').filter(Boolean).pop();
    return last ? host + '/' + last : host;
  }

  /**
   * Lay entries out on a page.
   * @returns {columns, rows, cell, perPage, sizeMm, quietMm, pages}
   */
  function layout(entries, options) {
    var o = options || {};
    var paper = PAPER[o.paper] || PAPER.a4;
    var margin = num(o.marginMm, 10);
    var gap = num(o.gapMm, 4);
    var size = num(o.sizeMm, 25);          // MINIMUM symbol size, quiet zone excluded
    var labelMm = o.showLabels ? num(o.labelMm, 5) : 0;
    var quiet = num(o.quietZoneModules, 4);
    var ecl = o.ecl || 'M';

    // Every code on a sheet shares one module size, so the grid stays even.
    // That means the batch is laid out for its longest payload: the biggest QR
    // gets exactly `size` mm, and shorter ones come out slightly larger. The
    // quiet zone is then guaranteed for every code, which is the part that
    // actually decides whether a scanner finds it.
    var maxSize = 21;
    entries.forEach(function (entry) {
      var qr = QR.create(entry.url, { ecl: ecl, margin: 0 });
      if (qr.size > maxSize) maxSize = qr.size;
    });
    var moduleMm = size / maxSize;
    var quietMm = quiet * moduleMm;
    var symbolMm = maxSize * moduleMm;      // >= size
    var box = symbolMm + quietMm * 2;

    var cols = Math.max(1, Math.floor((paper.width - 2 * margin + gap) / (box + gap)));
    var rows = Math.max(1, Math.floor((paper.height - 2 * margin + gap) / (box + labelMm + gap)));
    var perPage = cols * rows;

    return {
      paper: paper,
      columns: cols,
      rows: rows,
      perPage: perPage,
      cell: { width: box, height: box + labelMm },
      sizeMm: size,                         // what was asked for (minimum)
      symbolMm: symbolMm,                   // what actually gets printed
      moduleMm: moduleMm,
      boxMm: box,
      labelMm: labelMm,
      quietMm: quietMm,
      marginMm: margin,
      gapMm: gap,
      pageCount: Math.max(1, Math.ceil(entries.length / perPage)),
      quietZoneModules: quiet,
      maxModules: maxSize,
      ecl: ecl
    };
  }

  function num(value, fallback) {
    var n = typeof value === 'string' ? parseFloat(value) : value;
    return isFinite(n) ? n : fallback;
  }

  /**
   * Position one entry on its page. All coordinates in mm, origin top-left.
   */
  function position(entryIndex, lo) {
    var slot = entryIndex % lo.perPage;
    var col = slot % lo.columns;
    var row = Math.floor(slot / lo.columns);
    // Centre the grid horizontally: leftover space is split evenly.
    var gridWidth = lo.columns * lo.cell.width + (lo.columns - 1) * lo.gapMm;
    var gridHeight = lo.rows * lo.cell.height + (lo.rows - 1) * lo.gapMm;
    var offsetX = (lo.paper.width - gridWidth) / 2;
    var offsetY = (lo.paper.height - gridHeight) / 2;
    return {
      page: Math.floor(entryIndex / lo.perPage),
      x: offsetX + col * (lo.cell.width + lo.gapMm),
      y: offsetY + row * (lo.cell.height + lo.gapMm)
    };
  }

  /**
   * The dark modules of a QR as run-length rows.
   * @param {string} text  what to encode
   * @param {object} o     { ecl, quietZoneModules, sizeMm }
   * @returns {runs: [{x, y, w}], moduleMm, symbolMm} with x/y in mm, 0,0 = symbol top-left
   */
  function runs(text, o) {
    var quiet = num(o.quietZoneModules, 4);
    var qr = QR.create(text, { ecl: o.ecl || 'M', margin: 0 });
    // Either an explicit module size (sheets: one size for the whole batch) or a
    // target symbol size (single codes).
    var moduleMm = num(o.moduleMm, num(o.sizeMm, 25) / qr.size);
    var size = qr.size * moduleMm;
    var out = [];
    for (var y = 0; y < qr.size; y++) {
      var start = -1;
      for (var x = 0; x <= qr.size; x++) {
        var on = x < qr.size && qr.modules[y * qr.size + x] === 1;
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          out.push({ x: start * moduleMm, y: y * moduleMm, w: (x - start) * moduleMm });
          start = -1;
        }
      }
    }
    return {
      runs: out,
      moduleMm: moduleMm,
      symbolMm: size,
      size: qr.size,
      version: qr.version,
      quietModules: quiet,
      quietMm: quiet * moduleMm
    };
  }

  /**
   * Build one SVG containing a full sheet (a page's worth of QR codes).
   */
  function sheetSvg(entries, page, options) {
    var o = options || {};
    var lo = layout(entries, o);
    var dark = o.color || '#111111';
    var light = o.background || '#ffffff';
    var font = "font-family=\"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif\"";

    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + mm(lo.paper.width) +
      '" height="' + mm(lo.paper.height) + '" viewBox="0 0 ' + lo.paper.width + ' ' +
      lo.paper.height + '" role="img" aria-label="QR sheet, page ' + (page + 1) + ' of ' +
      lo.pageCount + '">');
    if (light && light !== 'none') {
      parts.push('<rect x="0" y="0" width="' + lo.paper.width + '" height="' + lo.paper.height +
        '" fill="' + light + '"/>');
    }

    entries.forEach(function (entry, index) {
      var pos = position(index, lo);
      if (pos.page !== page) return;
      var built = runs(entry.url, { ecl: lo.ecl, moduleMm: lo.moduleMm, quietZoneModules: lo.quietZoneModules });
      var inset = lo.quietMm;                            // exact: the cell includes it
      var qx = pos.x + inset;
      var qy = pos.y + inset;

      parts.push('<g data-index="' + index + '" data-url="' + escapeXml(entry.url) + '">');
      parts.push('<path d="' + built.runs.map(function (run) {
        return 'M' + r(qx + run.x) + ' ' + r(qy + run.y) + 'h' + r(run.w) +
          'v' + r(built.moduleMm) + 'h-' + r(run.w) + 'z';
      }).join('') + '" fill="' + dark + '"/>');

      if (o.showLabels) {
        var fs = fontSize(lo.cell.width);
        var label = truncate(entry.label || entry.url, charsFor(lo.cell.width, fs));
        parts.push('<text x="' + r(pos.x + lo.cell.width / 2) + '" y="' +
          r(pos.y + lo.cell.width + lo.labelMm * 0.75) + '" ' + font +
          ' font-size="' + r(fs) + '" fill="' + dark +
          '" text-anchor="middle">' + escapeXml(label) + '</text>');
      }
      if (o.showIndex) {
        parts.push('<text x="' + r(pos.x) + '" y="' + r(pos.y - 0.9) + '" ' + font +
          ' font-size="2" fill="#999999">' + (index + 1) + '</text>');
      }
      parts.push('</g>');
    });

    parts.push('</svg>');
    return parts.join('\n');
  }

  function fontSize(cellWidthMm) {
    return Math.min(3.2, Math.max(1.8, cellWidthMm / 12));
  }

  function mm(v) { return Math.round(v * 100) / 100 + 'mm'; }
  function r(v) { return Math.round(v * 100) / 100; }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Build a multi-page PDF sheet. The PDF page box is exactly the paper size in
   * mm, so 1:1 printing needs no scaling.
   */
  function sheetPdf(entries, options) {
    var o = options || {};
    var lo = layout(entries, o);
    var dark = o.color || '#111111';
    var doc = new SimplePdf({
      title: 'QR sheet: ' + entries.length + ' codes on ' + lo.paper.label,
      author: 'open-qr-link-card',
      subject: 'Generated with qr-generator/'
    });

    var pages = [];
    for (var p = 0; p < lo.pageCount; p++) pages.push(doc.addPage(lo.paper.width, lo.paper.height));

    entries.forEach(function (entry, index) {
      var pos = position(index, lo);
      var page = pages[pos.page];
      var built = runs(entry.url, { ecl: lo.ecl, moduleMm: lo.moduleMm, quietZoneModules: lo.quietZoneModules });
      var inset = lo.quietMm;
      var qx = pos.x + inset;
      var qy = pos.y + inset;

      built.runs.forEach(function (run) {
        page.rect(qx + run.x, qy + run.y, run.w, built.moduleMm, dark);
      });

      if (o.showLabels) {
        var fs = fontSize(lo.cell.width);
        var label = truncate(entry.label || entry.url, charsFor(lo.cell.width, fs));
        page.text(label, pos.x + lo.cell.width / 2, pos.y + lo.cell.width + lo.labelMm * 0.75,
          fs * PT_PER_MM, dark, 'middle');
      }
      if (o.showIndex) {
        page.text(String(index + 1), pos.x, pos.y - 0.9, 2 * PT_PER_MM, '#999999', 'start');
      }
    });

    var bytes = doc.build();
    bytes.warnings = doc.getWarnings();
    bytes.layout = lo;
    return bytes;
  }

  /** A single QR as SVG — handy for embedding anywhere. */
  function singleSvg(text, options) {
    var o = options || {};
    var built = runs(text, o);
    var margin = built.quietMm;
    var box = built.symbolMm + margin * 2;
    var d = built.runs.map(function (run) {
      return 'M' + r(margin + run.x) + ' ' + r(margin + run.y) + 'h' + r(run.w) +
        'v' + r(built.moduleMm) + 'h-' + r(run.w) + 'z';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + mm(box) + '" height="' + mm(box) +
      '" viewBox="0 0 ' + r(box) + ' ' + r(box) + '" shape-rendering="crispEdges" role="img" ' +
      'aria-label="QR code">' +
      (o.background && o.background !== 'none'
        ? '<rect width="' + r(box) + '" height="' + r(box) + '" fill="' + o.background + '"/>' : '') +
      '<path d="' + d + '" fill="' + (o.color || '#111111') + '"/></svg>';
  }

  /** Shorten a label to fit a cell; keeps it readable at print size. */
  function truncate(text, maxChars) {
    var s = String(text == null ? '' : text);
    if (maxChars <= 0 || s.length <= maxChars) return s;
    return s.slice(0, Math.max(1, maxChars - 1)) + '\u2026';
  }

  /** Rough characters-per-line for a given cell width and font size (mm). */
  function charsFor(cellWidthMm, fontSizeMm) {
    return Math.max(6, Math.floor(cellWidthMm / (fontSizeMm * 0.5)));
  }

  return {
    PAPER: PAPER,
    MM_PER_PT: MM_PER_PT,
    PT_PER_MM: PT_PER_MM,
    parseList: parseList,
    guessLabel: guessLabel,
    layout: layout,
    position: position,
    sheetSvg: sheetSvg,
    sheetPdf: sheetPdf,
    singleSvg: singleSvg,
    runs: runs,
    truncate: truncate,
    charsFor: charsFor,
    fontSize: fontSize
  };
}));
