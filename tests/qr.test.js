/**
 * Differential test: our hand-rolled QR encoder (lib/qr.js) must produce
 * byte-identical matrices to the well-established `qrcode` npm package.
 *
 * `qrcode` is a dev-only oracle — it is NOT a runtime dependency and is not
 * shipped to the browser. Run: npm test
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const ORACLE = require('./oracle.js');
const Ref = ORACLE.optional('qrcode');
const RefByteData = ORACLE.available ? require(ORACLE.oraclePath('qrcode/lib/core/byte-data')) : null;
const QR = require('../lib/qr.js');

/**
 * The reference encoder greedily splits input into numeric/alphanumeric/byte
 * segments, which encodes fewer bits than byte mode alone. lib/qr.js is a
 * byte-mode encoder (correct for URLs and UTF-8 text), so we hand the reference
 * a single pre-built byte segment to make the comparison exact.
 */
function refCreate(text, options) {
  return Ref.create([new RefByteData(Buffer.from(String(text), 'utf8'))], options);
}

const LEVELS = ['L', 'M', 'Q', 'H'];

/**
 * Build a string whose UTF-8 byte length is exactly n.
 *
 * IMPORTANT: 'a' is not in the QR alphanumeric character set, so the reference
 * encoder cannot optimise these payloads into alphanumeric/numeric segments —
 * it stays in byte mode, which is what lib/qr.js implements. Using a mixed
 * alphabet here would make the comparison meaningless (the reference would pick
 * a smaller version because it encodes fewer bits).
 */
function payload(n) {
  return 'a'.repeat(n);
}

/** Compare our matrix against the reference, module by module. */
function assertMatchesRef(text, ecl, mask, label) {
  const ours = QR.create(text, { ecl, mask });
  const ref = refCreate(text, {
    errorCorrectionLevel: ecl,
    maskPattern: mask == null ? undefined : mask,
    version: ours.version
  });
  assert.equal(ours.version, ref.version, `${label}: version mismatch`);
  assert.equal(ours.size, ref.modules.size, `${label}: size mismatch`);
  assert.equal(ours.mask, ref.maskPattern, `${label}: mask mismatch`);
  const refData = Buffer.from(ref.modules.data);
  const oursData = Buffer.from(ours.modules);
  assert.deepEqual(oursData, refData, `${label}: module matrix mismatch (v${ours.version}-${ecl})`);
}

test('GF(256) tables: alpha^255 == 1, log/exp are inverses', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const { EXP, LOG, gmul } = QR._internal;
  assert.equal(EXP[0], 1);
  assert.equal(EXP[255], 1, 'alpha^255 must wrap to 1');
  for (let i = 1; i < 256; i++) assert.equal(EXP[LOG[i]], i);
  assert.equal(gmul(0, 123), 0);
  assert.equal(gmul(1, 99), 99);
  assert.equal(gmul(0x53, 0xca), gmul(0xca, 0x53), 'multiplication is commutative');
  // known vector: alpha^1 * alpha^2 == alpha^3
  assert.equal(gmul(EXP[1], EXP[2]), EXP[3]);
});

test('Reed-Solomon matches the spec example (QR v1-M data codewords)', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  // ISO/IEC 18004 worked example: 16 data codewords -> 10 ECC codewords.
  const data = Uint8Array.from([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
  const ecc = QR._internal.rsEncode(data, 10);
  assert.deepEqual(
    Array.from(ecc),
    [196, 35, 39, 119, 235, 215, 231, 226, 93, 23],
    'RS(26,16) ECC codewords must match the ISO 18004 worked example'
  );
});

test('format information bits match published values', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const f = QR._internal.formatInfoBits;
  // Values cross-checked against the reference encoder's format-info table.
  const bin = (n) => n.toString(2).padStart(15, '0');
  assert.equal(bin(f('L', 0)), '111011111000100');
  assert.equal(bin(f('M', 5)), '100000011001110');
  assert.equal(bin(f('H', 0)), '001011010001001');
  assert.equal(bin(f('H', 7)), '000100000111011');
  assert.equal(bin(f('Q', 7)), '010101111101101');
  assert.equal(bin(f('L', 4)), '110011000101111');
});

test('version information bits match published values', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const v = QR._internal.versionInfoBits;
  const bin = (n) => n.toString(2).padStart(18, '0');
  assert.equal(bin(v(7)), '000111110010010100');
  assert.equal(bin(v(20)), '010100100110100110');
  assert.equal(bin(v(32)), '100000100111010101');
  assert.equal(bin(v(40)), '101000110001101001');
});

test('total codeword table agrees with the RS block table for all 160 combos', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  // capacity(data) + ecc must equal the table, and must be consistent across
  // versions: data codewords are identical for a given version regardless of the
  // geometry of the blocks.
  const { capacity, TOTAL_CODEWORDS, RS_BLOCKS, ECC_ORDER } = QR._internal;
  for (let version = 1; version <= 40; version++) {
    for (const ecl of ECC_ORDER) {
      const idx = ECC_ORDER.indexOf(ecl);
      const [eccPerBlock, g1, g2] = RS_BLOCKS[version - 1][idx];
      const cap = capacity(version, ecl);
      assert.ok(cap > 0, `v${version}-${ecl} capacity must be positive`);
      assert.equal(cap + eccPerBlock * (g1 + g2), TOTAL_CODEWORDS[version - 1],
        `v${version}-${ecl}: data + ecc must equal total codewords`);
    }
    // higher ECC always means less payload
    assert.ok(capacity(version, 'L') > capacity(version, 'M'));
    assert.ok(capacity(version, 'M') > capacity(version, 'Q'));
    assert.ok(capacity(version, 'Q') > capacity(version, 'H'));
  }
  // spot-check a few documented capacities (data codewords)
  assert.equal(capacity(1, 'M'), 16);
  assert.equal(capacity(4, 'M'), 64);
  assert.equal(capacity(10, 'H'), 122); // 224 total - 102 ECC
});

test('version selection matches the reference for a wide range of lengths', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  for (const ecl of LEVELS) {
    for (let n = 1; n <= 400; n += 7) {
      const text = payload(n);
      const ours = QR.create(text, { ecl });
      const ref = refCreate(text, { errorCorrectionLevel: ecl });
      assert.equal(ours.version, ref.version, `length ${n} @ ${ecl}: version`);
    }
  }
});

test('matrices are byte-identical to the reference (single block, v1-v4)', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const cases = [
    ['https://qrlinkcard.example/c/rahul123', 'M'],  // realistic card URL
    ['https://example.com/c/rahul123?t=temp_abc123', 'Q'], // with a temp token
    ['a', 'L'],
    [payload(59), 'M'],   // v4-M boundary-ish
    [payload(7), 'H'],    // v1-H
  ];
  for (const [text, ecl] of cases) {
    assertMatchesRef(text, ecl, undefined, `auto/${ecl}`);
    for (let mask = 0; mask < 8; mask++) assertMatchesRef(text, ecl, mask, `mask${mask}/${ecl}`);
  }
});

test('matrices are byte-identical to the reference (multi-block + v7 version info)', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const cases = [
    [payload(84), 'M'],    // v5-M: two blocks
    [payload(120), 'Q'],   // multi-block Q
    [payload(213), 'M'],   // v10-M: four blocks
    [payload(250), 'M'],   // v11-M: four blocks, 16-bit char count
    [payload(280), 'Q'],   // large, many blocks
  ];
  for (const [text, ecl] of cases) {
    assertMatchesRef(text, ecl, undefined, `auto/${ecl}`);
    for (let mask = 0; mask < 8; mask += 3) assertMatchesRef(text, ecl, mask, `mask${mask}/${ecl}`);
  }
});

test('version-7+ alignment and version-info blocks match the reference', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  // v7 needs the 18-bit version information blocks and 6x6 alignment grid.
  const text = payload(QR._internal.capacity(7, 'L') - 3);
  const ours = QR.create(text, { ecl: 'L' });
  assert.equal(ours.version, 7, 'expected version 7');
  assertMatchesRef(text, 'L', undefined, 'v7/auto');
  const text8 = payload(QR._internal.capacity(8, 'H') - 2);
  assert.equal(QR.create(text8, { ecl: 'H' }).version, 8);
  assertMatchesRef(text8, 'H', undefined, 'v8-H/auto');
});

test('UTF-8 content (non-Latin1) matches the reference', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const cases = ['नमस्ते rahul', 'café — ₹100', '你好 🌍'];
  // (these all stay in byte mode in the reference too)
  for (const text of cases) {
    assertMatchesRef(text, 'M', undefined, 'utf8');
  }
});

test('throws a clear error when content is too long', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const huge = payload(3000);
  assert.throws(() => QR.create(huge, { ecl: 'H' }), /too long/);
});

test('toSVG produces valid, self-contained markup with a quiet zone', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const url = 'https://example.com/c/rahul123';   // 30 bytes -> version 3 -> 29 modules
  const svg = QR.toSVG(url, { margin: 4, width: 200 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /viewBox="0 0 37 37"/);        // 29 + 2*4 quiet zone
  assert.match(svg, /<rect width="37" height="37" fill="#ffffff"\/>/);
  assert.match(svg, /<path d="M4 4h1v1h-1z/);      // modules start after the quiet zone
  assert.ok(!/xmlns:xlink|href="http|@import/.test(svg), 'SVG must be fully self-contained');
  assert.ok(QR.toDataURL(url).startsWith('data:image/svg+xml;base64,'));
  assert.ok(QR.toASCII(url, { margin: 0 }).split('\n').length === 29);
});

test('quiet zone size is reflected in the viewBox', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const qr = QR.create('x', { ecl: 'L' });          // version 1 -> 21 modules
  assert.equal(qr.size, 21);
  const svg0 = QR.toSVG(qr, { margin: 0 });
  const svg4 = QR.toSVG(qr, { margin: 4 });
  assert.match(svg0, /viewBox="0 0 21 21"/);
  assert.match(svg4, /viewBox="0 0 29 29"/);
});
