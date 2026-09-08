/*!
 * card.js — turns a profile into a print-ready business card (§7.1).
 *
 * The renderer builds a "display list" of drawing primitives in millimetres
 * (y down, like SVG). Two writers consume that same list:
 *
 *   toSVG()   -> markup for on-screen preview and PNG rasterisation
 *   (lib/pdf.js) -> a true vector PDF at exact millimetre size
 *
 * One layout, two outputs: what you preview is byte-for-byte what you print.
 * No dependencies beyond lib/qr.js and card-templates/card-templates.js.
 */
(function (root, factory) {
  var QR = (typeof module === 'object' && module.exports) ? require('./qr.js') : root.QRCode;
  var TPL = (typeof module === 'object' && module.exports)
    ? require('../card-templates/card-templates.js') : root.CardTemplates;
  var api = factory(QR, TPL);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Card = api;
})(typeof self !== 'undefined' ? self : this, function (QRCode, TPL) {
  'use strict';

  var MM_TO_PT = 72 / 25.4;

  // ---------------------------------------------------------------------------
  // Text metrics — shared by the SVG and PDF writers so both truncate identically
  // ---------------------------------------------------------------------------

  // Average advance width as a fraction of font size, per font/weight.
  // Helvetica is proportional; these averages are good enough for fitting and
  // both writers use the SAME numbers, so preview and print agree.
  var AVG_WIDTH = {
    sansRegular: 0.50,
    sansBold: 0.556,
    serifRegular: 0.48,
    serifBold: 0.52
  };

  function avgWidth(fontFamily, weight) {
    if (fontFamily === 'serif') return weight >= 600 ? AVG_WIDTH.serifBold : AVG_WIDTH.serifRegular;
    return weight >= 600 ? AVG_WIDTH.sansBold : AVG_WIDTH.sansRegular;
  }

  function textWidthMm(str, sizePt, fontFamily, weight) {
    return (str.length * sizePt * avgWidth(fontFamily, weight)) / MM_TO_PT;
  }

  /** Shrink the font, then ellipsise, until the text fits maxWidthMm. */
  function fitText(str, opts) {
    var text = String(str == null ? '' : str);
    var size = opts.sizePt;
    var minSize = opts.minSizePt || 5;
    while (size > minSize && textWidthMm(text, size, opts.fontFamily, opts.weight) > opts.maxWidthMm) {
      size -= 0.5;
    }
    if (textWidthMm(text, size, opts.fontFamily, opts.weight) > opts.maxWidthMm) {
      while (text.length > 1 &&
             textWidthMm(text + '…', size, opts.fontFamily, opts.weight) > opts.maxWidthMm) {
        text = text.slice(0, -1);
      }
      text = text + '…';
    }
    return { text: text, sizePt: size };
  }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** Strip the scheme and trailing slash for the caption under the QR. */
  function shortUrl(url) {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------
  // Display list construction
  // ---------------------------------------------------------------------------

  var CARD_SIZES = {
    standard: { widthMm: 89, heightMm: 51 },
    square: { widthMm: 65, heightMm: 65 },
    mini: { widthMm: 70, heightMm: 40 },
    postcard: { widthMm: 100, heightMm: 70 }
  };

  function geometryFor(profile, options) {
    var id = (profile && profile.card_settings && profile.card_settings.size) ||
      (options && options.size) || 'standard';
    var selected = CARD_SIZES[id] || CARD_SIZES.standard;
    var base = TPL.GEOMETRY;
    if (id === 'standard') return Object.assign({}, base);
    return Object.assign({}, base, selected, {
      marginMm: Math.min(base.marginMm, selected.widthMm / 12, selected.heightMm / 8),
      photoSizeMm: Math.min(base.photoSizeMm, selected.heightMm * 0.43),
      qrSizeMm: Math.min(base.qrSizeMm, selected.heightMm * 0.56)
    });
  }

  function gradientRect(list, bg, x, y, w, h) {
    if (bg.type === 'gradient') {
      list.push({
        type: 'gradient',
        id: 'g' + list.length,
        x1: x, y1: y,
        x2: x + w * Math.cos((bg.angle || 135) * Math.PI / 180),
        y2: y + h * Math.sin((bg.angle || 135) * Math.PI / 180),
        from: bg.from, to: bg.to
      });
      list.push({ type: 'rect', x: x, y: y, w: w, h: h, fill: 'url(#g' + (list.length - 1) + ')' });
    } else {
      list.push({ type: 'rect', x: x, y: y, w: w, h: h, fill: bg.color });
    }
  }

  function photoOrMonogram(list, opts) {
    var x = opts.x, y = opts.y, size = opts.size, style = opts.style;
    var shape = style.photoShape === 'rounded' ? 'rounded' : 'circle';
    var radius = shape === 'rounded' ? Math.min(3, size * 0.14) : size / 2;
    if (opts.photo) {
      list.push({
        type: 'image', href: opts.photo,
        x: x, y: y, w: size, h: size,
        clip: shape, radius: radius
      });
    } else {
      list.push({
        type: 'shape', shape: shape,
        x: x, y: y, w: size, h: size, radius: radius,
        fill: style.monogramBg || '#eeeeee'
      });
      list.push({
        type: 'text',
        text: initials(opts.name),
        x: x + size / 2, y: y + size / 2,
        sizePt: size * MM_TO_PT * 0.36,
        fontFamily: 'sans', weight: 700,
        fill: style.monogramColor || '#111111',
        align: 'center', baseline: 'middle'
      });
    }
    if (style.photoRing) {
      list.push({
        type: 'shape', shape: shape,
        x: x, y: y, w: size, h: size, radius: radius,
        stroke: style.photoRing, strokeWidthMm: 0.6, fill: 'none'
      });
    }
  }

  /**
   * The front of the card: photo, name, designation, optional tagline.
   */
  function buildFront(profile, template, options) {
    options = options || {};
    var G = options.geometry || geometryFor(profile, options);
    var W = G.widthMm, H = G.heightMm;
    var style = template.front;
    var list = [];
    var m = G.marginMm;

    gradientRect(list, style.background, 0, 0, W, H);
    var backgroundImage = options.backgroundDataUrl ||
      (profile.card_settings && profile.card_settings.background_image);
    if (backgroundImage) {
      list.push({ type: 'image', href: backgroundImage, x: 0, y: 0, w: W, h: H, clip: 'rect', radius: 0 });
      // A translucent wash keeps text readable over a social-post image.
      list.push({ type: 'rect', x: 0, y: 0, w: W, h: H, fill: 'rgba(0,0,0,0.18)' });
    }
    if (style.border) {
      list.push({
        type: 'rect', x: 1.4, y: 1.4, w: W - 2.8, h: H - 2.8,
        fill: 'none', stroke: style.border, strokeWidthMm: 0.35, radius: 1.6
      });
    }
    if (style.stripe) {
      list.push({ type: 'rect', x: 0, y: 0, w: 2.6, h: H, fill: style.accent });
    }
    if (style.block) {
      list.push({ type: 'rect', x: 0, y: 0, w: 34, h: H, fill: '#000000' });
    }

    var name = profile.display_name || profile.username || '';
    var role = profile.designation || '';
    var tagline = profile.tagline || (profile.card_settings && profile.card_settings.tagline) || '';
    var showPhoto = profile.card_settings ? profile.card_settings.show_photo !== false : true;
    var photo = showPhoto ? (options.photoDataUrl || profile.photo_url || null) : null;
    var leftPad = style.stripe ? m + 3 : m;

    if (template.layout === 'centered') {
      var cx = W / 2;
      var y = m + 0.5;
      if (photo || showPhoto) {
        photoOrMonogram(list, {
          x: cx - G.photoSizeMm / 2, y: y, size: G.photoSizeMm,
          style: style, photo: photo, name: name
        });
        y += G.photoSizeMm + 2.4;
      }
      var nameFit = fitText(name, {
        sizePt: style.nameSizePt, minSizePt: 9,
        maxWidthMm: W - 2 * m, fontFamily: style.nameFont, weight: style.nameWeight
      });
      list.push({
        type: 'text', text: nameFit.text, x: cx, y: y + nameFit.sizePt / MM_TO_PT * 0.8,
        sizePt: nameFit.sizePt, fontFamily: style.nameFont, weight: style.nameWeight,
        fill: style.nameColor, align: 'center'
      });
      y += nameFit.sizePt / MM_TO_PT + 1.2;
      if (role) {
        var roleFit = fitText(role.toUpperCase(), {
          sizePt: style.roleSizePt, minSizePt: 6,
          maxWidthMm: W - 2 * m, fontFamily: 'sans', weight: 500
        });
        list.push({
          type: 'text', text: roleFit.text, x: cx, y: y + roleFit.sizePt / MM_TO_PT * 0.8,
          sizePt: roleFit.sizePt, fontFamily: 'sans', weight: 500,
          fill: style.roleColor, align: 'center', letterSpacingPt: 0.6
        });
        y += roleFit.sizePt / MM_TO_PT + 1.6;
      }
      list.push({
        type: 'line', x1: cx - 9, y1: y, x2: cx + 9, y2: y,
        stroke: style.accent, strokeWidthMm: 0.5
      });
      y += 2.4;
      if (tagline) {
        var tagFit = fitText(tagline, {
          sizePt: style.taglineSizePt, minSizePt: 5.5,
          maxWidthMm: W - 2 * m - 4, fontFamily: 'sans', weight: 400
        });
        list.push({
          type: 'text', text: tagFit.text, x: cx, y: y + tagFit.sizePt / MM_TO_PT * 0.8,
          sizePt: tagFit.sizePt, fontFamily: 'sans', weight: 400,
          fill: style.taglineColor, align: 'center'
        });
      }
      return list;
    }

    // layout: photo-left
    if (photo || showPhoto) {
      photoOrMonogram(list, {
        x: leftPad, y: (H - G.photoSizeMm) / 2, size: G.photoSizeMm,
        style: style, photo: photo, name: name
      });
    }
    var tx = leftPad + G.photoSizeMm + 5;
    var maxTextW = W - tx - m;
    var ty = H / 2 - 6.2;

    var nFit = fitText(name, {
      sizePt: style.nameSizePt, minSizePt: 9,
      maxWidthMm: maxTextW, fontFamily: style.nameFont, weight: style.nameWeight
    });
    list.push({
      type: 'text', text: nFit.text, x: tx, y: ty + nFit.sizePt / MM_TO_PT * 0.8,
      sizePt: nFit.sizePt, fontFamily: style.nameFont, weight: style.nameWeight,
      fill: style.nameColor, align: 'left'
    });
    ty += nFit.sizePt / MM_TO_PT + 1.1;

    if (role) {
      var rFit = fitText(role, {
        sizePt: style.roleSizePt, minSizePt: 6,
        maxWidthMm: maxTextW, fontFamily: 'sans', weight: 500
      });
      list.push({
        type: 'text', text: rFit.text, x: tx, y: ty + rFit.sizePt / MM_TO_PT * 0.8,
        sizePt: rFit.sizePt, fontFamily: 'sans', weight: 500,
        fill: style.roleColor, align: 'left'
      });
      ty += rFit.sizePt / MM_TO_PT + 2.2;
    }

    list.push({
      type: 'line', x1: tx, y1: ty, x2: tx + Math.min(18, maxTextW), y2: ty,
      stroke: style.accent, strokeWidthMm: 0.5
    });
    ty += 2.2;

    if (tagline) {
      var tFit = fitText(tagline, {
        sizePt: style.taglineSizePt, minSizePt: 5.5,
        maxWidthMm: maxTextW, fontFamily: 'sans', weight: 400
      });
      list.push({
        type: 'text', text: tFit.text, x: tx, y: ty + tFit.sizePt / MM_TO_PT * 0.8,
        sizePt: tFit.sizePt, fontFamily: 'sans', weight: 400,
        fill: style.taglineColor, align: 'left'
      });
    }
    return list;
  }

  /**
   * The back of the card: the QR that points at the permanent profile URL.
   * The QR encodes the profile URL and nothing else — that is the whole idea.
   */
  function buildBack(profile, template, options) {
    options = options || {};
    var G = options.geometry || geometryFor(profile, options);
    var W = G.widthMm, H = G.heightMm;
    var style = template.back;
    var list = [];

    gradientRect(list, style.background, 0, 0, W, H);
    if (style.border) {
      list.push({
        type: 'rect', x: 1.4, y: 1.4, w: W - 2.8, h: H - 2.8,
        fill: 'none', stroke: style.border, strokeWidthMm: 0.35, radius: 1.6
      });
    }
    if (style.stripe) {
      list.push({ type: 'rect', x: 0, y: 0, w: 2.6, h: H, fill: style.accent });
    }

    var url = options.profileUrl || profile.profile_url || '';
    if (!url) {
      list.push({
        type: 'text', text: 'Set a profile URL to generate the QR code',
        x: W / 2, y: H / 2, sizePt: 9, fontFamily: 'sans', weight: 500,
        fill: style.textColor, align: 'center', baseline: 'middle'
      });
      return list;
    }

    // Error-correction level Q: a printed card gets scratched, coffee-ringed and
    // bent. Q recovers 25% damage; M would only recover 15%.
    var qr = QRCode.create(url, { ecl: options.ecl || 'Q', margin: 0 });
    var tile = G.qrSizeMm + G.qrQuietMm * 2;
    var tileX = (W - tile) / 2;
    var tileY = 4.5;

    list.push({
      type: 'rect', x: tileX, y: tileY, w: tile, h: tile,
      fill: style.qrTile || '#ffffff', radius: 1.8,
      stroke: style.stripe ? 'none' : (style.border || 'none'), strokeWidthMm: 0.3
    });
    var moduleMm = G.qrSizeMm / qr.size;
    list.push({
      type: 'qr',
      qr: qr,
      x: tileX + G.qrQuietMm, y: tileY + G.qrQuietMm,
      moduleMm: moduleMm,
      fill: '#111111'
    });

    var caption = shortUrl(url);
    var capFit = fitText(caption, {
      sizePt: style.captionSizePt, minSizePt: 5.5,
      maxWidthMm: W - 2 * G.marginMm, fontFamily: 'sans', weight: 700
    });
    list.push({
      type: 'text', text: capFit.text, x: W / 2, y: tileY + tile + 4.2,
      sizePt: capFit.sizePt, fontFamily: 'sans', weight: 700,
      fill: style.textColor, align: 'center', letterSpacingPt: 0.2
    });

    // §18 Challenge 2: explain the access model on the card itself.
    var hintFit = fitText('Scan for public links · Ask for private access', {
      sizePt: style.hintSizePt, minSizePt: 5,
      maxWidthMm: W - 2 * G.marginMm, fontFamily: 'sans', weight: 400
    });
    list.push({
      type: 'text', text: hintFit.text, x: W / 2, y: H - 4.6,
      sizePt: hintFit.sizePt, fontFamily: 'sans', weight: 400,
      fill: style.mutedColor, align: 'center'
    });

    return list;
  }

  /** Both sides, ready for the writers. */
  function buildCard(profile, options) {
    options = options || {};
    var template = TPL.get((profile.card_settings && profile.card_settings.template_id) ||
      options.templateId || 'template-1');
    return {
      template: template,
      widthMm: (options.geometry || geometryFor(profile, options)).widthMm,
      heightMm: (options.geometry || geometryFor(profile, options)).heightMm,
      bleedMm: TPL.GEOMETRY.bleedMm,
      profile: profile,
      front: buildFront(profile, template, Object.assign({}, options, { geometry: options.geometry || geometryFor(profile, options) })),
      back: buildBack(profile, template, Object.assign({}, options, { geometry: options.geometry || geometryFor(profile, options) }))
    };
  }

  // ---------------------------------------------------------------------------
  // SVG writer (y down, 1 user unit = 1 mm)
  // ---------------------------------------------------------------------------

  function esc(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fontFamilyCss(family) {
    return family === 'serif' ? TPL.SERIF : TPL.SANS;
  }

  function qrPathData(qr, x, y, moduleMm) {
    var d = '';
    var size = qr.size;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (!qr.modules[r * size + c]) continue;
        // Merge horizontal runs to keep the path small.
        var run = 1;
        while (c + run < size && qr.modules[r * size + c + run]) run++;
        d += 'M' + round(x + c * moduleMm) + ' ' + round(y + r * moduleMm) +
             'h' + round(run * moduleMm) + 'v' + round(moduleMm) +
             'h-' + round(run * moduleMm) + 'z';
        c += run - 1;
      }
    }
    return d;
  }

  function round(n) { return Math.round(n * 1000) / 1000; }

  /** Shape path for a circle or rounded rect, in mm (y down). */
  function shapePath(item) {
    var x = item.x, y = item.y, w = item.w, h = item.h;
    if (item.shape === 'circle') {
      var cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2, k = 0.5522847498;
      return 'M' + round(cx) + ' ' + round(y) +
        'C' + round(cx + rx * k) + ' ' + round(y) + ' ' + round(x + w) + ' ' + round(cy - ry * k) + ' ' + round(x + w) + ' ' + round(cy) +
        'C' + round(x + w) + ' ' + round(cy + ry * k) + ' ' + round(cx + rx * k) + ' ' + round(y + h) + ' ' + round(cx) + ' ' + round(y + h) +
        'C' + round(cx - rx * k) + ' ' + round(y + h) + ' ' + round(x) + ' ' + round(cy + ry * k) + ' ' + round(x) + ' ' + round(cy) +
        'C' + round(x) + ' ' + round(cy - ry * k) + ' ' + round(cx - rx * k) + ' ' + round(y) + ' ' + round(cx) + ' ' + round(y) + 'Z';
    }
    var r = Math.min(item.radius || 0, w / 2, h / 2);
    if (!r) return 'M' + round(x) + ' ' + round(y) + 'h' + round(w) + 'v' + round(h) + 'h-' + round(w) + 'z';
    return 'M' + round(x + r) + ' ' + round(y) +
      'h' + round(w - 2 * r) + 'a' + round(r) + ' ' + round(r) + ' 0 0 1 ' + round(r) + ' ' + round(r) +
      'v' + round(h - 2 * r) + 'a' + round(r) + ' ' + round(r) + ' 0 0 1 -' + round(r) + ' ' + round(r) +
      'h-' + round(w - 2 * r) + 'a' + round(r) + ' ' + round(r) + ' 0 0 1 -' + round(r) + ' -' + round(r) +
      'v-' + round(h - 2 * r) + 'a' + round(r) + ' ' + round(r) + ' 0 0 1 ' + round(r) + ' -' + round(r) + 'Z';
  }

  function textAnchor(align) {
    return align === 'center' ? 'middle' : (align === 'right' ? 'end' : 'start');
  }

  function toSVG(card, side, options) {
    options = options || {};
    var list = side === 'back' ? card.back : card.front;
    var W = card.widthMm, H = card.heightMm;
    var bleed = options.bleed ? (card.bleedMm || TPL.GEOMETRY.bleedMm) : 0;
    var widthMm = W + bleed * 2, heightMm = H + bleed * 2;
    var pxPerMm = options.pxPerMm || 4;      // on-screen preview density
    var defs = [];
    var body = [];
    var clipId = 'cardClip' + Math.random().toString(36).slice(2, 7);

    defs.push('<clipPath id="' + clipId + '"><rect x="0" y="0" width="' + W + '" height="' + H + '"/></clipPath>');

    list.forEach(function (item) {
      switch (item.type) {
        case 'gradient':
          // Paint servers must live in <defs> for the markup to be valid SVG.
          defs.push('<linearGradient id="' + item.id + '" gradientUnits="userSpaceOnUse" x1="' +
            round(item.x1) + '" y1="' + round(item.y1) + '" x2="' + round(item.x2) + '" y2="' +
            round(item.y2) + '"><stop offset="0" stop-color="' + item.from + '"/><stop offset="1" stop-color="' +
            item.to + '"/></linearGradient>');
          break;
        case 'rect':
          body.push('<rect x="' + round(item.x) + '" y="' + round(item.y) + '" width="' + round(item.w) +
            '" height="' + round(item.h) + '"' +
            (item.radius ? ' rx="' + round(item.radius) + '"' : '') +
            ' fill="' + (item.fill || 'none') + '"' +
            (item.stroke && item.stroke !== 'none' ? ' stroke="' + item.stroke + '" stroke-width="' +
              round(item.strokeWidthMm || 0.3) + '"' : '') + '/>');
          break;
        case 'line':
          body.push('<line x1="' + round(item.x1) + '" y1="' + round(item.y1) + '" x2="' + round(item.x2) +
            '" y2="' + round(item.y2) + '" stroke="' + item.stroke + '" stroke-width="' +
            round(item.strokeWidthMm || 0.5) + '" stroke-linecap="round"/>');
          break;
        case 'shape':
          body.push('<path d="' + shapePath(item) + '" fill="' + (item.fill || 'none') + '"' +
            (item.stroke && item.stroke !== 'none' ? ' stroke="' + item.stroke + '" stroke-width="' +
              round(item.strokeWidthMm || 0.3) + '"' : '') + '/>');
          break;
        case 'image': {
          var id = 'img' + Math.random().toString(36).slice(2, 7);
          defs.push('<clipPath id="' + id + '"><path d="' + shapePath(item) + '"/></clipPath>');
          body.push('<image href="' + esc(item.href) + '" x="' + round(item.x) + '" y="' + round(item.y) +
            '" width="' + round(item.w) + '" height="' + round(item.h) +
            '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + id + ')"/>');
          break;
        }
        case 'qr':
          body.push('<path d="' + qrPathData(item.qr, item.x, item.y, item.moduleMm) +
            '" fill="' + item.fill + '" shape-rendering="crispEdges"/>');
          break;
        case 'text':
          body.push('<text x="' + round(item.x) + '" y="' + round(item.y) + '" font-family="' +
            esc(fontFamilyCss(item.fontFamily)) + '" font-size="' + round(item.sizePt) + '" font-weight="' +
            (item.weight || 400) + '" fill="' + item.fill + '" text-anchor="' + textAnchor(item.align) + '"' +
            (item.letterSpacingPt ? ' letter-spacing="' + round(item.letterSpacingPt) + '"' : '') +
            (item.baseline === 'middle' ? ' dominant-baseline="middle"' : '') + '>' +
            esc(item.text) + '</text>');
          break;
      }
    });

    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + round(widthMm * pxPerMm) +
      '" height="' + round(heightMm * pxPerMm) + '" viewBox="' + (-bleed) + ' ' + (-bleed) + ' ' +
      round(widthMm) + ' ' + round(heightMm) + '" shape-rendering="geometricPrecision">');
    out.push('<defs>' + defs.join('') + '</defs>');
    if (bleed) {
      // Bleed area: extend a white ground so a print shop can trim safely.
      out.push('<rect x="' + (-bleed) + '" y="' + (-bleed) + '" width="' + round(widthMm) +
        '" height="' + round(heightMm) + '" fill="#ffffff"/>');
    }
    out.push('<g clip-path="url(#' + clipId + ')">' + body.join('') + '</g>');
    out.push('</svg>');
    return out.join('\n');
  }

  function toDataURL(card, side, options) {
    var svg = toSVG(card, side, options);
    var b64 = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(svg)))
      : Buffer.from(svg, 'utf8').toString('base64');
    return 'data:image/svg+xml;base64,' + b64;
  }

  return {
    MM_TO_PT: MM_TO_PT,
    buildCard: buildCard,
    buildFront: buildFront,
    buildBack: buildBack,
    toSVG: toSVG,
    toDataURL: toDataURL,
    qrPathData: qrPathData,
    shapePath: shapePath,
    fitText: fitText,
    textWidthMm: textWidthMm,
    avgWidth: avgWidth,
    initials: initials,
    shortUrl: shortUrl,
    esc: esc
  };
});
