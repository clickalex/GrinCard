/**
 * Card renderer + PDF writer tests.
 *
 * The PDF is parsed with pdfjs-dist (Mozilla's reader) and the QR inside it is
 * reconstructed from the vector rectangles and decoded with jsQR — an
 * independent decoder, not our own encoder. That proves the printed card
 * actually scans, not just that our code agrees with itself.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');

const QR = require('../lib/qr.js');
const Card = require('../lib/card.js');
const Pdf = require('../lib/pdf.js');
const TPL = require('../card-templates/card-templates.js');
const Store = require('../lib/store.js');
const ORACLE = require('./oracle.js');
const jsQRModule = ORACLE.optional('jsqr');
const jsQR = jsQRModule ? (jsQRModule.default || jsQRModule) : null;

/**
 * Rasterise a module matrix at `scale` px per module with a 4-module quiet zone,
 * i.e. what a camera would see. jsQR needs several pixels per module to find the
 * finder patterns, so we never test at 1 px/module.
 */
function rasterise(modules, size, scale) {
  scale = scale || 8;
  const quiet = 4;
  const dim = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < size && my < size && modules[my * size + mx];
      const v = dark ? 0 : 255;
      const i = (y * dim + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, dim };
}

const PROFILE_URL = 'https://qrlinkcard.example/c/rahul123';

const PROFILE = {
  username: 'rahul123',
  display_name: 'Rahul Kumar',
  designation: 'Freelance Illustrator',
  tagline: 'Brands, packaging and the occasional mural',
  photo_url: null,
  card_settings: { template_id: 'template-1', primary_color: '#1a1a2e', show_photo: true },
  links: [
    { id: 'lnk_1', label: 'Instagram', url: 'https://instagram.com/rahul_art', visibility: 'public', order: 1 },
    { id: 'lnk_2', label: 'Portfolio', url: 'https://behance.net/rahulkumar', visibility: 'public', order: 2 },
    { id: 'lnk_3', label: 'Pricing List', url: 'https://docs.example.com/pricing', visibility: 'followers_only', order: 3 },
    { id: 'lnk_4', label: 'WhatsApp', url: 'https://wa.me/911234567890', visibility: 'followers_only', order: 4 }
  ]
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build a real 8-bit PNG in memory (no encoder dependency needed). */
function makePng(width, height, rgbFn, colorType) {
  colorType = colorType == null ? 2 : colorType;
  const channels = colorType === 2 ? 3 : 1;
  const raw = Buffer.alloc(height * (1 + width * channels));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const c = rgbFn(x, y);
      for (let k = 0; k < channels; k++) raw[p++] = c[k];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;            // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 8-bit RGBA PNG (color type 6). */
function makePngWithAlpha(width, height, rgbaFn) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const c = rgbaFn(x, y);
      for (let k = 0; k < 4; k++) raw[p++] = c[k];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 4-entry palette PNG with per-index transparency. */
function makePalettedPng(width, height) {
  const raw = Buffer.alloc(height * (1 + width));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) raw[p++] = (x + y) % 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 250, 250, 250]);
  const trns = Buffer.from([255, 128, 0, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

function pngDataUrl(width, height, rgbFn, colorType) {
  return 'data:image/png;base64,' + makePng(width, height, rgbFn, colorType).toString('base64');
}

const PDFJS_DIR = ORACLE.oraclePath('pdfjs-dist/') || '';

async function loadPdf(bytes) {
  const pdfjs = await import(PDFJS_DIR + 'legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'legacy/build/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: PDFJS_DIR + 'standard_fonts/',
    verbosity: 0
  }).promise;
  return { pdfjs, doc };
}

/**
 * Read a page's content stream straight out of the PDF bytes. Our streams are
 * uncompressed on purpose: the file stays human-auditable, and these tests can
 * verify the actual operators a PDF reader will execute (pdf.js v6 hands back
 * opaque Path2D objects, which are useless for assertions).
 */
function pageContent(bytes, pageNum) {
  const raw = Buffer.from(bytes).toString('latin1');
  const pageObj = raw.match(new RegExp(
    '\\n(\\d+) 0 obj\\n<< /Type /Page [\\s\\S]*?/Contents (\\d+) 0 R >>\\nendobj'));
  const pages = [...raw.matchAll(/(\d+) 0 obj\n<< \/Type \/Page [\s\S]*?\/Contents (\d+) 0 R >>\nendobj/g)];
  assert.ok(pages.length >= pageNum, `expected at least ${pageNum} page objects, found ${pages.length}`);
  const contentNum = pages[pageNum - 1][2];
  const m = raw.match(new RegExp('\\n' + contentNum + ' 0 obj\\n<< /Length \\d+ >>\\nstream\\n([\\s\\S]*?)\\nendstream'));
  assert.ok(m, `content stream for object ${contentNum} not found`);
  return Buffer.from(m[1], 'latin1');
}

/** Every `x y w h re` rectangle in a content stream, in points. */
function rectsIn(content) {
  const rects = [];
  const re = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    rects.push({ x: +m[1], yBottom: +m[2], w: +m[3], h: +m[4] });
  }
  return rects;
}

/**
 * Rebuild the QR module grid from the PDF's rectangle operators.
 * lib/pdf.js writes one `re f` per horizontal run of dark modules.
 */
function qrFromContent(bytes, pageNum, qr) {
  const content = pageContent(bytes, pageNum).toString('latin1');
  const modulePt = (TPL.GEOMETRY.qrSizeMm / qr.size) * Pdf.PT_PER_MM;
  const runs = rectsIn(content).filter(r =>
    Math.abs(Math.abs(r.h) - modulePt) < 0.01 &&
    Math.abs(r.w / modulePt - Math.round(r.w / modulePt)) < 0.01);
  assert.ok(runs.length > 20, `expected QR run rectangles, found ${runs.length}`);

  const minX = Math.min(...runs.map(r => r.x));
  const maxY = Math.max(...runs.map(r => r.yBottom + r.h));
  const grid = new Uint8Array(qr.size * qr.size);
  let placed = 0;
  for (const r of runs) {
    const col0 = Math.round((r.x - minX) / modulePt);
    const row = Math.round((maxY - (r.yBottom + r.h)) / modulePt);
    const span = Math.round(r.w / modulePt);
    for (let k = 0; k < span; k++) {
      if (row < qr.size && col0 + k < qr.size) { grid[row * qr.size + col0 + k] = 1; placed++; }
    }
  }
  return { grid, runs, placed, modulePt };
}

/**
 * The real print path: render the PDF page with pdf.js onto a canvas, then
 * decode the pixels with jsQR. This is what a phone camera does to a printed
 * card, so if this passes, the card scans.
 */
async function renderPage(bytes, pageNum, scale) {
  const { createCanvas } = ORACLE.optional('@napi-rs/canvas');
  const { doc } = await loadPdf(bytes);
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const img = context.getImageData(0, 0, canvas.width, canvas.height);
  return new Uint8ClampedArray(img.data);
}

// ---------------------------------------------------------------------------
// card renderer
// ---------------------------------------------------------------------------

test('Store.githubPagesIdentity and githubPagesRoot describe a Pages deployment', () => {
  try {
    Store.setSiteRoot('https://alice.github.io/my-card/');
    assert.deepEqual(Store.githubPagesIdentity(), { owner: 'alice', repo: 'my-card' });
    assert.equal(Store.isUpstreamDemo(), false);
    assert.equal(Store.githubPagesRoot('alice', 'my-card'), 'https://alice.github.io/my-card/');
    assert.equal(Store.githubPagesRoot('Alice', 'my-card'), 'https://alice.github.io/my-card/',
      'the github.io host is always lowercase');

    Store.setSiteRoot('https://clickalex.github.io/GrinCard/');
    assert.deepEqual(Store.githubPagesIdentity(), { owner: 'clickalex', repo: 'GrinCard' });
    assert.equal(Store.isUpstreamDemo(), true);

    Store.setSiteRoot('https://alice.github.io/');
    assert.deepEqual(Store.githubPagesIdentity(), { owner: 'alice', repo: '' });
    assert.equal(Store.githubPagesRoot('alice', ''), 'https://alice.github.io/');
    assert.equal(Store.githubPagesRoot('alice', 'alice.github.io'), 'https://alice.github.io/',
      'a user-site repo name is the host, not a project path');

    Store.setSiteRoot('http://localhost:8080/');
    assert.equal(Store.githubPagesIdentity(), null);
    assert.equal(Store.isUpstreamDemo(), false);

    Store.setSiteRoot('https://cards.example.com/');
    assert.equal(Store.githubPagesIdentity(), null);

    assert.equal(Store.githubPagesRoot('', 'x'), '');
    assert.equal(Store.githubPagesRoot('bad user', 'x'), '');
    assert.equal(Store.githubPagesRoot('you', 'GrinCard'), 'https://you.github.io/GrinCard/');
  } finally {
    Store.setSiteRoot(null);
  }
});

test('card geometry is a real business card', () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  assert.equal(card.widthMm, 89);
  assert.equal(card.heightMm, 51);
  assert.ok(card.front.length > 5, 'front should have several drawing ops');
  assert.ok(card.back.length > 3, 'back should have several drawing ops');
});

test('every template renders both sides without throwing', () => {
  for (const template of TPL.TEMPLATES) {
    for (const showPhoto of [true, false]) {
      const p = { ...PROFILE, card_settings: { template_id: template.id, show_photo: showPhoto } };
      const card = Card.buildCard(p, { profileUrl: PROFILE_URL });
      const svgFront = Card.toSVG(card, 'front');
      const svgBack = Card.toSVG(card, 'back');
      assert.match(svgFront, /^<svg xmlns=/);
      assert.match(svgBack, /<path d="M[\d.]+ [\d.]+h/); // the QR
      assert.ok(!/undefined|NaN/.test(svgFront), template.id + ' front has undefined/NaN');
      assert.ok(!/undefined|NaN/.test(svgBack), template.id + ' back has undefined/NaN');
    }
  }
});

test('SVG is self-contained (no external references) and gradients live in defs', () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const svg = Card.toSVG(card, 'front');
  assert.ok(!/href="http|url\(['"]?http|@import/.test(svg), 'no external refs');
  assert.match(svg, /<defs>.*<linearGradient/s);
  // every url(#id) reference must resolve to a defined element
  const defined = new Set([...svg.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) {
    assert.ok(defined.has(ref[1]), `svg references #${ref[1]} which is never defined`);
  }
});

test('text that is too long is shrunk and ellipsised, never overflowing', () => {
  const long = {
    ...PROFILE,
    display_name: 'Bartholomew Chandrasekhar-Venkateswaran',
    designation: 'Senior Freelance Illustrator & Brand Consultant, Mumbai',
    card_settings: { template_id: 'template-1', show_photo: true }
  };
  const card = Card.buildCard(long, { profileUrl: PROFILE_URL });
  const texts = card.front.filter(i => i.type === 'text');
  for (const t of texts) {
    const widthMm = Card.textWidthMm(t.text, t.sizePt, t.fontFamily, t.weight);
    assert.ok(widthMm <= 89 - 4, `"${t.text}" overflows the card (${widthMm.toFixed(1)}mm)`);
  }
  assert.ok(texts.some(t => t.text.endsWith('…')), 'expected an ellipsis somewhere');
});

test('the back QR encodes exactly the profile URL', () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const qrItem = card.back.find(i => i.type === 'qr');
  assert.ok(qrItem, 'back must contain a QR');
  const qr = QR.create(PROFILE_URL, { ecl: 'Q', margin: 0 });
  assert.deepEqual(Buffer.from(qrItem.qr.modules), Buffer.from(qr.modules));
  // Printed module size must stay comfortably scannable (spec: >= 20mm overall).
  const printedMm = qrItem.moduleMm * qrItem.qr.size;
  assert.ok(printedMm >= 20, `QR prints at ${printedMm}mm, spec minimum is 20mm`);
  assert.equal(printedMm, TPL.GEOMETRY.qrSizeMm);
});

test('an independently-written decoder reads our QR at every size we produce', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, () => {
  const urls = [
    PROFILE_URL,
    PROFILE_URL + '?t=temp_abc123',
    'https://a.example/c/x',                 // tiny -> version 1
    'https://qrlinkcard.example/c/' + 'a'.repeat(120)  // large -> multi-block
  ];
  for (const url of urls) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      const qr = QR.create(url, { ecl });
      for (const scale of [4, 8]) {
        const { data, dim } = rasterise(qr.modules, qr.size, scale);
        const decoded = jsQR(data, dim, dim);
        assert.ok(decoded, `jsQR must decode v${qr.version}-${ecl} @${scale}px`);
        assert.equal(decoded.data, url);
        assert.equal(decoded.version, qr.version);
      }
    }
  }
});

test('the card back has no photo-only dependency and works with a missing URL', () => {
  const card = Card.buildCard(PROFILE, { profileUrl: '' });
  const texts = card.back.filter(i => i.type === 'text');
  assert.ok(texts.some(t => /profile URL/i.test(t.text)));
  assert.ok(!card.back.some(i => i.type === 'qr'));
});

// ---------------------------------------------------------------------------
// PDF writer
// ---------------------------------------------------------------------------

test('PDF: page is exactly 89 x 51 mm, two pages for front and back', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const { bytes } = Pdf.generate(card, { title: 'Rahul Kumar card' });
  assert.deepEqual([...bytes.slice(0, 8)], [...Buffer.from('%PDF-1.4')]);
  assert.ok(Buffer.from(bytes).includes('%%EOF'));
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, 2);
  for (let i = 1; i <= 2; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    assert.ok(Math.abs(vp.width - 89 * Pdf.PT_PER_MM) < 0.01, `page width ${vp.width}`);
    assert.ok(Math.abs(vp.height - 51 * Pdf.PT_PER_MM) < 0.01, `page height ${vp.height}`);
  }
});

test('PDF: the QR is vector geometry, module-identical to the encoder output', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const { bytes } = Pdf.generate(card);
  const qr = QR.create(PROFILE_URL, { ecl: 'Q', margin: 0 });
  const { grid, placed } = qrFromContent(bytes, 2, qr);

  assert.equal(placed, qr.modules.reduce((a, b) => a + b, 0), 'every dark module must be drawn');
  assert.deepEqual(Buffer.from(grid), Buffer.from(qr.modules),
    'the vector QR in the PDF must be module-identical to the encoded QR');
  // Vector, not a raster: there is no image XObject on the back page.
  const content = pageContent(bytes, 2).toString('latin1');
  assert.ok(!/\bDo\b/.test(content), 'the back must not depend on any embedded image');
});

test('PDF: rendering the printed page and decoding it recovers the URL', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const { bytes } = Pdf.generate(card);
  // 300 DPI over an 89 x 51 mm card => ~1050 x 600 px. Render the whole page.
  const scale = 300 / 72;
  const pixels = await renderPage(bytes, 2, scale);
  const width = Math.ceil(89 * Pdf.PT_PER_MM * scale);
  const height = Math.ceil(51 * Pdf.PT_PER_MM * scale);
  const decoded = jsQR(pixels, width, height);
  assert.ok(decoded, 'a 300 DPI render of the PDF must be scannable');
  assert.equal(decoded.data, PROFILE_URL);
});

test('a fork prints its own address: derived URL survives the whole print path',
  { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  // The premise of this repository, end to end. Somebody forks it, never types a URL,
  // and prints a card. What the camera reads back must be *their* site — not this
  // project's, not a fixture's, not a relative path a scanner cannot resolve.
  //
  // Every other test here hands buildCard() a URL constant. This one derives it the way
  // a deployed page does, then goes all the way to pixels and back through an
  // independent decoder. It is the only test that would catch a hardcoded deployment URL.
  const forks = [
    { root: 'https://riley.github.io/cards/', user: 'riley' },      // Pages project site
    { root: 'https://riley.dev/',              user: 'riley' },      // custom domain at root
    { root: 'http://localhost:8080/',          user: 'yourname' }    // local preview
  ];

  for (const { root, user } of forks) {
    Store.setSiteRoot(root);
    const derived = Store.profileUrlFor(user);
    assert.equal(derived, root.replace(/\/$/, '') + '/c/' + user + '/',
      'the derivation itself must produce the canonical /c/<username>/ shape');
    assert.ok(derived.startsWith('http'), 'a QR carrying a relative URL is unscannable nonsense');

    const card = Card.buildCard({ ...PROFILE, username: user }, { profileUrl: derived });
    const { bytes, warnings } = Pdf.generate(card);
    assert.deepEqual(warnings.filter(w => /qr|url/i.test(w)), [], warnings.join('; '));

    const scale = 300 / 72;   // what a print shop uses
    const pixels = await renderPage(bytes, 2, scale);
    const width = Math.ceil(89 * Pdf.PT_PER_MM * scale);
    const height = Math.ceil(51 * Pdf.PT_PER_MM * scale);
    const decoded = jsQR(pixels, width, height);

    assert.ok(decoded, `${root}: the 300 DPI render must be scannable`);
    assert.equal(decoded.data, derived,
      `${root}: the printed code must decode to this fork's own derived URL`);
    assert.ok(!/qrlinkcard\.example|clickalex/.test(decoded.data),
      'no upstream or fixture URL may reach a printed card: ' + decoded.data);
  }
  Store.setSiteRoot(null);

  // An absolute override is the one legitimate way to print a different address: a domain
  // you own that is not where the site is served. It must survive printing too.
  Store.setSiteRoot('https://riley.github.io/cards/');
  const custom = Store.profileUrlFor('riley', { profile_url: 'https://cards.riley.photo/c/riley/' });
  assert.equal(custom, 'https://cards.riley.photo/c/riley/');
  const customCard = Card.buildCard({ ...PROFILE, username: 'riley' }, { profileUrl: custom });
  const customPdf = Pdf.generate(customCard);
  const customScale = 300 / 72;
  const customPixels = await renderPage(customPdf.bytes, 2, customScale);
  const customDecoded = jsQR(customPixels,
    Math.ceil(89 * Pdf.PT_PER_MM * customScale), Math.ceil(51 * Pdf.PT_PER_MM * customScale));
  assert.ok(customDecoded, 'the custom-domain card must be scannable');
  assert.equal(customDecoded.data, custom, 'and must decode to the domain the owner chose');
  Store.setSiteRoot(null);
});

test('PDF: text is real text (searchable), not outlines', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const { bytes } = Pdf.generate(card);
  const { doc } = await loadPdf(bytes);
  const front = await (await doc.getPage(1)).getTextContent();
  const frontText = front.items.map(i => i.str).join(' ');
  assert.match(frontText, /Rahul Kumar/);
  assert.match(frontText, /Freelance Illustrator/);
  const back = await (await doc.getPage(2)).getTextContent();
  const backText = back.items.map(i => i.str).join(' ');
  assert.match(backText, /qrlinkcard\.example\/c\/rahul123/);
  assert.match(backText, /Scan for public links/);
});

test('PDF: gradients become vector shadings, not rasterised backgrounds', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL }); // template-1 is a gradient
  const { bytes } = Pdf.generate(card);
  const { doc, pdfjs } = await loadPdf(bytes);
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  assert.ok(ops.fnArray.includes(pdfjs.OPS.shadingFill), 'page 1 must paint an axial shading');

  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/ShadingType 2/, 'expected an axial (type 2) shading dictionary');
  assert.match(raw, /\/FunctionType 2/, 'expected a 2-stop exponential interpolation function');
  assert.match(raw, /\/Shading <</, 'page resources must reference the shading');
  const coords = raw.match(/\/Coords \[([\d.\- ]+)\]/)[1].trim().split(/\s+/).map(Number);
  assert.equal(coords.length, 4, 'axial shading needs x0 y0 x1 y1');
  coords.forEach(v => assert.ok(Number.isFinite(v), 'coords must be numbers'));

  // A solid-colour template must NOT emit a shading.
  const paper = Card.buildCard({ ...PROFILE, card_settings: { template_id: 'template-2' } },
    { profileUrl: PROFILE_URL });
  const paperOut = Pdf.generate(paper);
  assert.ok(!Buffer.from(paperOut.bytes).toString('latin1').includes('/ShadingType'),
    'template-2 is a flat colour and needs no shading');
});

test('PDF: an embedded PNG photo is kept as an image XObject with clipping', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const photo = pngDataUrl(64, 64, (x, y) => [x * 4 % 256, y * 4 % 256, 128]);
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL, photoDataUrl: photo });
  const { bytes, warnings } = Pdf.generate(card);
  assert.deepEqual(warnings, [], 'no warnings expected: ' + warnings.join('; '));
  const { doc, pdfjs } = await loadPdf(bytes);
  const page = await doc.getPage(1);
  const ops = await page.getOperatorList();
  assert.ok(ops.fnArray.includes(pdfjs.OPS.paintImageXObject), 'expected an image XObject');
  assert.ok(ops.fnArray.includes(pdfjs.OPS.clip), 'expected the circular clip');
  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/Subtype \/Image \/Width 64 \/Height 64/);
});

test('PDF: a grayscale PNG embeds as DeviceGray with PNG predictors', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const gray = pngDataUrl(16, 16, (x) => [x * 16 % 256], 0);
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL, photoDataUrl: gray });
  const { bytes, warnings } = Pdf.generate(card);
  assert.deepEqual(warnings, []);
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, 2);
  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/ColorSpace \/DeviceGray/);
  assert.match(raw, /\/Predictor 15 \/Colors 1/, 'the stream is still PNG-filtered');
});

test('PDF: a true-colour PNG with alpha embeds a soft mask', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const rgba = makePngWithAlpha(8, 8, (x, y) => [200, 40, 40, (x * 32) % 256]);
  const card = Card.buildCard(PROFILE, {
    profileUrl: PROFILE_URL,
    photoDataUrl: 'data:image/png;base64,' + rgba.toString('base64')
  });
  const { bytes, warnings } = Pdf.generate(card);
  assert.deepEqual(warnings, []);
  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/SMask \d+ 0 R/, 'alpha must become a soft mask');
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, 2);
});

test('PDF: a paletted PNG with tRNS is expanded and embedded', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const png = makePalettedPng(4, 4);
  const card = Card.buildCard(PROFILE, {
    profileUrl: PROFILE_URL,
    photoDataUrl: 'data:image/png;base64,' + png.toString('base64')
  });
  const { bytes, warnings } = Pdf.generate(card);
  assert.deepEqual(warnings, []);
  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/ColorSpace \/DeviceRGB/, 'palette must be expanded to RGB');
  assert.match(raw, /\/SMask \d+ 0 R/, 'tRNS must become a soft mask');
});

test('PDF: a remote (non-data-URL) photo is skipped with a warning, not a crash', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL }); // profile.photo_url is null here
  const withRemote = Card.buildCard({ ...PROFILE, photo_url: 'https://example.com/me.jpg' },
    { profileUrl: PROFILE_URL });
  const { bytes, warnings } = Pdf.generate(withRemote);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /data URL/i);
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, 2);
});

test('PDF: the 2-up print sheet is one page, wide enough for both sides', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const { bytes } = Pdf.generate(card, { sides: 'sheet', bleed: true });
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, 1);
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const expectedW = (89 + 6) * 2 + 8; // two cards + 3mm bleed each side + 8mm gap
  assert.ok(Math.abs(vp.width / Pdf.PT_PER_MM - expectedW) < 0.01, `sheet width ${vp.width / Pdf.PT_PER_MM}mm`);
  assert.ok(Math.abs(vp.height / Pdf.PT_PER_MM - (51 + 6)) < 0.01, 'sheet height');
  // The back QR must sit on the right-hand card of the sheet.
  const qr = QR.create(PROFILE_URL, { ecl: 'Q', margin: 0 });
  const content = pageContent(bytes, 1).toString('latin1');
  const modulePt = (TPL.GEOMETRY.qrSizeMm / qr.size) * Pdf.PT_PER_MM;
  const runs = rectsIn(content).filter(r => Math.abs(Math.abs(r.h) - modulePt) < 0.01);
  assert.ok(runs.length > 20, `sheet should contain the back QR runs, found ${runs.length}`);
  const leftCardRightEdge = (89 + 6) * Pdf.PT_PER_MM;
  assert.ok(runs.every(r => r.x > leftCardRightEdge),
    'QR runs must all land on the right-hand (back) card');
  const { grid } = qrFromContent(bytes, 1, qr);
  const { data, dim } = rasterise(grid, qr.size, 8);
  assert.equal(jsQR(data, dim, dim).data, PROFILE_URL, 'the sheet QR must decode');
});

test('PDF: xref table offsets are correct (pdf.js strict parse)', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  // A malformed xref is the classic hand-rolled-PDF bug; pdf.js would warn.
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const { bytes } = Pdf.generate(card);
  const buf = Buffer.from(bytes);
  const startxref = parseInt(buf.toString('latin1').match(/startxref\n(\d+)/)[1], 10);
  assert.equal(buf.toString('latin1', startxref, startxref + 4), 'xref');
  const xrefBlock = buf.toString('latin1').slice(startxref);
  const m = xrefBlock.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  const count = parseInt(m[1], 10);
  const entries = m[2].split('\n').filter(Boolean);
  assert.equal(entries.length, count, 'xref entry count must match /Size');
  for (let i = 1; i < count; i++) {
    const [offsetStr, gen, type] = entries[i].trim().split(/\s+/);
    assert.equal(type, 'n', `object ${i} should be in use`);
    const offset = parseInt(offsetStr, 10);
    assert.match(buf.toString('latin1', offset, offset + 20), new RegExp(`^${i} 0 obj`),
      `xref offset for object ${i} must point at "N 0 obj"`);
  }
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, 2);
});

test('PDF: WinAnsi encoding warns about characters it cannot print', () => {
  const enc = Pdf.encodeText('Rahul ₹ Designer — café … “hi”');
  assert.ok(enc.lost.includes('₹'), 'rupee sign is not in WinAnsi');
  assert.ok(enc.lost.includes('—') === false, 'em dash IS representable in WinAnsi');
  assert.deepEqual(Pdf.encodeText('plain ASCII').lost, []);
  const devanagari = Pdf.encodeText('राहुल');
  assert.ok(devanagari.lost.length > 0, 'Devanagari cannot be rendered by the base-14 fonts');

  const card = Card.buildCard({ ...PROFILE, display_name: 'Rahul ₹ Kumar' }, { profileUrl: PROFILE_URL });
  const { warnings } = Pdf.generate(card);
  assert.ok(warnings.some(w => /cannot render/.test(w)), 'user must be warned: ' + JSON.stringify(warnings));
});

test('PDF: escaping handles parentheses and backslashes in names', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const card = Card.buildCard(
    { ...PROFILE, display_name: 'Ada (née) L\\ovelace' },
    { profileUrl: PROFILE_URL }
  );
  const { bytes } = Pdf.generate(card);
  const { doc } = await loadPdf(bytes);
  const text = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  assert.match(text, /Ada \(n/);
  assert.match(text, /L\\ovelace/);
});

test('PDF output is deterministic for the same input', () => {
  const card = Card.buildCard(PROFILE, { profileUrl: PROFILE_URL });
  const a = Pdf.generate(card, {});
  const b = Pdf.generate(card, {});
  // CreationDate differs by second, so compare everything but it.
  const strip = (buf) => Buffer.from(buf).toString('latin1').replace(/D:\d{14}Z00'00'/, 'DATE');
  assert.equal(strip(a.bytes), strip(b.bytes));
});
