/**
 * QR generator + generic PDF writer tests.
 *
 * The sheet PDF is parsed with pdfjs-dist and one QR is rendered at 300 DPI and
 * decoded with jsQR, so "this prints and scans" is verified rather than assumed.
 * jsQR / pdfjs-dist / @napi-rs/canvas are dev-only oracles (see tests/oracle.js) —
 * nothing in lib/ or the pages imports them, and the suites that need them skip
 * with an install hint when they are missing.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const QR = require('../lib/qr.js');
const SimplePdf = require('../lib/pdfdoc.js');
const Gen = require('../qr-generator/generator.js');

const ORACLE = require('./oracle.js');
const jsQR = ORACLE.optional('jsqr');
const loadPdf = ORACLE.readPdf;

// ---------------------------------------------------------------------------
// Parsing the pasted list
// ---------------------------------------------------------------------------

test('parseList accepts bare URLs, pipe, comma and tab separators', () => {
  const entries = Gen.parseList([
    'https://a.example',
    'Instagram | https://b.example',
    'Portfolio, https://c.example',
    'Phone\ttel:+919876543210',
    '# a comment',
    '',
    '   https://d.example   '
  ].join('\n'));
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map(e => e.url), [
    'https://a.example', 'https://b.example', 'https://c.example',
    'tel:+919876543210', 'https://d.example'
  ]);
  assert.deepEqual(entries.map(e => e.label), [
    'a.example', 'Instagram', 'Portfolio', 'Phone', 'd.example'
  ]);
  assert.ok(entries.every(e => e.id));
});

test('parseList labels fall back to something readable', () => {
  assert.equal(Gen.guessLabel('https://www.instagram.com/rahul.illustrates'),
    'instagram.com/rahul.illustrates');
  assert.equal(Gen.guessLabel('https://rahul.example/'), 'rahul.example');
  assert.equal(Gen.guessLabel('mailto:a@b.test'), 'mailto:a@b.test');
});

test('parseList never drops a URL that contains a comma in its query string', () => {
  const entries = Gen.parseList('Map | https://maps.example/?q=Delhi,India');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://maps.example/?q=Delhi,India');
  assert.equal(entries[0].label, 'Map');
});

// ---------------------------------------------------------------------------
// Layout maths
// ---------------------------------------------------------------------------

test('layout fits A4 and computes the quiet zone from the real symbol size', () => {
  const entries = Gen.parseList('https://a.example\nhttps://b.example');
  const lo = Gen.layout(entries, { paper: 'a4', sizeMm: 25, marginMm: 10, gapMm: 4 });
  assert.equal(lo.paper.width, 210);
  assert.equal(lo.paper.height, 297);

  // Both URLs are 21 characters, so version 2 (25 modules): the 25 mm symbol
  // means 1 mm modules and a 4 mm quiet zone on each side.
  assert.equal(lo.maxModules, 25);
  assert.ok(Math.abs(lo.moduleMm - 1) < 1e-9);
  assert.ok(Math.abs(lo.quietMm - 4) < 1e-9);
  assert.ok(Math.abs(lo.symbolMm - 25) < 1e-9);
  assert.ok(Math.abs(lo.cell.width - 33) < 1e-9);

  // Everything must fit inside the printable area.
  assert.ok(lo.columns * lo.cell.width + (lo.columns - 1) * lo.gapMm <= 210 - 2 * 10 + 1e-9);
  assert.ok(lo.rows * lo.cell.height + (lo.rows - 1) * lo.gapMm <= 297 - 2 * 10 + 1e-9);
  assert.equal(lo.perPage, lo.columns * lo.rows);
});

test('layout: a bigger QR means fewer per page, and pages are computed from that', () => {
  const entries = Gen.parseList(Array.from({ length: 40 }, (_, i) => 'https://x.example/' + i).join('\n'));
  const small = Gen.layout(entries, { paper: 'a4', sizeMm: 20, marginMm: 10, gapMm: 3 });
  const large = Gen.layout(entries, { paper: 'a4', sizeMm: 60, marginMm: 10, gapMm: 3 });
  assert.ok(small.perPage > large.perPage);
  assert.ok(small.pageCount <= large.pageCount);
  assert.equal(small.pageCount, Math.ceil(40 / small.perPage));
});

test('layout: labels add height to the cell but not width', () => {
  const entries = Gen.parseList('https://a.example');
  const plain = Gen.layout(entries, { paper: 'a4', sizeMm: 25 });
  const labelled = Gen.layout(entries, { paper: 'a4', sizeMm: 25, showLabels: true });
  assert.equal(plain.cell.width, labelled.cell.width);
  assert.ok(labelled.cell.height > plain.cell.height);
  assert.ok(labelled.rows <= plain.rows);
});

test('layout honours every paper size in PAPER', () => {
  Object.keys(Gen.PAPER).forEach(key => {
    const lo = Gen.layout(Gen.parseList('https://a.example'), { paper: key, sizeMm: 25, marginMm: 8 });
    assert.ok(lo.columns >= 1, key + ': needs at least one column');
    assert.ok(lo.rows >= 1, key + ': needs at least one row');
    assert.ok(lo.cell.width <= lo.paper.width, key + ': cell wider than paper');
  });
});

test('position packs row-wise, centres the grid and paginates', () => {
  const entries = Gen.parseList(Array.from({ length: 70 }, (_, i) => 'https://x.example/' + i).join('\n'));
  const lo = Gen.layout(entries, { paper: 'a4', sizeMm: 25, marginMm: 10, gapMm: 4 });

  const first = Gen.position(0, lo);
  const second = Gen.position(1, lo);
  assert.equal(first.page, 0);
  assert.equal(second.page, 0);
  assert.equal(second.y, first.y);
  assert.ok(second.x > first.x);

  // Wraps to the next row after `columns` entries.
  const wrapped = Gen.position(lo.columns, lo);
  assert.equal(wrapped.x, first.x);
  assert.ok(wrapped.y > first.y);

  // Page break lands exactly on perPage.
  assert.equal(Gen.position(lo.perPage - 1, lo).page, 0);
  assert.equal(Gen.position(lo.perPage, lo).page, 1);

  // Nothing outside the paper, and the grid is centred.
  for (let i = 0; i < entries.length; i++) {
    const p = Gen.position(i, lo);
    assert.ok(p.x >= 0 && p.x + lo.cell.width <= lo.paper.width + 1e-9, 'entry ' + i + ' off the page');
    assert.ok(p.y >= 0 && p.y + lo.cell.height <= lo.paper.height + 1e-9, 'entry ' + i + ' off the page');
  }
  const gridWidth = lo.columns * lo.cell.width + (lo.columns - 1) * lo.gapMm;
  assert.ok(Math.abs(first.x - (lo.paper.width - gridWidth) / 2) < 1e-9, 'grid should be centred');
});

test('position gives every entry a unique, non-overlapping cell', () => {
  const entries = Gen.parseList(Array.from({ length: 30 }, (_, i) => 'https://x.example/' + i).join('\n'));
  const lo = Gen.layout(entries, { paper: 'a4', sizeMm: 30, marginMm: 10, gapMm: 5 });
  const boxes = entries.map((_, i) => {
    const p = Gen.position(i, lo);
    return { page: p.page, x1: p.x, y1: p.y, x2: p.x + lo.cell.width, y2: p.y + lo.cell.height };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]; const b = boxes[j];
      const overlaps = a.page === b.page && a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      assert.ok(!overlaps, 'cells ' + i + ' and ' + j + ' overlap');
    }
  }
});

// ---------------------------------------------------------------------------
// SVG output
// ---------------------------------------------------------------------------

test('singleSvg draws every dark module and sizes itself in mm', () => {
  // The canonical printed URL shape: /c/<username>/, not a ?u= deep link.
  const url = 'https://clickalex.github.io/GrinCard/c/rahul123/';
  const svg = Gen.singleSvg(url, { ecl: 'M', sizeMm: 25, quietZoneModules: 4 });
  const qr = QR.create(url, { ecl: 'M', margin: 0 });
  let dark = 0;
  for (let i = 0; i < qr.modules.length; i++) if (qr.modules[i] === 1) dark++;

  // One rect per horizontal run, so the total area must equal the dark modules.
  const runs = svg.match(/h[\d.]+v[\d.]+h-[\d.]+z/g) || [];
  const scale = 25 / qr.size;
  const area = runs.reduce((sum, run) => {
    const m = /h([\d.]+)v([\d.]+)/.exec(run);
    return sum + parseFloat(m[1]) * parseFloat(m[2]);
  }, 0);
  assert.ok(Math.abs(area - dark * scale * scale) < 0.05 * dark * scale * scale,
    'drawn area ' + area + ' vs expected ' + dark * scale * scale);
  assert.match(svg, /width="[\d.]+mm"/);
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
});

test('singleSvg respects colour, background and error correction level', () => {
  const url = 'https://example.test/abc';
  const plain = Gen.singleSvg(url, { ecl: 'L', sizeMm: 20, color: '#123456', background: '#ffffff' });
  assert.match(plain, /fill="#123456"/);
  assert.match(plain, /fill="#ffffff"/);

  const transparent = Gen.singleSvg(url, { ecl: 'L', sizeMm: 20, background: 'none' });
  assert.ok(!/<rect/.test(transparent), 'background "none" must not paint a rect');

  // Higher error correction means a bigger symbol for the same payload.
  const l = QR.create(url, { ecl: 'L', margin: 0 }).size;
  const h = QR.create(url, { ecl: 'H', margin: 0 }).size;
  assert.ok(h > l, 'ECL H should need more modules than L');
});

test('sheetSvg emits one page at a time with the right page count', () => {
  const entries = Gen.parseList(Array.from({ length: 70 }, (_, i) => 'https://x.example/' + i).join('\n'));
  const opts = { paper: 'a4', sizeMm: 25, marginMm: 10, gapMm: 4, showLabels: true };
  const lo = Gen.layout(entries, opts);
  assert.ok(lo.pageCount > 1, 'the test needs more entries than one page holds');

  let total = 0;
  for (let p = 0; p < lo.pageCount; p++) {
    const svg = Gen.sheetSvg(entries, p, opts);
    const groups = (svg.match(/<g data-index=/g) || []).length;
    total += groups;
    assert.ok(groups > 0, 'page ' + p + ' is empty');
    assert.ok(groups <= lo.perPage, 'page ' + p + ' overflows');
    assert.match(svg, new RegExp('width="' + lo.paper.width + 'mm"'));
  }
  assert.equal(total, entries.length, 'every entry must appear exactly once');
});

test('sheetSvg labels are truncated to fit their cell', () => {
  const long = 'A very long label that would never fit inside a 25mm cell';
  const entries = Gen.parseList(long + ' | https://x.example');
  const svg = Gen.sheetSvg(entries, 0, { paper: 'a6', sizeMm: 20, showLabels: true });
  const label = /text-anchor="middle">([^<]+)</.exec(svg)[1];
  assert.ok(label.length < long.length, 'the label should have been shortened');
  assert.match(label, /…|\.\.\./);
});

test('sheetSvg escapes XML in labels and URLs', () => {
  const entries = Gen.parseList('Tom & "Jerry" <b> | https://x.example/?a=1&b=2');
  const svg = Gen.sheetSvg(entries, 0, { paper: 'a6', sizeMm: 25, showLabels: true });
  assert.ok(svg.includes('&amp;'));
  assert.ok(!/<b>/.test(svg), 'raw HTML must not survive into the SVG');
});

// ---------------------------------------------------------------------------
// The generic PDF writer
// ---------------------------------------------------------------------------

test('SimplePdf writes an exact millimetre page box', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const doc = new SimplePdf({ title: 'Box test' });
  doc.addPage(210, 297);
  const bytes = doc.build();
  assert.match(Buffer.from(bytes.slice(0, 20)).toString('latin1'), /^%PDF-1\.4/);
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const { doc: parsed } = await loadPdf(bytes);
  assert.equal(parsed.numPages, 1);
  const page = await parsed.getPage(1);
  assert.ok(Math.abs(page.view[2] * 25.4 / 72 - 210) < 0.01, 'width must be 210 mm');
  assert.ok(Math.abs(page.view[3] * 25.4 / 72 - 297) < 0.01, 'height must be 297 mm');
});

test('SimplePdf supports multiple pages of different sizes', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const doc = new SimplePdf({ title: 'Multi' });
  doc.addPage(89, 51);
  doc.addPage(210, 297);
  doc.addPage(105, 148);
  const { doc: parsed } = await loadPdf(doc.build());
  assert.equal(parsed.numPages, 3);
  const sizes = [];
  for (let i = 1; i <= 3; i++) {
    const p = await parsed.getPage(i);
    sizes.push([Math.round(p.view[2] * 25.4 / 72), Math.round(p.view[3] * 25.4 / 72)]);
  }
  assert.deepEqual(sizes, [[89, 51], [210, 297], [105, 148]]);
});

test('SimplePdf rect() converts from top-left mm to PDF bottom-left points', async () => {
  const doc = new SimplePdf({ title: 'Coords' });
  const page = doc.addPage(100, 100);
  page.rect(10, 20, 30, 40, '#ff0000');
  const bytes = doc.build();
  const text = Buffer.from(bytes).toString('latin1');
  const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)[1];
  // Callers work in mm from the TOP-left; PDF works in points from the
  // BOTTOM-left. A rect at y=20mm with h=40mm on a 100mm page therefore starts
  // 40mm above the bottom edge: 100 - (20 + 40).
  const pt = mm => Math.round(mm * 72 / 25.4 * 100) / 100;
  assert.ok(stream.includes('1 0 0 rg'), 'should set the fill colour');
  assert.ok(stream.includes(pt(10) + ' ' + pt(100 - (20 + 40)) + ' ' + pt(30) + ' ' + pt(40) + ' re f'),
    'unexpected rect: ' + stream);
  assert.ok(!stream.includes('NaN'), 'no NaN may reach the content stream');
});

test('SimplePdf text is centred using real Helvetica widths', async () => {
  const doc = new SimplePdf({ title: 'Text' });
  const page = doc.addPage(100, 50);
  page.text('Instagram', 50, 25, 10, '#000000', 'middle');
  const stream = /stream\n([\s\S]*?)\nendstream/.exec(Buffer.from(doc.build()).toString('latin1'))[1];
  const width = SimplePdf.textWidth('Instagram', 10, false);
  const expectedX = Math.round((50 / (25.4 / 72) - width / 2) * 100) / 100;
  assert.ok(stream.includes('/F1 10 Tf'), 'should use the regular font at 10 pt');
  assert.ok(stream.includes(expectedX + ' '), 'expected x offset ' + expectedX + ' in: ' + stream);
  assert.ok(stream.includes('(Instagram) Tj'));
});

test('SimplePdf escapes parentheses and reports unrepresentable characters', () => {
  const warnings = [];
  assert.equal(SimplePdf.pdfString('a (b) c \\ d', warnings), 'a \\(b\\) c \\\\ d');
  assert.deepEqual(warnings, []);

  const doc = new SimplePdf({ title: 'Warn' });
  doc.addPage(100, 100).text('Café — ₹100 … done', 10, 20, 10);
  doc.build();
  const w = doc.getWarnings();
  // Silent substitution is a print hazard, so every non-Latin-1 character is
  // reported: the em dash and ellipsis map to ASCII, the rupee sign to "Rs".
  assert.equal(w.length, 3, JSON.stringify(w));
  assert.ok(w.some(x => /U\+20B9/.test(x)), 'the rupee sign should be reported');
  assert.ok(w.some(x => /U\+2014/.test(x)), 'the em dash should be reported');
});

test('SimplePdf xref offsets point at real objects (so readers can seek)', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const doc = new SimplePdf({ title: 'Xref' });
  doc.addPage(89, 51).rect(0, 0, 89, 51, '#ffffff');
  doc.addPage(89, 51).text('hello', 10, 10, 12);
  const bytes = doc.build();
  const buf = Buffer.from(bytes);
  const text = buf.toString('latin1');
  const startxref = parseInt(/startxref\n(\d+)\n%%EOF/.exec(text)[1], 10);
  assert.equal(text.slice(startxref, startxref + 4), 'xref', 'startxref must point at the xref table');
  const rows = [...text.slice(startxref).matchAll(/^(\d{10}) (\d{5}) n $/gm)];
  assert.ok(rows.length >= 6, 'expected an xref row per object, got ' + rows.length);
  rows.forEach(row => {
    const offset = parseInt(row[1], 10);
    assert.match(buf.slice(offset, offset + 20).toString('latin1'), /^\d+ 0 obj/,
      'offset ' + offset + ' does not start an object');
  });
  const { doc: parsed } = await loadPdf(bytes);
  assert.equal(parsed.numPages, 2);
});

// ---------------------------------------------------------------------------
// The sheet PDF, end to end
// ---------------------------------------------------------------------------

test('sheetPdf produces one page per layout page with a true paper box', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const entries = Gen.parseList(Array.from({ length: 70 }, (_, i) => 'https://x.example/' + i).join('\n'));
  const opts = { paper: 'a4', sizeMm: 25, marginMm: 10, gapMm: 4, showLabels: true };
  const lo = Gen.layout(entries, opts);
  const bytes = Gen.sheetPdf(entries, opts);
  const { doc } = await loadPdf(bytes);
  assert.equal(doc.numPages, lo.pageCount);
  const page = await doc.getPage(1);
  assert.ok(Math.abs(page.view[2] * 25.4 / 72 - 210) < 0.01);
  assert.ok(Math.abs(page.view[3] * 25.4 / 72 - 297) < 0.01);
  const text = await page.getTextContent();
  // Count the label operators in the content stream: pdf.js splits text runs,
  // so getTextContent() is not a reliable item count.
  const ops = await page.getOperatorList();
  const OPS = (await import(ORACLE.oraclePath('pdfjs-dist/legacy/build/pdf.mjs'))).OPS;
  const shown = ops.fnArray.filter(fn => fn === OPS.showText || fn === OPS.showSpacedText).length;
  assert.equal(shown, lo.perPage, 'every code on page 1 should carry exactly one label');
  const labels = text.items.map(i => i.str).filter(s => s.trim()).join('');
  assert.ok(labels.includes('x.example/0'), labels.slice(0, 120));
  assert.ok(labels.includes('x.example/29'), 'the last code on page 1 should be labelled');
});

test('sheetPdf: a QR printed on the sheet scans back to its exact URL', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const target = 'https://clickalex.github.io/GrinCard/c/rahul123/?t=temp_demo_live';
  const entries = Gen.parseList([
    'Card | ' + target,
    'Shop | https://instagram.com/shop',
    'A long one | https://example.test/' + 'x'.repeat(80)
  ].join('\n'));
  const opts = { paper: 'a4', sizeMm: 25, marginMm: 10, gapMm: 4, showLabels: true };
  const bytes = Gen.sheetPdf(entries, opts);
  const lo = bytes.layout;

  // Render the sheet the way a printer would, at 300 DPI, then scan it the way a
  // phone would: crop each cell plus white around it and hand the pixels to jsQR.
  const DPI = 300;
  const { doc } = await loadPdf(bytes);
  const { ctx } = await ORACLE.rasterisePage(doc, 1, DPI);
  const px = mm => mm / 25.4 * DPI;

  const results = entries.map((entry, i) => {
    const pos = Gen.position(i, lo);
    const inset = lo.quietMm;                    // the cell is symbol + quiet zone
    const pad = lo.quietMm;                      // crop extra white, as a camera would
    const x = Math.floor(px(pos.x + inset - pad));
    const y = Math.floor(px(pos.y + inset - pad));
    const side = Math.ceil(px(lo.symbolMm + pad * 2));
    const found = ORACLE.decodeQr(ctx.getImageData(x, y, side, side));
    return found ? found.data : null;
  });

  assert.deepEqual(results, entries.map(e => e.url),
    'every printed code must decode to exactly what was asked for');
  assert.equal(results[0], target);
  // And the codes must be physically big enough to scan: a 25 mm symbol on A4.
  assert.ok(lo.symbolMm >= 20, 'symbols below 20 mm are not reliably scannable');
  assert.ok(lo.moduleMm > 0.3, 'modules below 0.3 mm do not survive print: ' + lo.moduleMm);
});

test('sheetPdf warns rather than corrupting labels with exotic characters', () => {
  const entries = Gen.parseList('Café ₹ Shop | https://x.example');
  const bytes = Gen.sheetPdf(entries, { paper: 'a6', sizeMm: 25, showLabels: true });
  // é is WinAnsi-safe; the rupee sign is not, so it is substituted and reported.
  assert.ok(Array.isArray(bytes.warnings));
  assert.ok(bytes.warnings.some(w => /U\+20B9/.test(w)), JSON.stringify(bytes.warnings));
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('Caf\351'), 'the label still prints, é and all');
  assert.ok(text.includes('Rs'), 'the rupee sign is substituted, not dropped');
});

test('a long URL in the batch raises the module size for every code', () => {
  // The quiet zone is measured in modules, so it must be derived from the
  // largest code in the batch — otherwise the long one prints with a quiet zone
  // that is too small and does not scan.
  const shortOnly = Gen.layout(Gen.parseList('https://a.example'), { paper: 'a4', sizeMm: 25 });
  const mixed = Gen.layout(Gen.parseList([
    'https://a.example',
    'https://example.test/' + 'very-long-path-segment/'.repeat(6)
  ].join('\n')), { paper: 'a4', sizeMm: 25 });

  assert.ok(mixed.maxModules > shortOnly.maxModules);
  assert.ok(mixed.moduleMm < shortOnly.moduleMm, 'the module gets smaller to fit the bigger code');
  assert.ok(Math.abs(mixed.symbolMm - 25) < 1e-9, 'the largest code is exactly the requested size');
  assert.ok(Math.abs(mixed.quietMm - 4 * mixed.moduleMm) < 1e-9);
  // Every code still gets its full quiet zone inside its cell.
  assert.ok(Math.abs((mixed.cell.width - mixed.symbolMm) / 2 - mixed.quietMm) < 1e-9);
  // NB: a longer URL needs a *smaller* module to stay at 25 mm, so its quiet
  // zone in mm shrinks and MORE codes can fit. What must never shrink is the
  // quiet zone in modules.
  assert.equal(mixed.quietZoneModules, shortOnly.quietZoneModules);
  assert.ok(mixed.quietMm < shortOnly.quietMm);
  assert.ok(mixed.cell.width < shortOnly.cell.width);
});

test('the sheet is honest about the quiet zone being inside the printed cell', () => {
  const entries = Gen.parseList('https://x.example');
  const lo = Gen.layout(entries, { paper: 'a4', sizeMm: 25, quietZoneModules: 4 });
  const inset = (lo.cell.width - lo.sizeMm) / 2;
  assert.ok(inset >= lo.quietMm - 1e-9, 'the cell must leave room for the quiet zone');
  assert.ok(lo.cell.width > lo.sizeMm, 'the cell is bigger than the symbol');
});
