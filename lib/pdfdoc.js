/**
 * lib/pdfdoc.js — a very small, general-purpose PDF 1.4 writer (global `SimplePdf`).
 *
 * lib/pdf.js builds business cards (two exact 89 × 51 mm pages). This is the
 * generic layer underneath it: arbitrary page sizes, filled rectangles,
 * centred/left/right text and a colour model. qr-generator uses it to lay out
 * A4 sheets of QR codes, and it is exposed so you can script your own print
 * products (stickers, tent cards, badge inserts) without a PDF library.
 *
 * Output is vector PDF — no rasterisation, no fonts to install, no dependencies.
 * Text uses the standard 14 Helvetica family, which every PDF reader has. Only
 * Latin-1 characters are representable; anything else is replaced and reported
 * through `getWarnings()`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SimplePdf = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PT_PER_MM = 72 / 25.4;      // millimetres -> PDF points
  var MM_PER_PT = 25.4 / 72;      // PDF points -> millimetres

  /** Characters that cannot be encoded in WinAnsiEncoding, and what we use instead. */
  var FALLBACKS = {
    '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'",
    '\u201c': '"', '\u201d': '"', '\u2026': '...', '\u2022': '-',
    '\u20ac': 'EUR', '\u20b9': 'Rs', '\u20b1': 'P', '\u0192': 'f',
    '\u0152': 'OE', '\u0153': 'oe', '\u0160': 'S', '\u0161': 's',
    '\u0178': 'Y', '\u017d': 'Z', '\u017e': 'z', '\u02c6': '^',
    '\u2020': '+', '\u2021': '++', '\u2030': '/1000', '\u2039': '<',
    '\u203a': '>', '\u2122': '(TM)'
  };

  function r2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Convert #rgb / #rrggbb to 0..1 PDF colour components. */
  function toRgb(hex) {
    var h = String(hex || '#000000').replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '000000';
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  }

  function colourOps(rgb) {
    return r2(rgb[0]) + ' ' + r2(rgb[1]) + ' ' + r2(rgb[2]) + ' rg';
  }

  /** Escape a string for a PDF literal, substituting anything not in WinAnsi. */
  function pdfString(text, warnings) {
    var out = '';
    var chars = String(text == null ? '' : text);
    for (var i = 0; i < chars.length; i++) {
      var c = chars.charAt(i);
      var code = chars.charCodeAt(i);
      if (c === '(' || c === ')' || c === '\\') { out += '\\' + c; continue; }
      if (code < 32 || code === 127) { out += ' '; continue; }
      if (code <= 255) { out += c; continue; }
      var sub = FALLBACKS[c];
      if (warnings) {
        warnings.push('Character U+' + code.toString(16).toUpperCase().padStart(4, '0') +
          ' (' + c + ') is not in the standard PDF fonts; printed as "' +
          (sub === undefined ? '?' : sub) + '".');
      }
      out += sub === undefined ? '?' : sub;
    }
    return out;
  }

  /** Approximate text width in points for Helvetica/Helvetica-Bold. */
  function textWidth(text, fontSize, bold) {
    var widths = bold ? BOLD_WIDTHS : REGULAR_WIDTHS;
    var chars = String(text == null ? '' : text);
    var total = 0;
    for (var i = 0; i < chars.length; i++) {
      var w = widths[chars.charCodeAt(i)];
      total += w === undefined ? widths[0] : w;
    }
    return total * fontSize / 1000;
  }

  // Widths for the standard 14 fonts, per 1000 units of em. Covering ASCII plus
  // Latin-1 is enough for names, roles and labels; anything else falls back to
  // the average width, which only nudges centred text slightly off.
  var REGULAR_WIDTHS;
  var BOLD_WIDTHS;

  function buildWidths() {
    // A flat 556 (the average Helvetica width) would misplace text-anchor
    // centring on short labels, so use the real ASCII widths.
    var w = {};
    var ascii = {
      32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
      40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
      48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
      56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
      64: 1015, 65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778,
      72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778,
      80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944,
      88: 667, 89: 667, 90: 611, 91: 278, 92: 278, 93: 278, 94: 469, 95: 556,
      96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278,
      103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833,
      110: 556, 111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278,
      117: 556, 118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334,
      124: 260, 125: 334, 126: 584
    };
    Object.keys(ascii).forEach(function (k) { w[k] = ascii[k]; });
    for (var c = 160; c <= 255; c++) {
      if (w[c] === undefined) w[c] = 556;
    }
    w[0] = 556;
    return w;
  }

  REGULAR_WIDTHS = buildWidths();
  BOLD_WIDTHS = buildWidths();   // Helvetica-Bold is slightly wider; close enough for labels

  // ---------------------------------------------------------------------------

  function Page(doc, widthMm, heightMm) {
    this.doc = doc;
    this.widthMm = widthMm;
    this.heightMm = heightMm;
    this.ops = [];
  }

  /** Convert mm from the top-left origin to PDF's bottom-left origin. */
  Page.prototype.pt = function (xMm, yMm) {
    return {
      x: xMm * PT_PER_MM,
      y: (this.heightMm - yMm) * PT_PER_MM
    };
  };

  /**
   * Filled rectangle in mm from the top-left corner.
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {string} [fill] #rrggbb
   */
  Page.prototype.rect = function (x, y, w, h, fill) {
    var p = this.pt(x, y + h);   // PDF y is the BOTTOM edge of the rectangle
    this.ops.push(colourOps(toRgb(fill)) + ' ' +
      r2(p.x) + ' ' + r2(p.y) + ' ' + r2(w * PT_PER_MM) + ' ' + r2(h * PT_PER_MM) + ' re f');
    // (x, y-bottom-left, width, height) — all in points
    return this;
  };

  /** Filled circle in mm (centre x/y, radius). */
  Page.prototype.circle = function (cx, cy, radius, fill) {
    var k = 0.5522847498;   // cubic Bézier circle constant
    var p = this.pt(cx - radius, cy + radius);
    var r = radius * PT_PER_MM;
    var c = r * k;
    this.ops.push(colourOps(toRgb(fill)));
    this.ops.push(
      r2(p.x) + ' ' + r2(p.y - r) + ' m ' +
      r2(p.x) + ' ' + r2(p.y - r + c) + ' ' + r2(p.x + r - c) + ' ' + r2(p.y) + ' ' + r2(p.x + r) + ' ' + r2(p.y) + ' c ' +
      r2(p.x + r + c) + ' ' + r2(p.y) + ' ' + r2(p.x + 2 * r) + ' ' + r2(p.y - r + c) + ' ' + r2(p.x + 2 * r) + ' ' + r2(p.y - r) + ' c ' +
      r2(p.x + 2 * r) + ' ' + r2(p.y - r - c) + ' ' + r2(p.x + r + c) + ' ' + r2(p.y - 2 * r) + ' ' + r2(p.x + r) + ' ' + r2(p.y - 2 * r) + ' c ' +
      r2(p.x + r - c) + ' ' + r2(p.y - 2 * r) + ' ' + r2(p.x) + ' ' + r2(p.y - r - c) + ' ' + r2(p.x) + ' ' + r2(p.y - r) + ' c f');
    return this;
  };

  /** Stroked line in mm. */
  Page.prototype.line = function (x1, y1, x2, y2, stroke, widthMm) {
    var a = this.pt(x1, y1);
    var b = this.pt(x2, y2);
    this.ops.push(colourOps(toRgb(stroke)) + ' ' + r2((widthMm || 0.35) * PT_PER_MM) + ' w 1 J ' +
      r2(a.x) + ' ' + r2(a.y) + ' m ' + r2(b.x) + ' ' + r2(b.y) + ' l S');
    return this;
  };

  /**
   * Text in mm from the top-left corner; `y` is the baseline.
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {number} fontSizePt  size in points (1 mm = 2.835 pt)
   * @param {string} [fill]
   * @param {'start'|'middle'|'end'} [align]
   * @param {boolean} [bold]
   */
  Page.prototype.text = function (text, x, y, fontSizePt, fill, align, bold) {
    var str = String(text == null ? '' : text);
    if (!str) return this;
    var size = fontSizePt || 10;
    var p = this.pt(x, y);
    var dx = 0;
    if (align === 'middle') dx = -textWidth(str, size, bold) / 2;
    else if (align === 'end') dx = -textWidth(str, size, bold);
    this.ops.push('BT ' + colourOps(toRgb(fill)) + ' /' + (bold ? 'F2' : 'F1') + ' ' + r2(size) + ' Tf ' +
      r2(p.x + dx) + ' ' + r2(p.y) + ' Td (' + pdfString(str, this.doc._warnings) + ') Tj ET');
    return this;
  };

  /** Width a string would occupy, in mm — useful for fitting text to a box. */
  Page.prototype.textWidthMm = function (text, fontSizePt, bold) {
    return textWidth(text, fontSizePt, bold) * MM_PER_PT;
  };

  // ---------------------------------------------------------------------------

  function SimplePdf(meta) {
    meta = meta || {};
    this.title = meta.title || 'open-qr-link-card';
    this.author = meta.author || 'open-qr-link-card';
    this.subject = meta.subject || '';
    this.pages = [];
    this._warnings = [];
  }

  SimplePdf.prototype.addPage = function (widthMm, heightMm) {
    var page = new Page(this, widthMm || 210, heightMm || 297);
    this.pages.push(page);
    return page;
  };

  SimplePdf.prototype.getWarnings = function () {
    return this._warnings.slice();
  };

  /** Serialise the document to a Uint8Array of PDF bytes. */
  SimplePdf.prototype.build = function () {
    if (!this.pages.length) this.addPage(210, 297);

    var objects = [];      // index 0 is unused (PDF objects are 1-based)
    objects.push(null);

    var catalogId = CATALOG_ID;
    var pagesId = PAGES_ID;
    var infoId = INFO_ID;
    var fontRegularId = FONT_REGULAR_ID;
    var fontBoldId = FONT_BOLD_ID;
    objects[catalogId] = null;   // placeholders, filled in below
    objects[pagesId] = null;
    objects[infoId] = null;
    objects[fontRegularId] = null;
    objects[fontBoldId] = null;

    var pageIds = [];
    var contentIds = [];

    this.pages.forEach(function (page) {
      var pageId = objects.length;
      objects.push(null);
      var contentId = objects.length;
      objects.push(null);
      pageIds.push(pageId);
      contentIds.push(contentId);

      var stream = page.ops.join('\n');
      objects[contentId] = '<< /Length ' + latin1Length(stream) + ' >>\nstream\n' + stream + '\nendstream';
      objects[pageId] = '<< /Type /Page /Parent ' + pagesId + ' 0 R ' +
        '/MediaBox [0 0 ' + r2(page.widthMm * PT_PER_MM) + ' ' + r2(page.heightMm * PT_PER_MM) + '] ' +
        '/Resources << /Font << /F1 ' + fontRegularId + ' 0 R /F2 ' + fontBoldId + ' 0 R >> >> ' +
        '/Contents ' + contentId + ' 0 R >>';
    });

    objects[catalogId] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
    objects[pagesId] = '<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' +
      pageIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] >>';
    objects[fontRegularId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[fontBoldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objects[infoId] = '<< /Title (' + pdfString(this.title, this._warnings) + ') ' +
      '/Author (' + pdfString(this.author, this._warnings) + ') ' +
      '/Subject (' + pdfString(this.subject, this._warnings) + ') ' +
      '/Producer (open-qr-link-card lib/pdfdoc.js) >>';

    return assemble(objects);
  };

  /** Byte length once serialised as WinAnsi/latin1 — one byte per character. */
  function latin1Length(str) {
    return str.length;
  }

  var CATALOG_ID = 1;
  var PAGES_ID = 2;
  var INFO_ID = 3;
  var FONT_REGULAR_ID = 4;
  var FONT_BOLD_ID = 5;

  /** Concatenate objects with an xref table and trailer. */
  function assemble(objects) {
    var chunks = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
    var total = latin1Length(chunks[0]);
    var offsets = [0];

    for (var i = 1; i < objects.length; i++) {
      offsets[i] = total;                        // byte offset of this "i 0 obj"
      var chunk = i + ' 0 obj\n' + objects[i] + '\nendobj\n';
      chunks.push(chunk);
      total += latin1Length(chunk);
    }

    var xrefStart = total;
    var xref = ['xref\n0 ' + objects.length + '\n', '0000000000 65535 f \n'];
    for (var j = 1; j < objects.length; j++) {
      xref.push(pad(offsets[j], 10) + ' 00000 n \n');
    }
    xref.push('trailer\n<< /Size ' + objects.length + ' /Root ' + CATALOG_ID + ' 0 R /Info ' +
      INFO_ID + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');
    chunks.push(xref.join(''));

    return encode(chunks.join(''));
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  /**
   * Serialise to bytes. PDF string literals here are WinAnsiEncoding, so this is
   * a straight latin1 copy — the same approach lib/pdf.js uses for cards.
   */
  function encode(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }

  SimplePdf.MM_PER_PT = MM_PER_PT;
  SimplePdf.PT_PER_MM = PT_PER_MM;
  SimplePdf.textWidth = textWidth;
  SimplePdf.pdfString = pdfString;
  SimplePdf.toRgb = toRgb;

  return SimplePdf;
}));
