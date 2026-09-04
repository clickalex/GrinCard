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

  // ---------------------------------------------------------------------------
  // Community templates (§ drop-in contributions)
  //
  // A contributed template is ONE file in card-templates/community/ plus one line
  // in that folder's index.json. Nothing in this file changes, and no core file
  // is touched by a pull request — which is the difference between a project
  // people can contribute to and one they have to fork.
  //
  // Files are loaded at runtime because a static site cannot list a directory.
  // tools/build-templates.js validates every file against the schema below and
  // keeps index.json in sync; CI runs it in --check mode.
  // ---------------------------------------------------------------------------

  var COMMUNITY = [];
  var COMMUNITY_LOADED = null;   // the in-flight (or finished) load promise

  var LAYOUTS = ['photo-left', 'centered'];

  /** The fields every template must have, and the ones that must not be missing. */
  var REQUIRED_FRONT = ['background', 'accent', 'nameColor', 'roleColor', 'taglineColor',
    'monogramBg', 'monogramColor', 'nameFont', 'nameWeight', 'nameSizePt', 'roleSizePt',
    'taglineSizePt'];
  var REQUIRED_BACK = ['background', 'accent', 'textColor', 'mutedColor', 'qrTile',
    'captionSizePt', 'hintSizePt'];

  /**
   * Check a template object without throwing, so a bad contribution produces a
   * readable list rather than a blank card.
   * @returns {{ok: boolean, errors: string[], warnings: string[]}}
   */
  function validateTemplate(t) {
    var errors = [];
    var warnings = [];
    if (!t || typeof t !== 'object') return { ok: false, errors: ['not an object'], warnings: warnings };

    if (!t.id || !/^[a-z0-9][a-z0-9._-]*$/.test(t.id)) {
      errors.push('id must be lowercase letters, digits, dot, dash or underscore');
    } else if (BY_ID[t.id] && BY_ID[t.id] !== t) {
      errors.push('id "' + t.id + '" is already taken');
    }
    if (!t.name) errors.push('name is required (shown in the picker and the gallery)');
    if (LAYOUTS.indexOf(t.layout) < 0) {
      errors.push('layout must be one of: ' + LAYOUTS.join(', ') + ' (got ' + JSON.stringify(t.layout) + ')');
    }
    ['front', 'back'].forEach(function (side) {
      var block = t[side];
      if (!block || typeof block !== 'object') { errors.push(side + ' is required'); return; }
      var required = side === 'front' ? REQUIRED_FRONT : REQUIRED_BACK;
      required.forEach(function (key) {
        if (block[key] == null) errors.push(side + '.' + key + ' is required');
      });
      var bg = block.background;
      if (bg) {
        if (bg.type === 'solid' && !bg.color) errors.push(side + '.background.color is required for a solid');
        if (bg.type === 'gradient' && (!bg.from || !bg.to)) {
          errors.push(side + '.background needs from and to for a gradient');
        }
        if (['solid', 'gradient'].indexOf(bg.type) < 0) {
          errors.push(side + '.background.type must be "solid" or "gradient"');
        }
      }
    });

    // The one rule that is not about taste: a QR needs contrast, and inverted
    // codes fail on a large fraction of phone cameras. See docs/PRINTING.md.
    if (t.back && t.back.qrTile && isLight(t.back.qrTile) === false) {
      errors.push('back.qrTile must be a LIGHT colour — dark tiles make the QR unscannable ' +
        'on many phone cameras (got ' + t.back.qrTile + ')');
    }
    if (t.front && t.front.photoShape && ['circle', 'round'].indexOf(t.front.photoShape) < 0) {
      warnings.push('front.photoShape should be "circle" or "round"');
    }
    if (t.free === false) {
      warnings.push('free: false is recorded but nothing is gated on it — the core is free');
    }
    if (!t.author) warnings.push('author is optional but appreciated (shown in the gallery)');

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /**
   * Add a template at runtime. Returns the registered template, or null if it was
   * rejected — a bad contribution must never take the gallery down with it.
   */
  function register(t) {
    var check = validateTemplate(t);
    if (!check.ok) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('CardTemplates: rejected "' + (t && t.id) + '": ' + check.errors.join('; '));
      }
      return null;
    }
    if (BY_ID[t.id] === t) return t;   // already registered (idempotent)
    t.community = true;
    BY_ID[t.id] = t;
    COMMUNITY.push(t);
    return t;
  }

  /**
   * Load every template listed in `<baseUrl>/index.json`, then let each file
   * register itself. Resolves with the templates that were added; never rejects,
   * because a missing or broken community folder must not break a card.
   *
   * @param {string} baseUrl e.g. "../card-templates/community/"
   */
  function loadCommunity(baseUrl) {
    if (COMMUNITY_LOADED) return COMMUNITY_LOADED;
    if (typeof fetch !== 'function' || typeof document === 'undefined') {
      COMMUNITY_LOADED = Promise.resolve([]);
      return COMMUNITY_LOADED;
    }
    var before = COMMUNITY.length;
    COMMUNITY_LOADED = fetch(baseUrl + 'index.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (manifest) {
        var files = (manifest && manifest.templates) || [];
        // Load in order so a contributor's ordering choice is respected, and so
        // two files racing to register cannot produce a nondeterministic picker.
        return files.reduce(function (chain, entry) {
          var file = typeof entry === 'string' ? entry : entry.file;
          return chain.then(function () { return loadScript(baseUrl + file); });
        }, Promise.resolve());
      })
      .then(function () { return COMMUNITY.slice(before); });
    return COMMUNITY_LOADED;
  }

  /** Inject a <script> and resolve when it has run (or failed). */
  function loadScript(src) {
    return new Promise(function (resolve) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = function () { resolve(true); };
      el.onerror = function () {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('CardTemplates: could not load ' + src);
        }
        resolve(false);
      };
      document.head.appendChild(el);
    });
  }

  /** Reset community state — used by tests and by the gallery's reload button. */
  function resetCommunity() {
    COMMUNITY.forEach(function (t) { delete BY_ID[t.id]; });
    COMMUNITY = [];
    COMMUNITY_LOADED = null;
  }

  function get(id) {
    return BY_ID[id] || BY_ID['template-1'];
  }

  /** Every template, core first then community in load order. */
  function all() { return TEMPLATES.concat(COMMUNITY); }

  function ids() { return all().map(function (t) { return t.id; }); }

  /** Just the contributed ones. */
  function community() { return COMMUNITY.slice(); }

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
    LAYOUTS: LAYOUTS,
    SANS: SANS,
    SERIF: SERIF,
    get: get,
    all: all,
    ids: ids,
    community: community,
    register: register,
    validateTemplate: validateTemplate,
    loadCommunity: loadCommunity,
    resetCommunity: resetCommunity,
    toCssVars: toCssVars,
    isLight: isLight
  };
});
