/**
 * tests/oracle.js — locating the dev-only "oracle" packages.
 *
 * Several suites check our output against independent implementations: the
 * reference `qrcode` encoder, the `jsQR` decoder, Mozilla's `pdfjs-dist` reader,
 * `@napi-rs/canvas` for rasterising, and `jsdom` for running the pages. They are
 * oracles, not dependencies — nothing in `lib/` or the pages imports them, and
 * the shipped site has no dependencies at all.
 *
 * They are looked for outside the repository so that a stray `npm install` can
 * never put a `node_modules/` inside a project whose whole premise is not having
 * one. Point QR_ORACLE_DIR somewhere else if you keep them elsewhere:
 *
 *   QR_ORACLE_DIR=~/dev/oracles npm test
 *
 * When they are missing, the suites that need them SKIP with an install hint
 * rather than crashing, so `npm test` is useful on a fresh clone. `npm run
 * test:full` is the one to run before sending a pull request.
 *
 *   mkdir -p /tmp/oracle && cd /tmp/oracle && npm init -y &&
 *     npm i qrcode@1.5.4 jsqr pdfjs-dist @napi-rs/canvas jsdom
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// An explicit QR_ORACLE_DIR is authoritative: it is how you test the
// "oracles missing" path, and how you keep them somewhere sensible on your own
// machine. Otherwise the usual places are tried in order.
const CANDIDATE_ROOTS = process.env.QR_ORACLE_DIR
  ? [process.env.QR_ORACLE_DIR]
  : [
    '/tmp/oracle',
    path.join(require('node:os').tmpdir(), 'oracle'),
    path.join(__dirname, '..', '.oracle')      // gitignored; see .gitignore
  ];

function findRoot() {
  for (const root of CANDIDATE_ROOTS) {
    const modules = path.join(root, 'node_modules');
    if (fs.existsSync(modules)) return { root, modules };
  }
  return { root: CANDIDATE_ROOTS[0], modules: null };
}

const found = findRoot();

const INSTALL_HINT =
  'dev-only test oracles not found. Install them outside the repo:\n' +
  '  mkdir -p /tmp/oracle && cd /tmp/oracle && npm init -y &&\n' +
  '    npm i qrcode@1.5.4 jsqr pdfjs-dist @napi-rs/canvas jsdom\n' +
  '(or set QR_ORACLE_DIR to where you keep them — see tests/oracle.js)';

/** True when the oracles are installed and the full suites can run. */
const available = !!found.modules;

/** Absolute path into the oracle tree, e.g. oraclePath('pdfjs-dist/legacy/build/pdf.mjs'). */
function oraclePath(rel) {
  if (!found.modules) return null;
  return path.join(found.modules, rel);
}

/** require() an oracle package, or null when it is not installed. */
function optional(spec) {
  if (!found.modules) return null;
  try {
    return require(path.join(found.modules, spec));
  } catch (e) {
    return null;
  }
}

/**
 * Open a PDF we generated with pdfjs-dist — an independent reader, so a
 * malformed xref or a wrong MediaBox fails here rather than at the print shop.
 */
async function readPdf(bytes) {
  const dir = oraclePath('pdfjs-dist/');
  const pdfjs = await import(dir + 'legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = dir + 'legacy/build/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: dir + 'standard_fonts/'
  }).promise;
  return { pdfjs, doc };
}

/**
 * Render a page of a PDF we generated at `dpi` and hand back raw RGBA pixels,
 * so an independent decoder can try to read the QR that a printer would.
 */
async function rasterisePage(doc, pageNumber, dpi) {
  const canvasLib = optional('@napi-rs/canvas');
  if (!canvasLib) throw new Error(INSTALL_HINT);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}

/** Decode QR codes out of RGBA pixels with jsQR. */
function decodeQr(imageData) {
  const mod = optional('jsqr');
  if (!mod) throw new Error(INSTALL_HINT);
  const jsQR = mod.default || mod;
  return jsQR(new Uint8ClampedArray(imageData.data.buffer), imageData.width, imageData.height);
}

module.exports = {
  available,
  INSTALL_HINT,
  root: found.root,
  modules: found.modules,
  oraclePath,
  optional,
  readPdf,
  rasterisePage,
  decodeQr
};
