/*!
 * export.js — download the card as SVG, PNG or a real vector PDF (§7.1, §18).
 *
 * Print quality notes (Appendix C):
 *   - PDF is the right answer for a print shop. The QR is vector paths and the
 *     page is exactly 89 x 51 mm, so there is no DPI to get wrong.
 *   - PNG is rasterised from the same SVG at ~300 DPI (1051 x 591 px) which is
 *     fine for home/office printers.
 *   - SVG scales forever and is what the on-screen preview shows.
 *
 * The PNG path rasterises through an <img> + canvas, which is how browsers let
 * you turn SVG into pixels without a library. That means Firefox cannot export
 * PNG from a blob SVG (bug 1630796); the UI hides the button and offers PDF
 * instead, which is better for printing anyway.
 */
(function (root, factory) {
  var Card = (typeof module === 'object' && module.exports) ? require('./card.js') : root.Card;
  var Pdf = (typeof module === 'object' && module.exports) ? require('./pdf.js') : root.PdfCard;
  var TPL = (typeof module === 'object' && module.exports)
    ? require('../card-templates/card-templates.js') : root.CardTemplates;
  var api = factory(Card, Pdf, TPL);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Exporter = api;
})(typeof self !== 'undefined' ? self : this, function (Card, Pdf, TPL) {
  'use strict';

  var DPI = 300;
  var PX_PER_MM = DPI / 25.4;   // ~11.81

  /** True when SVG -> canvas rasterisation is known to work in this browser. */
  function canRasteriseSvg() {
    if (typeof navigator === 'undefined') return false;
    var ua = navigator.userAgent || '';
    return !/Firefox\//.test(ua);
  }

  /**
   * Feature-test the SVG -> canvas path rather than trusting the user agent.
   * Firefox blocks it, and so does any environment without a real canvas
   * (Node/jsdom, some embedded webviews).
   */
  function canvasAvailable() {
    if (typeof document === 'undefined') return false;
    try {
      var probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      var ctx = probe.getContext && probe.getContext('2d');
      return !!ctx && typeof ctx.drawImage === 'function';
    } catch (e) {
      return false;
    }
  }

  function svgToBlobUrl(svg) {
    var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    return URL.createObjectURL(blob);
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('could not load image: ' + src.slice(0, 60))); };
      img.src = src;
    });
  }

  /**
   * Fetch a remote photo and return it as a JPEG data URL so it can be embedded
   * in the SVG/PDF without a network request (and without tainting the canvas).
   * Remote hosts without CORS headers will fail — the caller should warn the
   * user to upload the photo instead.
   */
  function toEmbeddedDataUrl(url, maxEdge, quality) {
    if (!url || /^data:/i.test(url)) return Promise.resolve(url || null);
    maxEdge = maxEdge || 600;
    return loadImage(url).then(function (img) {
      var scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', quality || 0.92);
    });
  }

  /** Rebuild the card with the photo inlined. Returns { card, warnings }. */
  function prepareCard(profile, options) {
    options = options || {};
    var warnings = [];
    var photo = profile.photo_url || null;
    if (profile.card_settings && profile.card_settings.show_photo === false) photo = null;
    var background = profile.card_settings && profile.card_settings.background_image;
    if (!photo && !background) return Promise.resolve({ card: Card.buildCard(profile, options), warnings: warnings });

    return Promise.all([
      photo ? toEmbeddedDataUrl(photo) : Promise.resolve(null),
      background ? toEmbeddedDataUrl(background, 1600, 0.9) : Promise.resolve(null)
    ]).then(function (images) {
      var photoDataUrl = images[0], backgroundDataUrl = images[1];
      if (photo && !photoDataUrl) warnings.push('The photo could not be embedded; upload it instead of linking to it.');
      if (background && !backgroundDataUrl) warnings.push('The background image could not be embedded; upload it instead of linking to it.');
      return {
        card: Card.buildCard(profile, Object.assign({}, options, {
          photoDataUrl: photoDataUrl,
          backgroundDataUrl: backgroundDataUrl
        })),
        warnings: warnings
      };
    }).catch(function (err) {
      warnings.push('Image skipped: ' + err.message);
      return { card: Card.buildCard(profile, options), warnings: warnings };
    });
  }

  // ---------------------------------------------------------------------------
  // Downloads
  // ---------------------------------------------------------------------------

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function safeName(username, kind, ext) {
    var base = String(username || 'card').replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
    return 'qr-link-card_' + base + '_' + kind + '.' + ext;
  }

  /**
   * Rasterise any SVG markup to a PNG blob at a given pixel density.
   * Cards go through toPngCanvas(); this is for standalone artwork (the QR
   * generator, a single code for a sticker). Resolves null when the browser
   * cannot draw an SVG into a canvas — Firefox, notably — so callers can fall
   * back to handing over the vector original instead.
   *
   * @param {string} svg    SVG markup; its width/height attributes are replaced
   * @param {number} width  target width in px
   * @param {number} height target height in px
   * @param {string} [background] fill painted behind the artwork
   * @returns {Promise<Blob|null>}
   */
  function rasteriseSvg(svg, width, height, background) {
    if (!canRasteriseSvg() || !canvasAvailable()) return Promise.resolve(null);
    var tagEnd = svg.indexOf('>');
    var tag = svg.slice(0, tagEnd);
    var sized = '<svg ' +
      tag.replace(/^<svg\s*/, '')
         .replace(/\swidth="[^"]*"/, '')
         .replace(/\sheight="[^"]*"/, '') +
      ' width="' + width + '" height="' + height + '"' +
      svg.slice(tagEnd);
    var url = svgToBlobUrl(sized);
    return loadImage(url).then(function (img) {
      URL.revokeObjectURL(url);
      var canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
      ctx.drawImage(img, 0, 0, width, height);
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
      });
    }).catch(function (err) {
      URL.revokeObjectURL(url);
      throw err;
    });
  }

  function exportSvg(prepared, side, username) {
    var svg = Card.toSVG(prepared.card, side, { bleed: false, pxPerMm: PX_PER_MM });
    download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), safeName(username, side, 'svg'));
    return svg;
  }

  /**
   * Rasterise one side to PNG at ~300 DPI.
   * Resolves with the canvas; rejects if the browser cannot do SVG -> canvas.
   */
  function toPngCanvas(prepared, side, opts) {
    opts = opts || {};
    if (!canvasAvailable()) {
      return Promise.reject(new Error('this browser cannot rasterise SVG'));
    }
    var pxPerMm = opts.pxPerMm || PX_PER_MM;
    var svg = Card.toSVG(prepared.card, side, { bleed: opts.bleed, pxPerMm: pxPerMm });
    var bleedMm = prepared.card.bleedMm || TPL.GEOMETRY.bleedMm;
    var W = prepared.card.widthMm + (opts.bleed ? bleedMm * 2 : 0);
    var H = prepared.card.heightMm + (opts.bleed ? bleedMm * 2 : 0);
    var width = Math.round(W * pxPerMm);
    var height = Math.round(H * pxPerMm);

    // Re-emit at the exact target pixel size: the viewBox does the scaling, so
    // the QR edges stay crisp (shape-rendering is set inside the SVG).
    svg = svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/,
      '<svg $1width="' + width + '" height="' + height + '"');

    var url = svgToBlobUrl(svg);
    return loadImage(url).then(function (img) {
      URL.revokeObjectURL(url);
      var canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      return canvas;
    }).catch(function (err) {
      URL.revokeObjectURL(url);
      throw err;
    });
  }

  function exportPng(prepared, side, username, opts) {
    return toPngCanvas(prepared, side, opts).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          if (!blob) { resolve(null); return; }
          download(blob, safeName(username, side + '-300dpi', 'png'));
          resolve(blob);
        }, 'image/png');
      });
    });
  }

  /** Both sides as one PDF. `sides` may be ['front','back'] or 'sheet'. */
  function exportPdf(prepared, username, opts) {
    opts = opts || {};
    var out = Pdf.generate(prepared.card, {
      sides: opts.sides || ['front', 'back'],
      bleed: opts.bleed,
      title: (username ? username + ' — QR Link Card' : 'QR Link Card')
    });
    var warnings = prepared.warnings.concat(out.warnings);
    var blob = new Blob([out.bytes], { type: 'application/pdf' });
    download(blob, safeName(username, opts.sides === 'sheet' ? 'print-sheet' : 'both-sides', 'pdf'));
    return { bytes: out.bytes, warnings: warnings };
  }

  /** Everything at once, so one click gives the user all three formats. */
  function exportAll(prepared, username, opts) {
    opts = opts || {};
    var warnings = [];
    var jobs = [];
    jobs.push(Promise.resolve().then(function () { exportSvg(prepared, 'front', username); }));
    jobs.push(Promise.resolve().then(function () { exportSvg(prepared, 'back', username); }));
    try {
      exportPdf(prepared, username, { sides: ['front', 'back'], bleed: opts.bleed });
    } catch (e) { warnings.push('PDF failed: ' + e.message); }
    if (canRasteriseSvg()) {
      jobs.push(exportPng(prepared, 'front', username, { bleed: opts.bleed }).catch(function (e) {
        warnings.push('PNG failed: ' + e.message);
      }));
      jobs.push(exportPng(prepared, 'back', username, { bleed: opts.bleed }).catch(function (e) {
        warnings.push('PNG failed: ' + e.message);
      }));
    } else {
      warnings.push('PNG export is unavailable in this browser; the PDF and SVG are better for print anyway.');
    }
    return Promise.all(jobs).then(function () {
      return { warnings: warnings.concat(prepared.warnings) };
    });
  }

  /** A shareable clipboard copy of the profile URL. */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; });
    }
    // Fallback for non-secure contexts (plain http on a LAN, for instance).
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return Promise.resolve(ok);
  }

  return {
    DPI: DPI,
    PX_PER_MM: PX_PER_MM,
    canRasteriseSvg: canRasteriseSvg,
    canvasAvailable: canvasAvailable,
    rasteriseSvg: rasteriseSvg,
    toEmbeddedDataUrl: toEmbeddedDataUrl,
    prepareCard: prepareCard,
    toPngCanvas: toPngCanvas,
    exportSvg: exportSvg,
    exportPng: exportPng,
    exportPdf: exportPdf,
    exportAll: exportAll,
    download: download,
    copyText: copyText,
    safeName: safeName
  };
});
