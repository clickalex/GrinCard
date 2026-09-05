#!/usr/bin/env node
/**
 * tools/install-workflows.js — copy the GitHub Actions workflows into place.
 *
 *   node tools/install-workflows.js            install, or report already-installed
 *   node tools/install-workflows.js --check    CI: fail if .github/workflows differs
 *   node tools/install-workflows.js --force    overwrite whatever is there
 *
 * Why this script exists at all
 * -----------------------------
 * GitHub only runs workflows that live in `.github/workflows/`. The canonical copies
 * in this repository are the files beside this script, and this script puts them where
 * GitHub looks.
 *
 * That indirection is not a design preference. A GitHub App installation token cannot
 * create or update a file under `.github/workflows/` unless it has been granted the
 * `workflows` permission, and the token used to build this repository does not have it:
 *
 *   ! [remote rejected] (refusing to allow a GitHub App to create or update workflow
 *     `.github/workflows/ci.yml` without `workflows` permission)
 *
 * So the workflows are committed to a path that a token is allowed to write, and you
 * install them with one command. If you are reading this in a clone where
 * `.github/workflows/` is already populated, someone with the permission did it for
 * you and this script will simply report that nothing needs doing.
 *
 * Once the workflows are in place in the upstream repository they can be deleted from
 * here — this folder exists to get them there, not to be a permanent second home.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'github-workflows');   // the canonical copies
const DEFAULT_DEST = path.join(__dirname, '..', '.github', 'workflows');

function workflowFiles() {
  return fs.readdirSync(SRC).filter(f => /\.ya?ml$/.test(f)).sort();
}

function install(options) {
  options = options || {};
  // Overridable so the test suite can exercise the whole lifecycle — missing,
  // installed, drifted, repaired — in a temp directory instead of writing into the
  // repository it is testing.
  const DEST = options.dest || DEFAULT_DEST;
  const files = workflowFiles();
  if (!files.length) {
    console.error('install-workflows: no .yml files found in ' + SRC);
    return 1;
  }

  fs.mkdirSync(DEST, { recursive: true });

  const installed = [];
  const unchanged = [];
  const drifted = [];
  const missing = [];

  files.forEach((name) => {
    const want = fs.readFileSync(path.join(SRC, name), 'utf8');
    const destPath = path.join(DEST, name);
    const have = fs.existsSync(destPath) ? fs.readFileSync(destPath, 'utf8') : null;

    if (have === null) { missing.push(name); return; }
    if (have === want) { unchanged.push(name); return; }
    drifted.push(name);
  });

  if (options.check) {
    const problems = [];
    if (missing.length) problems.push('not installed: ' + missing.join(', '));
    if (drifted.length) problems.push('differs from the canonical copy: ' + drifted.join(', '));
    if (problems.length) {
      console.error('install-workflows --check FAILED');
      problems.forEach(p => console.error('  ✗ ' + p));
      console.error('\nRun `node tools/install-workflows.js --force` to put them in place.');
      return 1;
    }
    console.log(`install-workflows: ${unchanged.length} workflow(s) installed and in sync`);
    return 0;
  }

  const toWrite = missing.concat(options.force ? drifted : []);
  toWrite.forEach((name) => {
    fs.copyFileSync(path.join(SRC, name), path.join(DEST, name));
    installed.push(name);
  });

  installed.forEach(f => console.log('  ✓ installed ' + path.join('.github/workflows', f)));
  unchanged.forEach(f => console.log('  = already in sync ' + f));
  if (!options.force && drifted.length) {
    drifted.forEach(f => console.log('  ! left alone (differs): ' + f +
      ' — re-run with --force to overwrite'));
  }

  if (!installed.length && !drifted.length) {
    console.log('install-workflows: nothing to do');
  } else if (installed.length) {
    console.log('\nCommit .github/workflows/ to turn on CI and Pages deploys.');
  }
  return 0;
}

function main(argv) {
  const args = { check: false, force: false };
  const list = argv || [];
  list.forEach((a, i) => {
    if (a === '--check') args.check = true;
    else if (a === '--force') args.force = true;
    else if (a === '--dest') args.dest = list[i + 1];
    else if (a.startsWith('--dest=')) args.dest = a.slice('--dest='.length);
    else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/install-workflows.js [--check] [--force] [--dest DIR]');
      console.log('  copies tools/github-workflows/*.yml into .github/workflows/');
      return 0;
    }
  });
  return install(args);
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, install, workflowFiles, SRC, DEST: DEFAULT_DEST };
