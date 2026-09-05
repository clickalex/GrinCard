/*!
 * qr.js — a tiny, dependency-free QR Code encoder (byte mode).
 *
 * Part of "QR Link Card" (open-qr-link-card). MIT licensed.
 *
 * Why hand-rolled instead of a CDN library?
 *   The whole point of this project is a self-hostable, zero-build,
 *   offline-capable card generator. A CDN dependency would break it on
 *   GitHub Pages behind strict CSP, on an intranet, or on a plane.
 *   This file has no dependencies and works in a browser AND in Node.
 *
 * Implements: ISO/IEC 18004 QR Model 2, versions 1..40, ECC levels L/M/Q/H,
 * byte-mode encoding, Reed-Solomon over GF(256), all 8 data masks with the
 * four-rule penalty evaluation, format + version information.
 *
 * Usage:
 *   const qr = QRCode.create('https://example.com/c/rahul123', { ecl: 'M' });
 *   qr.size          // -> 25 (modules per side)
 *   qr.modules       // -> Uint8Array(size*size), 1 = dark
 *   QRCode.toSVG(...) // -> "<svg ...>...</svg>"
 *   QRCode.toDataURL(...) // -> "data:image/svg+xml;base64,..." (browser+node)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QRCode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // GF(256) arithmetic — primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1)
  // ---------------------------------------------------------------------------
  var EXP = new Uint8Array(512); // anti-log, doubled so a+b needs no modulo
  var LOG = new Uint8Array(256);
  (function buildTables() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
  }

  /** Generator polynomial of degree `n` as coefficients, highest power first. */
  function rsGeneratorPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      // multiply poly by (x - alpha^i)  ==  (x + alpha^i) in GF(256)
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** Reed-Solomon error-correction codewords for `data`. */
  function rsEncode(data, eccLen) {
    var gen = rsGeneratorPoly(eccLen);
    var res = new Uint8Array(eccLen);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.copyWithin(0, 1);
      res[eccLen - 1] = 0;
      if (factor !== 0) {
        for (var j = 0; j < eccLen; j++) res[j] ^= gmul(gen[j + 1], factor);
      }
    }
    return res;
  }

  // ---------------------------------------------------------------------------
  // Spec tables (ISO/IEC 18004)
  // ---------------------------------------------------------------------------
  var ECC_LEVELS = { L: 1, M: 0, Q: 3, H: 2 }; // values are the format-info bits
  var ECC_ORDER = ['L', 'M', 'Q', 'H'];

  // [version-1][ecl] = [ eccCodewordsPerBlock, numBlocksGroup1, numBlocksGroup2 ]
  var RS_BLOCKS = [
    [[7,1,0],[10,1,0],[13,1,0],[17,1,0]],      // v1
    [[10,1,0],[16,1,0],[22,1,0],[28,1,0]],     // v2
    [[15,1,0],[26,1,0],[18,2,0],[22,2,0]],     // v3
    [[20,1,0],[18,2,0],[26,2,0],[16,4,0]],     // v4
    [[26,1,0],[24,2,0],[18,2,2],[22,2,2]],     // v5
    [[18,2,0],[16,4,0],[24,4,0],[28,4,0]],     // v6
    [[20,2,0],[18,4,0],[18,2,4],[26,4,1]],     // v7
    [[24,2,0],[22,2,2],[22,4,2],[26,4,2]],     // v8
    [[30,2,0],[22,3,2],[20,4,4],[24,4,4]],     // v9
    [[18,2,2],[26,4,1],[24,6,2],[28,6,2]],     // v10
    [[20,4,0],[30,1,4],[28,4,4],[24,3,8]],     // v11
    [[24,2,2],[22,6,2],[26,4,6],[28,7,4]],     // v12
    [[26,4,0],[22,8,1],[24,8,4],[22,12,4]],    // v13
    [[30,3,1],[24,4,5],[20,11,5],[24,11,5]],   // v14
    [[22,5,1],[24,5,5],[30,5,7],[24,11,7]],    // v15
    [[24,5,1],[28,7,3],[24,15,2],[30,3,13]],   // v16
    [[28,1,5],[28,10,1],[28,1,15],[28,2,17]],  // v17
    [[30,5,1],[26,9,4],[28,17,1],[28,2,19]],   // v18
    [[28,3,4],[26,3,11],[26,17,4],[26,9,16]],  // v19
    [[28,3,5],[26,3,13],[30,15,5],[28,15,10]], // v20
    [[28,4,4],[26,17,0],[28,17,6],[30,19,6]],  // v21
    [[28,2,7],[28,17,0],[30,7,16],[24,34,0]],  // v22
    [[30,4,5],[28,4,14],[30,11,14],[30,16,14]],// v23
    [[30,6,4],[28,6,14],[30,11,16],[30,30,2]], // v24
    [[26,8,4],[28,8,13],[30,7,22],[30,22,13]], // v25
    [[28,10,2],[28,19,4],[28,28,6],[30,33,4]], // v26
    [[30,8,4],[28,22,3],[30,8,26],[30,12,28]], // v27
    [[30,3,10],[28,3,23],[30,4,31],[30,11,31]],// v28
    [[30,7,7],[28,21,7],[30,1,37],[30,19,26]], // v29
    [[30,5,10],[28,19,10],[30,15,25],[30,23,25]],// v30
    [[30,13,3],[28,2,29],[30,42,1],[30,23,28]],// v31
    [[30,17,0],[28,10,23],[30,10,35],[30,19,35]],// v32
    [[30,17,1],[28,14,21],[30,29,19],[30,11,46]],// v33
    [[30,13,6],[28,14,23],[30,44,7],[30,59,1]],// v34
    [[30,12,7],[28,12,26],[30,39,14],[30,22,41]],// v35
    [[30,6,14],[28,6,34],[30,46,10],[30,2,64]],// v36
    [[30,17,4],[28,29,14],[30,49,10],[30,24,46]],// v37
    [[30,4,18],[28,13,32],[30,48,14],[30,42,32]],// v38
    [[30,20,4],[28,40,7],[30,43,22],[30,10,67]],// v39
    [[30,19,6],[28,18,31],[30,34,34],[30,20,61]] // v40
  ];

  // Alignment-pattern centre coordinates per version (index = version - 1).
  var ALIGNMENT_POSITIONS = [
    [], [6,18], [6,22], [6,26], [6,30], [6,34],
    [6,22,38], [6,24,42], [6,26,46], [6,28,50], [6,30,54], [6,32,58], [6,34,62],
    [6,26,46,66], [6,26,48,70], [6,26,50,74], [6,30,54,78], [6,30,56,82],
    [6,30,58,86], [6,34,62,90],
    [6,28,50,72,94], [6,26,50,74,98], [6,30,54,78,102], [6,28,54,80,106],
    [6,32,58,84,110], [6,30,58,86,114], [6,34,62,90,118],
    [6,26,50,74,98,122], [6,30,54,78,102,126], [6,26,52,78,104,130],
    [6,30,56,82,108,134], [6,34,60,86,112,138], [6,30,58,86,114,142],
    [6,24,50,76,102,128], [6,28,54,80,106,132], [6,32,58,84,110,136],
    [6,26,54,82,110,138], [6,30,58,86,114,142]
  ];

  var FORMAT_MASK = 0x5412;
  var VERSION_POLY = 0x1f25;
  var FORMAT_POLY = 0x537;

  function formatInfoBits(ecl, mask) {
    var data = (ECC_LEVELS[ecl] << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * FORMAT_POLY);
    return ((data << 10) | rem) ^ FORMAT_MASK;
  }

  function versionInfoBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * VERSION_POLY);
    return (version << 12) | rem;
  }

  // ---------------------------------------------------------------------------
  // Encoding
  // ---------------------------------------------------------------------------
  function toBytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    // Node < 11 / exotic browsers
    var out = unescape(encodeURIComponent(text));
    var b = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 0xff;
    return b;
  }

  /**
   * Total codewords per version (data + ECC). Deriving this from the geometry of
   * the function patterns is easy to get subtly wrong, so we use the canonical
   * spec table. tests/qr.test.js proves it agrees with the RS block table for
   * every version/ECC combination: (total - eccPerBlock*blocks) must equal the
   * spec's data-codeword count, and a reference encoder must produce byte
   * identical matrices.
   */
  var TOTAL_CODEWORDS = (function () {
    // Total codewords per version = (data codewords + ecc codewords), from the spec.
    var t = [
      26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,
      1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,
      3196,3362,3532,3706
    ];
    return t;
  })();

  function capacity(version, ecl) {
    var idx = ECC_ORDER.indexOf(ecl);
    var row = RS_BLOCKS[version - 1][idx];
    var eccPerBlock = row[0], g1 = row[1], g2 = row[2];
    var totalBlocks = g1 + g2;
    var totalCw = TOTAL_CODEWORDS[version - 1];
    return totalCw - eccPerBlock * totalBlocks; // data codewords
  }

  function chooseVersion(byteLen, ecl, minVersion) {
    for (var v = Math.max(1, minVersion || 1); v <= 40; v++) {
      // header: 4-bit mode + char count bits, then payload
      var ccBits = charCountBits(v);
      var bitsNeeded = 4 + ccBits + byteLen * 8;
      if (bitsNeeded <= capacity(v, ecl) * 8) return v;
    }
    return -1; // too long
  }

  function charCountBits(version) {
    if (version <= 9) return 8;
    if (version <= 26) return 16;
    return 16;
  }

  function encodeData(bytes, version, ecl) {
    var cap = capacity(version, ecl);
    var bits = [];
    function push(value, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }
    push(4, 4);                       // mode indicator: byte mode = 0100
    push(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var capacityBits = cap * 8;
    // terminator
    var term = Math.min(4, capacityBits - bits.length);
    for (var t = 0; t < term; t++) bits.push(0);
    // pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);
    // alternating pad codewords
    var pads = [0xec, 0x11], p = 0;
    while (bits.length < capacityBits) { push(pads[p++ % 2], 8); }

    var data = new Uint8Array(cap);
    for (var b = 0; b < cap; b++) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b * 8 + k];
      data[b] = byte;
    }
    return data;
  }

  function interleave(data, version, ecl) {
    var idx = ECC_ORDER.indexOf(ecl);
    var row = RS_BLOCKS[version - 1][idx];
    var eccPerBlock = row[0], g1 = row[1], g2 = row[2];
    var shortLen = Math.floor(data.length / (g1 + g2));
    var blocks = [], eccs = [];
    var offset = 0;
    for (var i = 0; i < g1 + g2; i++) {
      var len = i < g1 ? shortLen : shortLen + 1;
      var block = data.subarray(offset, offset + len);
      offset += len;
      blocks.push(block);
      eccs.push(rsEncode(block, eccPerBlock));
    }
    var out = [];
    var maxData = shortLen + (g2 > 0 ? 1 : 0);
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].length) out.push(blocks[bi][c]);
      }
    }
    for (var e = 0; e < eccPerBlock; e++) {
      for (var bj = 0; bj < eccs.length; bj++) out.push(eccs[bj][e]);
    }
    return new Uint8Array(out);
  }

  // ---------------------------------------------------------------------------
  // Matrix construction
  // ---------------------------------------------------------------------------
  function Matrix(size) {
    this.size = size;
    this.modules = new Uint8Array(size * size);      // 1 = dark
    this.isFunction = new Uint8Array(size * size);   // 1 = reserved (never masked)
  }
  Matrix.prototype.set = function (r, c, dark, isFunc) {
    this.modules[r * this.size + c] = dark ? 1 : 0;
    if (isFunc) this.isFunction[r * this.size + c] = 1;
  };
  Matrix.prototype.get = function (r, c) { return this.modules[r * this.size + c]; };
  Matrix.prototype.isFunc = function (r, c) { return this.isFunction[r * this.size + c] === 1; };

  function getBit(value, index) { return ((value >>> index) & 1) === 1; }

  /** Finder pattern (7x7 ring + 3x3 core) plus its 1-module light separator. */
  function drawFinder(m, row, col) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = row + r, cc = col + c;
        if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
        var dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m.set(rr, cc, dark, true);
      }
    }
  }

  /** 5x5 alignment pattern centred on (row, col). */
  function drawAlignment(m, row, col) {
    for (var r = -2; r <= 2; r++) {
      for (var c = -2; c <= 2; c++) {
        var dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        m.set(row + r, col + c, dark, true);
      }
    }
  }

  function drawTimingPatterns(m) {
    // Alternating modules along row 6 / column 6, between the finder separators.
    for (var i = 8; i < m.size - 8; i++) {
      var dark = i % 2 === 0;
      m.set(i, 6, dark, true);
      m.set(6, i, dark, true);
    }
  }

  function drawAlignmentPatterns(m, version) {
    var pos = ALIGNMENT_POSITIONS[version - 1];
    var last = m.size - 7;
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        // The three combinations that land on a finder pattern are not drawn.
        if ((pos[i] === 6 && pos[j] === 6) ||
            (pos[i] === 6 && pos[j] === last) ||
            (pos[i] === last && pos[j] === 6)) continue;
        drawAlignment(m, pos[i], pos[j]);
      }
    }
  }

  /**
   * Format information: 15 BCH bits stored twice so a damaged corner is still
   * readable. Bit 0 is the least significant.
   */
  function drawFormatInfo(m, ecl, mask) {
    var size = m.size;
    var bits = formatInfoBits(ecl, mask);
    for (var i = 0; i < 15; i++) {
      var dark = getBit(bits, i);
      // copy 1 — vertical strip left of the top-right finder, then row 8
      if (i < 6) m.set(i, 8, dark, true);
      else if (i < 8) m.set(i + 1, 8, dark, true);
      else m.set(size - 15 + i, 8, dark, true);
      // copy 2 — row 8 right side, then the horizontal strip under the
      // bottom-left finder (skipping column 6, the timing pattern)
      if (i < 8) m.set(8, size - i - 1, dark, true);
      else if (i < 9) m.set(8, 15 - i, dark, true);
      else m.set(8, 14 - i, dark, true);
    }
    m.set(size - 8, 8, true, true); // the single always-dark module
  }

  /** Version information (versions 7+): two 3x6 blocks near two corners. */
  function drawVersionInfo(m, version) {
    var size = m.size;
    var bits = versionInfoBits(version);
    for (var i = 0; i < 18; i++) {
      var dark = getBit(bits, i);
      var r = Math.floor(i / 3);
      var c = (i % 3) + size - 11;
      m.set(r, c, dark, true);
      m.set(c, r, dark, true);
    }
  }

  /** All non-data modules. Must run before data placement and masking. */
  function drawFunctionPatterns(m, version, ecl) {
    drawFinder(m, 0, 0);
    drawFinder(m, 0, m.size - 7);
    drawFinder(m, m.size - 7, 0);
    drawTimingPatterns(m);
    drawAlignmentPatterns(m, version);
    drawFormatInfo(m, ecl, 0); // placeholder: reserves the area from masking
    if (version >= 7) drawVersionInfo(m, version);
  }

  /**
   * Place the interleaved codewords in the two-module-wide zig-zag that sweeps
   * right to left. Column 6 (the vertical timing pattern) is stepped over.
   * Remaining modules become 0 ("remainder bits").
   */
  function placeData(m, codewords) {
    var size = m.size;
    var row = size - 1;
    var inc = -1;              // start travelling upwards
    var byteIndex = 0;
    var bitIndex = 7;
    var placed = 0;

    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (m.isFunc(row, cc)) continue;
          var dark = false;
          if (byteIndex < codewords.length) {
            dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
            placed++;
          }
          m.set(row, cc, dark, false);
          bitIndex--;
          if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
    return placed;
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r, c) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  /** XOR a mask over the encoding region only. Reserved modules are untouched. */
  function applyMask(m, mask) {
    var fn = MASKS[mask];
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (m.isFunc(r, c)) continue;
        if (fn(r, c)) m.modules[r * m.size + c] ^= 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mask penalty evaluation (ISO/IEC 18004 rules N1..N4)
  // ---------------------------------------------------------------------------

  /** N1: runs of five or more same-colour modules in a row or column. */
  function penaltyN1(m) {
    var size = m.size, points = 0;
    for (var index = 0; index < size; index++) {
      var runCol = 0, runRow = 0, lastCol = null, lastRow = null;
      for (var i = 0; i < size; i++) {
        var mod = m.get(index, i);          // along the row
        if (mod === lastCol) runCol++;
        else { if (runCol >= 5) points += 3 + (runCol - 5); lastCol = mod; runCol = 1; }
        mod = m.get(i, index);              // along the column
        if (mod === lastRow) runRow++;
        else { if (runRow >= 5) points += 3 + (runRow - 5); lastRow = mod; runRow = 1; }
      }
      if (runCol >= 5) points += 3 + (runCol - 5);
      if (runRow >= 5) points += 3 + (runRow - 5);
    }
    return points;
  }

  /** N2: every 2x2 block of a single colour. */
  function penaltyN2(m) {
    var size = m.size, blocks = 0;
    for (var r = 0; r < size - 1; r++) {
      for (var c = 0; c < size - 1; c++) {
        var sum = m.get(r, c) + m.get(r, c + 1) + m.get(r + 1, c) + m.get(r + 1, c + 1);
        if (sum === 0 || sum === 4) blocks++;
      }
    }
    return blocks * 3;
  }

  /**
   * N3: the 1:1:3:1:1 finder-like pattern with four light modules on one side.
   * Sliding an 11-bit window, the two offending patterns are 0x5D0 and 0x05D.
   */
  function penaltyN3(m) {
    var size = m.size, hits = 0;
    for (var index = 0; index < size; index++) {
      var rowBits = 0, colBits = 0;
      for (var i = 0; i < size; i++) {
        rowBits = ((rowBits << 1) & 0x7ff) | m.get(index, i);
        if (i >= 10 && (rowBits === 0x5d0 || rowBits === 0x05d)) hits++;
        colBits = ((colBits << 1) & 0x7ff) | m.get(i, index);
        if (i >= 10 && (colBits === 0x5d0 || colBits === 0x05d)) hits++;
      }
    }
    return hits * 40;
  }

  /** N4: deviation of the dark-module ratio from 50%. */
  function penaltyN4(m) {
    var dark = 0;
    for (var i = 0; i < m.modules.length; i++) dark += m.modules[i];
    var k = Math.abs(Math.ceil((dark * 100 / m.modules.length) / 5) - 10);
    return k * 10;
  }

  function penaltyScore(m) {
    return penaltyN1(m) + penaltyN2(m) + penaltyN3(m) + penaltyN4(m);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function create(text, options) {
    options = options || {};
    var ecl = (options.ecl || 'M').toUpperCase();
    if (!ECC_LEVELS.hasOwnProperty(ecl)) ecl = 'M';
    var bytes = typeof text === 'string' ? toBytes(text) : text;
    var forcedVersion = options.version || 0;
    var version = forcedVersion || chooseVersion(bytes.length, ecl, options.minVersion || 1);
    if (version < 0) {
      throw new Error('QRCode: content too long to encode (' + bytes.length + ' bytes at ECC ' + ecl + ')');
    }
    // If a version was forced, verify it fits.
    if (forcedVersion && (4 + charCountBits(version) + bytes.length * 8) > capacity(version, ecl) * 8) {
      throw new Error('QRCode: content does not fit forced version ' + version);
    }

    var data = encodeData(bytes, version, ecl);
    var codewords = interleave(data, version, ecl);

    var size = version * 4 + 17;
    var m = new Matrix(size);
    drawFunctionPatterns(m, version, ecl);
    var placed = placeData(m, codewords);
    if (placed !== codewords.length * 8) {
      throw new Error('QRCode: internal error — placed ' + placed + ' of ' +
        (codewords.length * 8) + ' bits (v' + version + ')');
    }

    // Try every mask and keep the one with the lowest penalty score, exactly as
    // the spec requires. The matrix is built once; for each candidate we write
    // its format information, apply the mask, score it, then undo the mask.
    // (The format modules count towards the penalty, so they must be rewritten
    // for every candidate — scoring against a stale format word picks the wrong
    // mask and produces a symbol that scanners still read but that is not the
    // optimal one.)
    var bestMask = -1, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      if (typeof options.mask === 'number' && mask !== options.mask) continue;
      drawFormatInfo(m, ecl, mask);
      applyMask(m, mask);
      var score = penaltyScore(m);
      applyMask(m, mask); // XOR is its own inverse
      if (score < bestScore) { bestScore = score; bestMask = mask; }
    }

    applyMask(m, bestMask);
    drawFormatInfo(m, ecl, bestMask); // leave the winning format word in place

    return {
      version: version,
      ecl: ecl,
      mask: bestMask,
      size: size,
      modules: m.modules,
      penalty: bestScore,
      get: function (r, c) { return m.modules[r * size + c] === 1; },
      matrix: m
    };
  }

  /** Render a QR as an SVG string. Vector output => infinitely scalable for print. */
  function toSVG(text, options) {
    options = options || {};
    var qr = typeof text === 'object' && text.modules ? text : create(text, options);
    var quiet = options.margin == null ? 4 : options.margin;
    var dim = qr.size + quiet * 2;
    var px = options.width || dim * 4; // css px for on-screen rendering
    var dark = options.colorDark || '#111111';
    var light = options.colorLight || '#ffffff';
    var scale = px / dim;

    var d = '';
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r * qr.size + c]) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    var title = options.title ? '<title>' + escapeXml(options.title) + '</title>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges" role="img">' +
      title +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path d="' + d + '" fill="' + dark + '"/></svg>';
  }

  function toDataURL(text, options) {
    var svg = toSVG(text, options);
    var b64 = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(svg)))
      : Buffer.from(svg, 'utf8').toString('base64');
    return 'data:image/svg+xml;base64,' + b64;
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (ch) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch];
    });
  }

  /** ASCII art, handy for terminals and tests. */
  function toASCII(text, options) {
    var qr = typeof text === 'object' && text.modules ? text : create(text, options);
    var quiet = options && options.margin == null ? 2 : (options && options.margin) || 0;
    var lines = [];
    for (var r = -quiet; r < qr.size + quiet; r++) {
      var line = '';
      for (var c = -quiet; c < qr.size + quiet; c++) {
        var dark = r >= 0 && c >= 0 && r < qr.size && c < qr.size && qr.modules[r * qr.size + c];
        line += dark ? '##' : '  ';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  return {
    create: create,
    toSVG: toSVG,
    toDataURL: toDataURL,
    toASCII: toASCII,
    escapeXml: escapeXml,
    // internals exposed for tests and for the Python port
    _internal: {
      EXP: EXP, LOG: LOG, gmul: gmul, rsGeneratorPoly: rsGeneratorPoly, rsEncode: rsEncode,
      capacity: capacity, chooseVersion: chooseVersion, encodeData: encodeData,
      interleave: interleave, formatInfoBits: formatInfoBits, versionInfoBits: versionInfoBits,
      MASKS: MASKS, ECC_LEVELS: ECC_LEVELS, ECC_ORDER: ECC_ORDER,
      penaltyN1: penaltyN1, penaltyN2: penaltyN2, penaltyN3: penaltyN3,
      penaltyN4: penaltyN4, penaltyScore: penaltyScore, applyMask: applyMask,
      placeData: placeData, drawFunctionPatterns: drawFunctionPatterns,
      drawFormatInfo: drawFormatInfo, Matrix: Matrix,
      RS_BLOCKS: RS_BLOCKS, ALIGNMENT_POSITIONS: ALIGNMENT_POSITIONS,
      TOTAL_CODEWORDS: TOTAL_CODEWORDS, charCountBits: charCountBits, toBytes: toBytes
    }
  };
});
