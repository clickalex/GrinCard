/*!
 * pdf.js — a minimal, dependency-free PDF writer for print-ready cards (§7.1).
 *
 * Why hand-rolled? html2canvas/jsPDF give you a raster of your own DOM at
 * screen resolution. A printed card needs vector geometry at exact physical
 * size, so this writes a real PDF: the QR is vector paths, the type is real
 * text, and the page is exactly 89 x 51 mm. Print shops get what they asked for
 * (Appendix C) and the file is a few KB.
 *
 * It consumes the display list produced by lib/card.js, so the PDF and the SVG
 * preview are guaranteed to be the same drawing — one layout, two outputs.
 *
 * Supported: rects (incl. rounded), lines, circles, axial gradients, text using
 * the standard PDF fonts (WinAnsiEncoding), embedded JPEG/PNG photos with
 * circular or rounded clipping, and optional 3 mm bleed.
 */
(function (root, factory) {
  var Card = (typeof module === 'object' && module.exports) ? require('./card.js') : root.Card;
  var api = factory(Card);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PdfCard = api;
})(typeof self !== 'undefined' ? self : this, function (Card) {
  'use strict';

  var PT_PER_MM = 72 / 25.4;
  var KAPPA = 0.5522847498; // circle approximation with cubic beziers

  function r2(n) { return (Math.round(n * 100) / 100).toString(); }
  function r3(n) { return (Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000).toString(); }

  // ---------------------------------------------------------------------------
  // Text encoding — the standard PDF fonts use WinAnsiEncoding (CP1252)
  // ---------------------------------------------------------------------------

  var WINANSI_EXTRA = {
    '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85,
    '\u2020': 0x86, '\u2021': 0x87, '\u02c6': 0x88, '\u2030': 0x89, '\u0160': 0x8a,
    '\u2039': 0x8b, '\u0152': 0x8c, '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92,
    '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95, '\u2013': 0x96, '\u2014': 0x97,
    '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b, '\u0153': 0x9c,
    '\u017e': 0x9e, '\u0178': 0x9f
  };

  // Characters WinAnsi cannot represent, mapped to something a printer can.
  // NB: U+00B7 (middle dot) and U+2022 (bullet) ARE in WinAnsi (0xB7 / 0x95),
  // so they must not appear here — only genuinely unrepresentable ones.
  var FALLBACKS = {
    '\u20b9': 'Rs.',  // Indian rupee sign
    '\u2219': '-',    // bullet operator
    '\u25cf': '*',    // black circle
    '\u2605': '*',    // black star
    '\u2192': '->'    // rightwards arrow
  };

  /**
   * Encode text for a WinAnsi PDF string.
   * Returns { bytes, lost } — `lost` lists characters that had no
   * representation, so the UI can warn the user before they print.
   */
  function encodeText(str) {
    var bytes = [], lost = [];
    var s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], code = s.charCodeAt(i);
      if (FALLBACKS[ch]) {
        var fb = FALLBACKS[ch];
        for (var k = 0; k < fb.length; k++) bytes.push(fb.charCodeAt(k));
        lost.push(ch);
        continue;
      }
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) { bytes.push(code); continue; }
      if (WINANSI_EXTRA[ch]) { bytes.push(WINANSI_EXTRA[ch]); continue; }
      var approx = ch.normalize ? ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : ch;
      if (approx.length === 1 && approx.charCodeAt(0) >= 0x20 && approx.charCodeAt(0) <= 0x7e) {
        bytes.push(approx.charCodeAt(0));
      } else {
        bytes.push(0x3f); // '?'
      }
      lost.push(ch);
    }
    return { bytes: bytes, lost: lost };
  }

  function pdfString(bytes) {
    var out = '(';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i];
      if (b === 0x28) out += '\\(';
      else if (b === 0x29) out += '\\)';
      else if (b === 0x5c) out += '\\\\';
      else if (b === 0x0a) out += '\\n';
      else if (b === 0x0d) out += '\\r';
      else if (b === 0x09) out += '\\t';
      else if (b < 0x20 || b > 0x7e) out += '\\' + ((b >>> 6) & 7) + ((b >>> 3) & 7) + (b & 7);
      else out += String.fromCharCode(b);
    }
    return out + ')';
  }

  function latin1Bytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Colour
  // ---------------------------------------------------------------------------

  function parseColor(value) {
    if (value == null || value === 'none') return null;
    var s = String(value).trim();
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(s);
    if (m) return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255, 1];
    m = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(s);
    if (m) {
      return [parseInt(m[1] + m[1], 16) / 255, parseInt(m[2] + m[2], 16) / 255,
        parseInt(m[3] + m[3], 16) / 255, 1];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(s);
    if (m) {
      return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255,
        m[4] == null ? 1 : parseFloat(m[4])];
    }
    return null;
  }

  function rgbOps(color, stroke) {
    var c = parseColor(color) || [0, 0, 0, 1];
    return r3(c[0]) + ' ' + r3(c[1]) + ' ' + r3(c[2]) + ' ' + (stroke ? 'RG' : 'rg');
  }

  // ---------------------------------------------------------------------------
  // Image decoding
  // ---------------------------------------------------------------------------

  function base64ToBytes(b64) {
    var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function isJpeg(bytes) { return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff; }
  function isPng(bytes) {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  function readU32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

  var syncInflate = null, syncDeflate = null;
  if (typeof require === 'function') {
    try {
      var zlib = require('zlib');
      syncInflate = function (u8) { return new Uint8Array(zlib.inflateSync(u8)); };
      syncDeflate = function (u8) { return new Uint8Array(zlib.deflateSync(u8)); };
    } catch (e) { /* browser: PNGs needing unpacking must be pre-converted */ }
  }

  function paeth(a, b, c) {
    var p = a + b - c;
    var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  }

  /** Reverse PNG per-row filtering to recover raw samples. */
  function unfilter(raw, width, height, bpp) {
    var stride = width * bpp;
    var out = new Uint8Array(stride * height);
    var prev = new Uint8Array(stride);
    var pos = 0;
    for (var y = 0; y < height; y++) {
      var filter = raw[pos++];
      var line = raw.subarray(pos, pos + stride);
      pos += stride;
      var cur = out.subarray(y * stride, (y + 1) * stride);
      for (var x = 0; x < stride; x++) {
        var a = x >= bpp ? cur[x - bpp] : 0;
        var b = prev[x];
        var c = x >= bpp ? prev[x - bpp] : 0;
        var v = line[x];
        switch (filter) {
          case 0: cur[x] = v; break;
          case 1: cur[x] = (v + a) & 0xff; break;
          case 2: cur[x] = (v + b) & 0xff; break;
          case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break;
          case 4: cur[x] = (v + paeth(a, b, c)) & 0xff; break;
          default: throw new Error('PNG: bad filter type ' + filter);
        }
      }
      prev = cur.slice();
    }
    return out;
  }

  /**
   * Parse a PNG into embeddable pieces. 8-bit non-interlaced only: grayscale,
   * RGB, paletted (+tRNS) and the two alpha variants. Anything else throws so
   * the caller can re-encode through a canvas.
   */
  function decodePng(bytes) {
    var pos = 8, ihdr = null, idat = [], plte = null, trns = null;
    while (pos + 12 <= bytes.length) {
      var len = readU32(bytes, pos);
      var type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      var data = bytes.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        ihdr = {
          width: readU32(data, 0), height: readU32(data, 4),
          bitDepth: data[8], colorType: data[9],
          compression: data[10], filter: data[11], interlace: data[12]
        };
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'PLTE') plte = data;
      else if (type === 'tRNS') trns = data;
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    if (!ihdr) throw new Error('PNG: missing IHDR');
    if (ihdr.bitDepth !== 8) throw new Error('PNG: only 8-bit samples supported (got ' + ihdr.bitDepth + ')');
    if (ihdr.interlace !== 0) throw new Error('PNG: interlaced images are not supported');
    if (ihdr.compression !== 0 || ihdr.filter !== 0) throw new Error('PNG: unsupported method');

    var merged = new Uint8Array(idat.reduce(function (n, c) { return n + c.length; }, 0));
    var off = 0;
    idat.forEach(function (c) { merged.set(c, off); off += c.length; });
    if (!merged.length) throw new Error('PNG: no IDAT data');

    var ct = ihdr.colorType;
    var out = { width: ihdr.width, height: ihdr.height, colorType: ct, smaskBytes: null };

    if (ct === 0 || ct === 2) {
      // Already a plain 1- or 3-channel image: embed the deflate stream as-is.
      out.deflate = merged;
      out.components = ct === 0 ? 1 : 3;
      out.colorspace = ct === 0 ? 'DeviceGray' : 'DeviceRGB';
      out.predictor = true;
      return out;
    }
    if (!syncInflate) {
      throw new Error('PNG color type ' + ct + ' needs zlib; use a JPEG or RGB PNG');
    }
    var raw = syncInflate(merged);
    if (ct === 3) {
      if (!plte) throw new Error('PNG: paletted image without PLTE');
      var n = ihdr.width * ihdr.height;
      var un = unfilter(raw, ihdr.width, ihdr.height, 1);
      var rgb = new Uint8Array(n * 3);
      var alpha = trns ? new Uint8Array(n) : null;
      for (var i = 0; i < n; i++) {
        var idx = un[i];
        rgb[i * 3] = plte[idx * 3];
        rgb[i * 3 + 1] = plte[idx * 3 + 1];
        rgb[i * 3 + 2] = plte[idx * 3 + 2];
        if (alpha) alpha[i] = idx < trns.length ? trns[idx] : 255;
      }
      out.deflate = syncDeflate(rgb);
      out.components = 3;
      out.colorspace = 'DeviceRGB';
      out.smaskBytes = alpha;
      return out;
    }
    if (ct === 4 || ct === 6) {
      var chan = ct === 4 ? 1 : 3;
      var un2 = unfilter(raw, ihdr.width, ihdr.height, chan + 1);
      var count = ihdr.width * ihdr.height;
      var color = new Uint8Array(count * chan);
      var alpha2 = new Uint8Array(count);
      for (var p = 0; p < count; p++) {
        for (var c = 0; c < chan; c++) color[p * chan + c] = un2[p * (chan + 1) + c];
        alpha2[p] = un2[p * (chan + 1) + chan];
      }
      out.deflate = syncDeflate(color);
      out.components = chan;
      out.colorspace = chan === 1 ? 'DeviceGray' : 'DeviceRGB';
      out.smaskBytes = alpha2;
      return out;
    }
    throw new Error('PNG: unknown color type ' + ct);
  }

  // ---------------------------------------------------------------------------
  // Path construction (PDF space: y up, units are points)
  // ---------------------------------------------------------------------------

  function rectPath(x, yBottom, w, h, radius) {
    if (!radius) return r2(x) + ' ' + r2(yBottom) + ' ' + r2(w) + ' ' + r2(h) + ' re';
    var rr = Math.min(radius, w / 2, h / 2), kk = rr * KAPPA;
    return r2(x + rr) + ' ' + r2(yBottom) + ' m ' +
      r2(x + w - rr) + ' ' + r2(yBottom) + ' l ' +
      r2(x + w - rr + kk) + ' ' + r2(yBottom) + ' ' + r2(x + w) + ' ' + r2(yBottom + rr - kk) + ' ' +
      r2(x + w) + ' ' + r2(yBottom + rr) + ' c ' +
      r2(x + w) + ' ' + r2(yBottom + h - rr) + ' l ' +
      r2(x + w) + ' ' + r2(yBottom + h - rr + kk) + ' ' + r2(x + w - rr + kk) + ' ' + r2(yBottom + h) + ' ' +
      r2(x + w - rr) + ' ' + r2(yBottom + h) + ' c ' +
      r2(x + rr) + ' ' + r2(yBottom + h) + ' l ' +
      r2(x + rr - kk) + ' ' + r2(yBottom + h) + ' ' + r2(x) + ' ' + r2(yBottom + h - rr + kk) + ' ' +
      r2(x) + ' ' + r2(yBottom + h - rr) + ' c ' +
      r2(x) + ' ' + r2(yBottom + rr) + ' l ' +
      r2(x) + ' ' + r2(yBottom + rr - kk) + ' ' + r2(x + rr - kk) + ' ' + r2(yBottom) + ' ' +
      r2(x + rr) + ' ' + r2(yBottom) + ' c h';
  }

  /**
   * Build the path operators for a shape item. `tx`/`ty` convert mm (y down)
   * into PDF points (y up).
   */
  function shapePath(item, tx, ty, sc) {
    var x = tx(item.x);
    var yTop = ty(item.y);
    var w = sc(item.w), h = sc(item.h);
    var yBottom = yTop - h;
    if (item.shape === 'circle') {
      var cx = x + w / 2, cy = yBottom + h / 2, rx = w / 2, ry = h / 2;
      var kx = rx * KAPPA, ky = ry * KAPPA;
      return r2(cx) + ' ' + r2(cy + ry) + ' m ' +
        r2(cx + kx) + ' ' + r2(cy + ry) + ' ' + r2(cx + rx) + ' ' + r2(cy + ky) + ' ' + r2(cx + rx) + ' ' + r2(cy) + ' c ' +
        r2(cx + rx) + ' ' + r2(cy - ky) + ' ' + r2(cx + kx) + ' ' + r2(cy - ry) + ' ' + r2(cx) + ' ' + r2(cy - ry) + ' c ' +
        r2(cx - kx) + ' ' + r2(cy - ry) + ' ' + r2(cx - rx) + ' ' + r2(cy - ky) + ' ' + r2(cx - rx) + ' ' + r2(cy) + ' c ' +
        r2(cx - rx) + ' ' + r2(cy + ky) + ' ' + r2(cx - kx) + ' ' + r2(cy + ry) + ' ' + r2(cx) + ' ' + r2(cy + ry) + ' c h';
    }
    return rectPath(x, yBottom, w, h, sc(item.radius || 0));
  }

  // ---------------------------------------------------------------------------
  // Document
  // ---------------------------------------------------------------------------

  function PdfDoc(title) {
    this.title = title || 'QR Link Card';
    this.pages = [];
    this.fonts = {
      '/F1': 'Helvetica', '/F2': 'Helvetica-Bold',
      '/F3': 'Times-Roman', '/F4': 'Times-Bold'
    };
    this.imageCache = {};
    this.imageCounter = 0;
    this.warnings = [];
  }

  PdfDoc.prototype.addPage = function (widthPt, heightPt) {
    var page = {
      widthPt: widthPt, heightPt: heightPt,
      ops: [], images: {}, shadings: {}, shadingOrder: []
    };
    this.pages.push(page);
    return page;
  };

  PdfDoc.prototype.fontFor = function (family, weight) {
    var bold = (weight || 400) >= 600;
    if (family === 'serif') return bold ? '/F4' : '/F3';
    return bold ? '/F2' : '/F1';
  };

  /** Register an image once per source; returns this page's XObject name. */
  PdfDoc.prototype.ensureImage = function (page, href) {
    var key = href.length + ':' + href.slice(0, 48) + ':' + href.slice(-24);
    var cached = this.imageCache[key];
    if (cached) {
      if (!page.images[cached.name]) page.images[cached.name] = cached;
      return cached.name;
    }

    var bytes;
    if (/^data:image\/(jpeg|jpg|pjpeg);base64,/i.test(href)) {
      bytes = base64ToBytes(href.replace(/^data:[^;]+;base64,/i, ''));
      if (!isJpeg(bytes)) throw new Error('data URL claims JPEG but the bytes are not JPEG');
    } else if (/^data:image\/png;base64,/i.test(href)) {
      bytes = base64ToBytes(href.replace(/^data:[^;]+;base64,/i, ''));
      if (!isPng(bytes)) throw new Error('data URL claims PNG but the bytes are not PNG');
    } else {
      throw new Error('PDF export needs the photo as a JPEG or PNG data URL — ' +
        'call Exporter.prepareImages() first');
    }

    var entry;
    if (isJpeg(bytes)) entry = jpegEntry(bytes);
    else entry = pngEntry(decodePng(bytes));
    entry.name = '/Im' + (++this.imageCounter);
    this.imageCache[key] = entry;
    page.images[entry.name] = entry;
    return entry.name;
  };

  function jpegEntry(bytes) {
    var width = 0, height = 0, channels = 3, pos = 2;
    while (pos + 9 < bytes.length) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      var marker = bytes[pos + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = (bytes[pos + 5] << 8) | bytes[pos + 6];
        width = (bytes[pos + 7] << 8) | bytes[pos + 8];
        channels = bytes[pos + 9];
        break;
      }
      var segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (!segLen) break;
      pos += 2 + segLen;
    }
    if (!width || !height) throw new Error('JPEG: could not read dimensions');
    var cs = channels === 1 ? '/DeviceGray' : (channels === 4 ? '/DeviceCMYK' : '/DeviceRGB');
    var dict = '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
      ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode';
    if (channels === 4) dict += ' /Decode [1 0 1 0 1 0 1 0]';
    dict += ' /Length ' + bytes.length + ' >>';
    return { dict: dict, stream: bytes };
  }

  function pngEntry(png) {
    var smaskDict = null;
    if (png.smaskBytes) {
      if (!syncDeflate) throw new Error('PNG alpha needs zlib; convert the photo to JPEG first');
      var sm = syncDeflate(png.smaskBytes);
      smaskDict = '<< /Type /XObject /Subtype /Image /Width ' + png.width + ' /Height ' + png.height +
        ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ' + sm.length + ' >>';
    }
    var dict = '<< /Type /XObject /Subtype /Image /Width ' + png.width + ' /Height ' + png.height +
      ' /ColorSpace /' + png.colorspace + ' /BitsPerComponent 8 /Filter /FlateDecode';
    if (png.predictor) {
      dict += ' /DecodeParms << /Predictor 15 /Colors ' + png.components +
        ' /BitsPerComponent 8 /Columns ' + png.width + ' >>';
    }
    dict += ' /Length ' + png.deflate.length + ' >>';
    return { dict: dict, stream: png.deflate, smask: smaskDict ? { dict: smaskDict, stream: png.smaskBytes } : null };
  }

  // ---------------------------------------------------------------------------
  // Display list -> content stream
  // ---------------------------------------------------------------------------

  function findGradient(list, ref) {
    var id = String(ref).slice(5, -1);
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 'gradient' && list[i].id === id) return list[i];
    }
    return null;
  }

  function drawList(pdf, page, list, offsetXmm, offsetYmm) {
    var pageHpt = page.heightPt;
    // mm (y down) -> points (y up), including this side's offset on the page.
    var tx = function (mm) { return (offsetXmm + mm) * PT_PER_MM; };
    var ty = function (mm) { return pageHpt - (offsetYmm + mm) * PT_PER_MM; };
    var sc = function (mm) { return mm * PT_PER_MM; };
    var ops = page.ops;

    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      switch (item.type) {
        case 'gradient': {
          // Register the shading now (with page-space coordinates) so the very
          // next `rect` that references it can paint with it.
          var name = '/Sh' + (page.shadingOrder.length + 1);
          var c0 = parseColor(item.from) || [0, 0, 0, 1];
          var c1 = parseColor(item.to) || [0, 0, 0, 1];
          page.shadings[name] = {
            coords: [r2(tx(item.x1)), r2(ty(item.y1)), r2(tx(item.x2)), r2(ty(item.y2))],
            c0: [r3(c0[0]), r3(c0[1]), r3(c0[2])],
            c1: [r3(c1[0]), r3(c1[1]), r3(c1[2])]
          };
          page.shadingOrder.push(name);
          item._pdfName = name;
          break;
        }
        case 'rect': {
          var gradientRef = item.fill && String(item.fill).indexOf('url(#') === 0
            ? findGradient(list, item.fill) : null;
          ops.push('q');
          if (gradientRef) {
            ops.push(shapePath({ shape: 'rect', x: item.x, y: item.y, w: item.w, h: item.h, radius: item.radius }, tx, ty, sc));
            ops.push('W n ' + gradientRef._pdfName + ' sh Q');
            break;
          }
          var hasFill = item.fill && item.fill !== 'none';
          var hasStroke = item.stroke && item.stroke !== 'none';
          if (hasFill) ops.push(rgbOps(item.fill, false));
          if (hasStroke) {
            ops.push(rgbOps(item.stroke, true));
            ops.push(r2(sc(item.strokeWidthMm || 0.3)) + ' w');
          }
          ops.push(rectPath(tx(item.x), ty(item.y + item.h), sc(item.w), sc(item.h), sc(item.radius || 0)));
          ops.push(hasFill && hasStroke ? 'B' : (hasFill ? 'f' : 'S'));
          ops.push('Q');
          break;
        }
        case 'line':
          ops.push('q ' + rgbOps(item.stroke, true) + ' ' + r2(sc(item.strokeWidthMm || 0.5)) +
            ' w 1 J 1 j ' + r2(tx(item.x1)) + ' ' + r2(ty(item.y1)) + ' m ' +
            r2(tx(item.x2)) + ' ' + r2(ty(item.y2)) + ' l S Q');
          break;
        case 'shape': {
          var sFill = item.fill && item.fill !== 'none';
          var sStroke = item.stroke && item.stroke !== 'none';
          ops.push('q');
          if (sFill) ops.push(rgbOps(item.fill, false));
          if (sStroke) {
            ops.push(rgbOps(item.stroke, true));
            ops.push(r2(sc(item.strokeWidthMm || 0.3)) + ' w');
          }
          ops.push(shapePath(item, tx, ty, sc));
          ops.push(sFill && sStroke ? 'B' : (sFill ? 'f' : 'S'));
          ops.push('Q');
          break;
        }
        case 'image': {
          var xname;
          try {
            xname = pdf.ensureImage(page, item.href);
          } catch (err) {
            pdf.warnings.push('photo omitted from the PDF: ' + err.message);
            ops.push('q ' + rgbOps('#dcdcdc', false) + ' ' +
              shapePath({ shape: item.clip || 'circle', x: item.x, y: item.y, w: item.w, h: item.h, radius: item.radius }, tx, ty, sc) +
              ' f Q');
            break;
          }
          ops.push('q');
          ops.push(shapePath({ shape: item.clip || 'circle', x: item.x, y: item.y, w: item.w, h: item.h, radius: item.radius }, tx, ty, sc));
          ops.push('W n');
          // cm maps the unit image onto the target box: bottom-left origin, y up.
          ops.push('q ' + r2(sc(item.w)) + ' 0 0 ' + r2(sc(item.h)) + ' ' +
            r2(tx(item.x)) + ' ' + r2(ty(item.y + item.h)) + ' cm ' + xname + ' Do Q');
          ops.push('Q');
          break;
        }
        case 'qr': {
          var qr = item.qr, mod = sc(item.moduleMm);
          var x0 = tx(item.x);
          ops.push('q ' + rgbOps(item.fill || '#111111', false));
          for (var r = 0; r < qr.size; r++) {
            for (var c = 0; c < qr.size; c++) {
              if (!qr.modules[r * qr.size + c]) continue;
              var run = 1;
              while (c + run < qr.size && qr.modules[r * qr.size + c + run]) run++;
              // y-down row r occupies [y + r*m, y + (r+1)*m]; PDF rect starts at its bottom.
              ops.push(r2(x0 + c * mod) + ' ' + r2(ty(item.y + (r + 1) * item.moduleMm)) + ' ' +
                r2(run * mod) + ' ' + r2(mod) + ' re f');
              c += run - 1;
            }
          }
          ops.push('Q');
          break;
        }
        case 'text': {
          var enc = encodeText(item.text);
          if (enc.lost.length) {
            pdf.warnings.push('"' + item.text + '" contains ' + unique(enc.lost).join(' ') +
              ', which the standard PDF fonts cannot render — an ASCII fallback was substituted');
          }
          var size = item.sizePt;
          var fontName = pdf.fontFor(item.fontFamily, item.weight);
          var widthPt = enc.bytes.length * size * Card.avgWidth(item.fontFamily, item.weight);
          var x = tx(item.x);
          if (item.align === 'center') x -= widthPt / 2;
          else if (item.align === 'right') x -= widthPt;
          var y = ty(item.y);
          if (item.baseline === 'middle') y += size * 0.36;
          var op = 'q BT ' + fontName + ' ' + r2(size) + ' Tf ' + rgbOps(item.fill, false);
          if (item.letterSpacingPt) op += ' ' + r2(item.letterSpacingPt) + ' Tc';
          op += ' ' + r2(x) + ' ' + r2(y) + ' Td ' + pdfString(enc.bytes) + ' Tj ET Q';
          ops.push(op);
          break;
        }
      }
    }
  }

  function unique(arr) {
    var seen = {};
    return arr.filter(function (v) {
      if (seen[v]) return false;
      seen[v] = 1;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  PdfDoc.prototype.write = function () {
    var self = this;
    var chunks = [], length = 0, offsets = [];

    function push(data) {
      var bytes = typeof data === 'string' ? latin1Bytes(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    }
    function beginObj(num, dict) {
      offsets[num] = length;
      push(num + ' 0 obj\n' + dict);
    }
    function endStream(streamBytes) {
      push('\nstream\n');
      push(streamBytes);
      push('\nendstream\nendobj\n');
    }
    function endObj() { push('\nendobj\n'); }

    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');

    var catalogNum = 1, pagesNum = 2, infoNum = 3;
    var next = 4;
    var fontNums = {};
    Object.keys(this.fonts).forEach(function (f) { fontNums[f] = next++; });

    // Reserve a number for every object we are about to write, in a fixed order:
    // images (with soft masks), shadings, content streams, then pages.
    var plan = [];
    this.pages.forEach(function (page) {
      Object.keys(page.images).forEach(function (name) {
        var img = page.images[name];
        img._num = img._num || next++;
        if (img.smask && !img.smask._num) img.smask._num = next++;
      });
      page.shadingOrder.forEach(function (name) {
        page.shadings[name]._num = next++;
      });
      page._contentNum = next++;
      page._num = next++;
      plan.push(page);
    });

    beginObj(catalogNum, '<< /Type /Catalog /Pages ' + pagesNum + ' 0 R >>'); endObj();
    var kids = this.pages.map(function (p) { return p._num + ' 0 R'; }).join(' ');
    beginObj(pagesNum, '<< /Type /Pages /Count ' + this.pages.length + ' /Kids [' + kids + '] >>'); endObj();
    beginObj(infoNum, '<< /Producer (QR Link Card v1) /Creator (open-qr-link-card)' +
      ' /Title ' + pdfString(encodeText(this.title).bytes) +
      ' /CreationDate (D:' + pdfDate() + ') >>'); endObj();

    Object.keys(this.fonts).forEach(function (name) {
      beginObj(fontNums[name], '<< /Type /Font /Subtype /Type1 /BaseFont /' + self.fonts[name] +
        ' /Encoding /WinAnsiEncoding >>');
      endObj();
    });

    this.pages.forEach(function (page) {
      // images
      Object.keys(page.images).forEach(function (name) {
        var img = page.images[name];
        if (img.smask) {
          beginObj(img.smask._num, img.smask.dict);
          endStream(img.smask.stream);
        }
        var dict = img.dict;
        if (img.smask) dict = dict.replace(/>>$/, '/SMask ' + img.smask._num + ' 0 R >>');
        beginObj(img._num, dict);
        endStream(img.stream);
      });
      // shadings
      page.shadingOrder.forEach(function (name) {
        var sh = page.shadings[name];
        beginObj(sh._num, '<< /ShadingType 2 /ColorSpace /DeviceRGB /Domain [0 1] /Extend [true true]' +
          ' /Coords [' + sh.coords.join(' ') + ']' +
          ' /Function << /FunctionType 2 /Domain [0 1] /C0 [' + sh.c0.join(' ') + ']' +
          ' /C1 [' + sh.c1.join(' ') + '] /N 1 >> >>');
        endObj();
      });
      // content stream
      var content = page.ops.join('\n') + '\n';
      var contentBytes = latin1Bytes(content);
      beginObj(page._contentNum, '<< /Length ' + contentBytes.length + ' >>');
      endStream(contentBytes);
      // page
      var res = '<< /Font <<';
      var usedFonts = {};
      page.ops.forEach(function (op) {
        Object.keys(fontNums).forEach(function (f) {
          if (op.indexOf(f + ' ') >= 0) usedFonts[f] = true;
        });
      });
      Object.keys(usedFonts).forEach(function (f) { res += ' ' + f + ' ' + fontNums[f] + ' 0 R'; });
      res += ' >>';
      var xo = Object.keys(page.images);
      if (xo.length) {
        res += ' /XObject <<';
        xo.forEach(function (n) { res += ' ' + n + ' ' + page.images[n]._num + ' 0 R'; });
        res += ' >>';
      }
      if (page.shadingOrder.length) {
        res += ' /Shading <<';
        page.shadingOrder.forEach(function (n) { res += ' ' + n + ' ' + page.shadings[n]._num + ' 0 R'; });
        res += ' >>';
      }
      res += ' >>';
      beginObj(page._num, '<< /Type /Page /Parent ' + pagesNum + ' 0 R /MediaBox [0 0 ' +
        r2(page.widthPt) + ' ' + r2(page.heightPt) + '] /Resources ' + res +
        ' /Contents ' + page._contentNum + ' 0 R >>');
      endObj();
    });

    var startxref = length;
    var maxNum = next - 1;
    var xref = 'xref\n0 ' + (maxNum + 1) + '\n0000000000 65535 f \n';
    for (var n = 1; n <= maxNum; n++) {
      xref += String(offsets[n] == null ? 0 : offsets[n]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (maxNum + 1) + ' /Root ' + catalogNum + ' 0 R /Info ' + infoNum + ' 0 R >>\n' +
      'startxref\n' + startxref + '\n%%EOF\n');

    var out = new Uint8Array(length);
    var p = 0;
    chunks.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  };

  function pdfDate(d) {
    d = d || new Date();
    function pad(n) { return String(n).padStart(2, '0'); }
    return '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z00'00'";
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * @param {object} card  result of Card.buildCard()
   * @param {object} options { sides: ['front','back'] | 'sheet', bleed: bool, title }
   * @returns {{ bytes: Uint8Array, warnings: string[] }}
   */
  function generate(card, options) {
    options = options || {};
    var pdf = new PdfDoc(options.title || ((card.profile && card.profile.display_name) + ' — QR Link Card'));
    var W = card.widthMm, H = card.heightMm;
    var bleed = options.bleed ? 3 : 0;
    var sides = options.sides === 'sheet' ? ['sheet'] : (options.sides || ['front', 'back']);

    sides.forEach(function (side) {
      if (side === 'sheet') {
        var gap = 8; // mm between the two cards, room for a guillotine cut
        var pageW = (W + bleed * 2) * 2 + gap;
        var pageH = H + bleed * 2;
        var page = pdf.addPage(pageW * PT_PER_MM, pageH * PT_PER_MM);
        page.ops.push('q ' + rgbOps('#ffffff', false) + ' 0 0 ' + r2(pageW * PT_PER_MM) + ' ' +
          r2(pageH * PT_PER_MM) + ' re f Q');
        drawList(pdf, page, card.front, 0, 0);
        drawList(pdf, page, card.back, W + bleed * 2 + gap, 0);
        // trim marks at the corners of each card
        trimMarks(page, [0, W + bleed * 2 + gap], pageW, pageH, bleed);
      } else {
        var pageW2 = W + bleed * 2, pageH2 = H + bleed * 2;
        var page2 = pdf.addPage(pageW2 * PT_PER_MM, pageH2 * PT_PER_MM);
        page2.ops.push('q ' + rgbOps('#ffffff', false) + ' 0 0 ' + r2(pageW2 * PT_PER_MM) + ' ' +
          r2(pageH2 * PT_PER_MM) + ' re f Q');
        drawList(pdf, page2, card[side], 0, 0);
      }
    });

    return { bytes: pdf.write(), warnings: pdf.warnings };
  }

  /** Light gray trim marks showing where the card edges fall inside the bleed. */
  function trimMarks(page, xOffsetsMm, pageWmm, pageHmm, bleedMm) {
    if (!bleedMm) return;
    var H = pageHmm * PT_PER_MM;
    page.ops.push('q ' + rgbOps('#999999', true) + ' 0.3 w [1 2] 0 d');
    xOffsetsMm.forEach(function (xOff) {
      [0, 89].forEach(function (edge) {
        var x = (xOff + bleedMm + edge) * PT_PER_MM;
        page.ops.push(r2(x) + ' 0 m ' + r2(x) + ' ' + r2(H) + ' l S');
      });
    });
    [0, 51].forEach(function (edge) {
      var y = H - (bleedMm + edge) * PT_PER_MM;
      page.ops.push('0 ' + r2(y) + ' m ' + r2(pageWmm * PT_PER_MM) + ' ' + r2(y) + ' l S');
    });
    page.ops.push('Q');
  }

  return {
    PT_PER_MM: PT_PER_MM,
    generate: generate,
    encodeText: encodeText,
    pdfString: pdfString,
    parseColor: parseColor,
    decodePng: decodePng,
    unfilter: unfilter,
    rectPath: rectPath,
    shapePath: shapePath,
    jpegEntry: jpegEntry,
    PdfDoc: PdfDoc,
    hasZlib: !!syncInflate
  };
});
