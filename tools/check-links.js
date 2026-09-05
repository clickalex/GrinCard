#!/usr/bin/env node
/*!
 * tools/check-links.js — verifies that every internal link in every page and every
 * document points at a file that exists.
 *
 * This repository is a template that people restructure, and a link to a file that
 * moved is the breakage most likely to ship: it looks fine in a code review, and
 * fails only for the visitor who clicks it. A QR code that lands on a 404 is worse
 * than no card at all, because the card is already printed.
 *
 * Checks href, src and srcset on <a>, <link>, <script>, <img> and <source>.
 * Ignores external URLs, fragments, mailto/tel/data and query strings.
 *
 * Usage:
 *   node tools/check-links.js            human-readable report
 *   node tools/check-links.js --json     machine-readable
 *   node tools/check-links.js --strict   treat generated-stub notices as errors
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.oracle', 'dist', 'build', 'coverage']);

// A directory URL is served as its index.html by every static host we target.
const INDEX_FILES = ['index.html'];

function args(argv) {
  const out = { json: false, strict: false };
  argv.forEach((a) => {
    if (a === '--json') out.json = true;
    if (a === '--strict') out.strict = true;
    if (a === '--help' || a === '-h') out.help = true;
  });
  return out;
}

/** Every file whose links we check: pages, and the docs that point at them. */
function linkableFiles(dir, acc) {
  acc = acc || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (SKIP_DIRS.has(entry.name)) return;
    // Hidden directories are never part of the site: .github holds workflows, and
    // the test suite builds scratch trees inside the repo to exercise the tools.
    if (entry.name.startsWith('.')) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) linkableFiles(full, acc);
    else if (/\.(html|md)$/.test(entry.name)) acc.push(full);
  });
  return acc;
}

/**
 * Blank out <script> blocks, preserving line numbers.
 *
 * Pages build some of their markup in JavaScript, and an attribute regex cannot
 * tell a real link from a string being concatenated ('href="' + base + 'x.html').
 * Those are false positives that would train people to ignore this tool, so
 * links inside scripts are not checked. Everything in actual markup is.
 */
function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) =>
    block.replace(/[^\n]/g, ' '));
}

/** Every (attribute, raw value, line) triple that could name a local file. */
function extractLinks(html) {
  const found = [];
  const lines = stripScripts(html).split('\n');
  let fenced = false;
  const attrRe = /\b(href|src|srcset|data-src)\s*=\s*("([^"]*)"|'([^']*)')/gi;

  lines.forEach((line, i) => {
    if (isFence(line)) { fenced = !fenced; return; }
    if (fenced) return;
    // Markdown: [label](target). Docs are the most-edited surface in a template
    // repository and a link to a file that moved is just as broken there as in a
    // page, so they are checked by the same pass.
    for (const md of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      found.push({ attr: 'md', value: md[1], line: i + 1 });
    }
    let m;
    attrRe.lastIndex = 0;
    while ((m = attrRe.exec(line)) !== null) {
      const raw = m[3] != null ? m[3] : m[4];
      // srcset is a comma-separated list of "url descriptor" pairs.
      if (m[1].toLowerCase() === 'srcset') {
        raw.split(',').forEach((part) => {
          const url = part.trim().split(/\s+/)[0];
          if (url) found.push({ attr: m[1], value: url, line: i + 1 });
        });
      } else {
        found.push({ attr: m[1], value: raw, line: i + 1 });
      }
    }
  });
  return found;
}

function isExternal(value) {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(value) ||
    /^(mailto|tel|data|javascript|blob|#)/i.test(value);
}

/** Inside a fenced code block a link is an example, not a reference. */
function isFence(line) {
  return /^\s*(```|~~~)/.test(line);
}

/** Does this path resolve to a real file, allowing directory URLs? */
function resolveTarget(fromFile, value) {
  const clean = value.split('#')[0].split('?')[0];
  if (!clean) return { skip: true };

  const abs = path.resolve(path.dirname(fromFile), clean);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return { ok: true, target: abs };
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const hit = INDEX_FILES.map((f) => path.join(abs, f)).filter((f) => fs.existsSync(f))[0];
    if (hit) return { ok: true, target: hit };
    return { ok: false, target: abs, reason: 'directory without index.html' };
  }
  return { ok: false, target: abs, reason: 'missing file' };
}

/**
 * Is this a link into `c/<username>/`, where the stub is generated at build and
 * deploy time and deliberately gitignored? If the profile exists, the link is
 * correct and only the artifact is missing — a notice, not an error, so a fresh
 * clone passes CI before anyone runs the build.
 */
function generatedStubNotice(fromFile, target) {
  const rel = path.relative(ROOT, target).split(path.sep);
  if (rel[0] !== 'c' || rel.length < 2 || rel[1] === 'index.html') return null;
  const username = rel[1];
  const profile = path.join(ROOT, 'profile-data', username + '.json');
  if (!fs.existsSync(profile)) return null;
  return {
    file: path.relative(ROOT, fromFile),
    link: '/c/' + username + '/',
    note: 'generated by `npm run build` (and by the Pages workflow on deploy); ' +
      'profile-data/' + username + '.json exists, and 404.html serves this path either way'
  };
}

function main(argv) {
  const opts = args(argv || process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node tools/check-links.js [--json] [--strict]');
    return 0;
  }

  const files = linkableFiles(ROOT);
  const errors = [];
  const notices = [];
  let checked = 0;

  files.forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');
    extractLinks(html).forEach((link) => {
      if (isExternal(link.value)) return;
      checked++;
      const result = resolveTarget(file, link.value);
      if (result.skip || result.ok) return;

      const notice = generatedStubNotice(file, result.target);
      if (notice) { notices.push(notice); return; }

      errors.push({
        file: path.relative(ROOT, file),
        line: link.line,
        attr: link.attr,
        link: link.value,
        reason: result.reason,
        resolved: path.relative(ROOT, result.target)
      });
    });
  });

  if (opts.json) {
    console.log(JSON.stringify({
      ok: errors.length === 0,
      html_files: files.length,
      links_checked: checked,
      errors: errors,
      notices: notices
    }, null, 2));
    return errors.length || (opts.strict && notices.length) ? 1 : 0;
  }

  const pages = files.filter((f) => f.endsWith('.html')).length;
  const docs = files.length - pages;
  console.log(`check-links: ${pages} pages + ${docs} docs, ${checked} internal links`);

  if (notices.length) {
    console.log(`\n${notices.length} generated link(s) — not an error:`);
    notices.forEach((n) => console.log(`  · ${n.file} → ${n.link}\n      ${n.note}`));
  }

  if (errors.length) {
    console.error(`\n${errors.length} broken link(s):`);
    errors.forEach((e) => {
      console.error(`  ✗ ${e.file}:${e.line}  ${e.attr}="${e.link}"`);
      console.error(`      ${e.reason}: ${e.resolved}`);
    });
    console.error('\nA moved file is usually the cause. Fix the link, or add the file.');
    return 1;
  }

  if (opts.strict && notices.length) {
    console.error('\n--strict: generated stubs must exist. Run `npm run build`.');
    return 1;
  }

  console.log('  ✓ every internal link resolves');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = {
  main, extractLinks, stripScripts, resolveTarget, isExternal, linkableFiles,
  generatedStubNotice
};
