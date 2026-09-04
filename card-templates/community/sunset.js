/*!
 * "Sunset" — an example community template.
 *
 * This file is what a contribution looks like: one self-registering UMD file in
 * card-templates/community/, plus one line in this folder's index.json. No core
 * file changes, so a pull request adding a template cannot break anything else.
 *
 * Copy it, change the id and the colours, run `npm run build:templates`, and open
 * templates/ to see it in the gallery beside the built-in ones.
 *
 * Author: the QR Link Card project (example)
 * License: MIT, like everything else here
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;                                  // tests + the validator
  } else if (root.CardTemplates) {
    root.CardTemplates.register(api);                      // the browser
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return {
    id: 'community-sunset',
    name: 'Sunset',
    description: 'Warm dusk gradient, serif name, soft cream type. Good for photographers and studios.',
    author: 'QR Link Card project',
    license: 'MIT',
    free: true,
    layout: 'photo-left',

    front: {
      background: { type: 'gradient', from: '#2b1055', to: '#7597de', angle: 160 },
      accent: '#ffb26b',
      nameColor: '#fff8f0',
      roleColor: 'rgba(255,248,240,0.78)',
      taglineColor: 'rgba(255,248,240,0.55)',
      monogramBg: 'rgba(255,248,240,0.12)',
      monogramColor: '#fff8f0',
      photoShape: 'round',
      photoRing: 'rgba(255,178,107,0.9)',
      rules: 'rgba(255,248,240,0.18)',
      nameFont: 'serif',
      nameWeight: 700,
      nameSizePt: 17,
      roleSizePt: 9.5,
      taglineSizePt: 7.5,
      stripe: false,
      border: 'rgba(255,248,240,0.22)'
    },

    back: {
      background: { type: 'gradient', from: '#2b1055', to: '#4a2c7a', angle: 160 },
      accent: '#ffb26b',
      textColor: '#fff8f0',
      mutedColor: 'rgba(255,248,240,0.62)',
      // Must stay light: a QR needs contrast, and inverted codes fail on a large
      // fraction of phone cameras. CardTemplates.validateTemplate() enforces this.
      qrTile: '#fff8f0',
      captionSizePt: 8,
      hintSizePt: 6,
      border: 'rgba(255,248,240,0.22)',
      stripe: false
    }
  };
}));
