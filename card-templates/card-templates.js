/*!
 * card-templates.js — the template registry (§7.1, §14).
 *
 * Every template is pure data: colours, fonts and layout switches. lib/card.js
 * reads this registry and draws. Adding a template = adding one object here, no
 * rendering code required (see docs/CUSTOMIZATION.md).
 *
 * The open-source core ships all templates unlocked. §14 describes templates as
 * the paid tier of a *hosted* service; self-hosters get everything for free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardTemplates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Print geometry, shared by every template (Appendix C). */
  var GEOMETRY = {
    widthMm: 89,        // standard business card
    heightMm: 51,
    bleedMm: 3,         // extra on every edge for the print sheet
    marginMm: 4,        // safe margin for text (spec: 3mm minimum)
    qrSizeMm: 30,       // >= 20mm, comfortably scannable at print
    qrQuietMm: 2.5,     // white quiet zone around the QR, part of the tile
    photoSizeMm: 22,
    cornerRadiusMm: 2.5
  };

  var TEMPLATES = [
    {
      id: 'template-1',
      name: 'Midnight',
      description: 'Deep navy with a warm accent stripe. Photo left, type right.',
      free: true,
      layout: 'photo-left',
      front: {
        background: { type: 'gradient', from: '#141428', to: '#232345', angle: 135 },
        accent: '#f2b134',
        nameColor: '#ffffff',
        roleColor: 'rgba(255,255,255,0.74)',
        taglineColor: 'rgba(255,255,255,0.52)',
        monogramBg: 'rgba(255,255,255,0.10)',
        monogramColor: '#ffffff',
        photoShape: 'circle',
        photoRing: 'rgba(242,177,52,0.85)',
        rules: 'rgba(255,255,255,0.14)',
        nameFont: 'sans',
        nameWeight: 700,
        nameSizePt: 17,
        roleSizePt: 9.5,
        taglineSizePt: 7.5,
        stripe: true
      },
      back: {
        background: { type: 'gradient', from: '#141428', to: '#1d1d38', angle: 135 },
        accent: '#f2b134',
        textColor: '#ffffff',
        mutedColor: 'rgba(255,255,255,0.62)',
        qrTile: '#ffffff',
        captionSizePt: 8,
        hintSizePt: 6.5,
        stripe: true
      }
    },
    {
      id: 'template-2',
      name: 'Paper',
      description: 'Warm off-white, centred, ink-black type. Cheap to print, looks premium.',
      free: true,
      layout: 'centered',
      front: {
        background: { type: 'solid', color: '#fbfaf7' },
        accent: '#1a1a2e',
        nameColor: '#16161d',
        roleColor: '#5a5a68',
        taglineColor: '#8a8a96',
        monogramBg: '#eceadf',
        monogramColor: '#16161d',
        photoShape: 'circle',
        photoRing: '#e2dfd2',
        rules: '#ddd9cb',
        nameFont: 'serif',
        nameWeight: 700,
        nameSizePt: 19,
        roleSizePt: 9,
        taglineSizePt: 7.5,
        stripe: false,
        border: '#e6e2d6'
      },
      back: {
        background: { type: 'solid', color: '#fbfaf7' },
        accent: '#1a1a2e',
        textColor: '#16161d',
        mutedColor: '#6d6d7a',
        qrTile: '#ffffff',
        captionSizePt: 8,
        hintSizePt: 6.5,
        stripe: false,
        border: '#e6e2d6'
      }
    },
    {
      id: 'template-3',
      name: 'Signal',
      description: 'High-contrast black and white. Maximum legibility, no colour ink needed.',
      free: true,
      layout: 'photo-left',
      front: {
        background: { type: 'solid', color: '#ffffff' },
        accent: '#000000',
        nameColor: '#000000',
        roleColor: '#3d3d3d',
        taglineColor: '#6b6b6b',
        monogramBg: '#000000',
        monogramColor: '#ffffff',
        photoShape: 'rounded',
        photoRing: '#000000',
        rules: '#000000',
        nameFont: 'sans',
        nameWeight: 700,
        nameSizePt: 18,
        roleSizePt: 9.5,
        taglineSizePt: 7.5,
        stripe: false,
        block: true   // solid black panel behind the photo
      },
      back: {
        background: { type: 'solid', color: '#ffffff' },
        accent: '#000000',
        textColor: '#000000',
        mutedColor: '#4a4a4a',
        qrTile: '#ffffff',
        captionSizePt: 8,
        hintSizePt: 6.5,
        stripe: false
      }
    }
  ];

  var BY_ID = {};
  TEMPLATES.forEach(function (t) { BY_ID[t.id] = t; });

  function get(id) {
    return BY_ID[id] || BY_ID['template-1'];
  }

  function ids() { return TEMPLATES.map(function (t) { return t.id; }); }

  /**
   * Derive the on-screen CSS custom properties for a profile page from a
   * template, so the profile page and the printed card share one visual
   * identity (§20 principle 2: "Physical Equals Digital").
   */
  function toCssVars(template, profile) {
    var t = get(template && template.id);
    var settings = (profile && profile.card_settings) || {};
    var primary = settings.primary_color || null;
    var bg = t.front.background;
    return {
      '--bg': primary || (bg.type === 'solid' ? bg.color : bg.from),
      '--bg-2': bg.type === 'gradient' ? bg.to : (primary || bg.color),
      '--accent': settings.accent_color || t.front.accent,
      '--text': t.front.nameColor,
      '--muted': t.front.roleColor,
      '--faint': t.front.taglineColor,
      '--surface': bg.type === 'solid' && isLight(bg.color) ? '#ffffff' : 'rgba(255,255,255,0.07)',
      '--border': t.front.rules,
      '--radius': t.layout === 'centered' ? '18px' : '14px',
      '--font-name': t.front.nameFont === 'serif' ? SERIF : SANS
    };
  }

  var SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  var SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

  function isLight(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return false;
    var l = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
    return l > 0.6;
  }

  return {
    GEOMETRY: GEOMETRY,
    TEMPLATES: TEMPLATES,
    SANS: SANS,
    SERIF: SERIF,
    get: get,
    ids: ids,
    toCssVars: toCssVars,
    isLight: isLight
  };
});
