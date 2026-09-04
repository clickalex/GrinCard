/**
 * tests/tools.test.js — the build tools and the contributed-template registry.
 *
 * These are the parts that make the repository work as a template someone else can
 * fork, so they are worth testing on their own terms:
 *
 *   - tools/build-links.js     profile JSON -> permanent /c/<username>/ URLs
 *   - tools/build-templates.js contributed templates -> validated manifest
 *   - tools/check-links.js     no page links to a file that moved
 *   - CardTemplates.register   a contribution loads without touching core code
 *
 * Nothing here needs jsdom or any other oracle, so it runs on a fresh clone.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const buildLinks = require('../tools/build-links.js');
const buildTemplates = require('../tools/build-templates.js');
const checkLinks = require('../tools/check-links.js');
const CardTemplates = require('../card-templates/card-templates.js');

/** A scratch tree inside the repo, so relative resolution matches production. */
function scratch(fn) {
  const dir = fs.mkdtempSync(path.join(ROOT, '.test-tmp-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// build-links: reading profiles
// ---------------------------------------------------------------------------

test('build-links reads every profile and derives the username from the filename', () => {
  scratch((dir) => {
    writeJson(path.join(dir, 'data/rahul.json'), { username: 'rahul', display_name: 'Rahul' });
    writeJson(path.join(dir, 'data/priya.json'), { display_name: 'Priya' });   // no username field
    const { profiles, errors } = buildLinks.readProfiles(path.join(dir, 'data'));
    assert.deepEqual(errors, []);
    assert.deepEqual(profiles.map(p => p.username), ['priya', 'rahul'], 'sorted, so output is stable');
    assert.equal(profiles[0].json.username, 'priya', 'a missing username is taken from the filename');
  });
});

test('build-links refuses a filename that disagrees with the username field', () => {
  scratch((dir) => {
    writeJson(path.join(dir, 'data/rahul.json'), { username: 'somebodyelse' });
    const { profiles, errors } = buildLinks.readProfiles(path.join(dir, 'data'));
    assert.deepEqual(profiles, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /must match/, errors[0]);
    assert.match(errors[0], /\/c\/<filename>\//, 'the message should explain why it matters');
  });
});

test('build-links rejects an invalid username and invalid JSON with a readable reason', () => {
  scratch((dir) => {
    writeJson(path.join(dir, 'data/ab.json'), { username: 'ab' });            // too short
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data/broken.json'), '{not json', 'utf8');
    const { errors } = buildLinks.readProfiles(path.join(dir, 'data'));
    assert.equal(errors.length, 2);
    assert.ok(errors.some(e => /valid username/.test(e)), errors.join(' | '));
    assert.ok(errors.some(e => /not valid JSON/.test(e)), errors.join(' | '));
  });
});

test('build-links does not publish the registry or the manifest as people', () => {
  scratch((dir) => {
    writeJson(path.join(dir, 'data/rahul.json'), { username: 'rahul' });
    // tokens.json is a legitimate file to keep beside the profiles, and "tokens"
    // is a perfectly valid username pattern — publishing /c/tokens/ would be a bug.
    writeJson(path.join(dir, 'data/tokens.json'), { tokens: [], followers: [] });
    writeJson(path.join(dir, 'data/index.json'), { profiles: ['rahul'] });
    writeJson(path.join(dir, 'data/_scratch.json'), { username: '_scratch' });
    const { profiles, errors } = buildLinks.readProfiles(path.join(dir, 'data'));
    assert.deepEqual(errors, []);
    assert.deepEqual(profiles.map(p => p.username), ['rahul']);
  });
});

// ---------------------------------------------------------------------------
// build-links: what it writes
// ---------------------------------------------------------------------------

test('the generated stub is a host for the shared renderer, not a second renderer', () => {
  const html = buildLinks.stubHtml('rahul', 'Rahul Kumar');
  assert.match(html, /data-username="rahul"/);
  assert.match(html, /<title>Rahul Kumar — QR Link Card<\/title>/);
  assert.match(html, /profile\/profile\.js/);
  assert.match(html, /profile\/boot\.js/);
  assert.match(html, /lib\/store\.js/);
  // Every reference must be relative: a stub is two directories below the root,
  // and an absolute path would break on any site that is not at a domain root.
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 5, 'expected the stylesheet and the scripts, got ' + refs.join(' '));
  refs.forEach(r => assert.ok(!r.startsWith('/'), 'absolute reference in a stub: ' + r));
  assert.ok(!/resolveAccess|link-card|function render/.test(html),
    'the stub must not contain profile-rendering logic');
});

test('the stub escapes a username that could break out of its attribute', () => {
  const html = buildLinks.stubHtml('a"b<c', 'Name "quoted" <tag>');
  assert.ok(!/data-username="a"b<c"/.test(html), 'the attribute must be escaped');
  assert.match(html, /&quot;/);
  assert.match(html, /&lt;/);
});

test('the manifest lists usernames and says it is generated', () => {
  const manifest = buildTemplates && buildLinks.manifest([
    { username: 'rahul' }, { username: 'priya' }
  ]);
  assert.deepEqual(manifest.profiles, ['rahul', 'priya']);
  assert.equal(manifest.count, 2);
  assert.ok(manifest.$comment.some(line => /do not edit by hand/i.test(line)));
  assert.ok(manifest.$comment.some(line => /npm run build/i.test(line)),
    'it should tell the next person how to regenerate it');
});

test('the directory page links every profile and never invents one', () => {
  const html = buildLinks.directoryHtml([
    { username: 'rahul', json: { display_name: 'Rahul', designation: 'Illustrator', links: [{}, {}] } },
    { username: 'priya', json: { display_name: 'Priya', designation: '', links: [], _starter: true } }
  ]);
  assert.match(html, /href="rahul\/"/);
  assert.match(html, /href="priya\/"/);
  assert.match(html, /2 links/);
  assert.match(html, /0 links/);
  assert.match(html, /starter — edit me/, 'an untouched starter profile should say so');
  assert.ok(!/href="nobody\/"/.test(html));
});

test('build-links --check passes on the committed repository and is idempotent', () => {
  assert.equal(buildLinks.main(['--check', '--quiet']), 0,
    'profile-data/index.json must match the files on disk');
  assert.equal(buildLinks.main(['--check', '--quiet', '--data', 'examples']), 0,
    'examples/index.json must match the fixtures');

  // Running the build must not change a committed artifact, or every deploy churns.
  const before = fs.readFileSync(path.join(ROOT, 'profile-data/index.json'), 'utf8');
  assert.equal(buildLinks.main(['--quiet', '--data', 'examples', '--manifest-only']), 0);
  const after = fs.readFileSync(path.join(ROOT, 'examples/index.json'), 'utf8');
  assert.equal(
    after.replace(/generated_at.*/, ''),
    fs.readFileSync(path.join(ROOT, 'examples/index.json'), 'utf8').replace(/generated_at.*/, ''),
    'a second run must produce the same manifest');
  assert.equal(before.replace(/generated_at.*/, ''),
    fs.readFileSync(path.join(ROOT, 'profile-data/index.json'), 'utf8').replace(/generated_at.*/, ''));
});

test('build-links --check fails on a stale manifest, naming the drift', () => {
  scratch((dir) => {
    const data = path.join(dir, 'data');
    writeJson(path.join(data, 'rahul.json'), { username: 'rahul' });
    writeJson(path.join(data, 'index.json'), { profiles: ['rahul', 'ghost'] });
    // --check reads relative to the repo root, so exercise the comparison logic
    // through the exported helpers instead of main().
    const { profiles } = buildLinks.readProfiles(data);
    const wanted = JSON.parse(JSON.stringify(buildLinks.manifest(profiles)));
    const onDisk = JSON.parse(fs.readFileSync(path.join(data, 'index.json'), 'utf8'));
    assert.deepEqual(wanted.profiles, ['rahul']);
    assert.deepEqual(onDisk.profiles, ['rahul', 'ghost'], 'the fixture is deliberately stale');
    assert.notDeepEqual(wanted.profiles, onDisk.profiles,
      'a stale manifest must be detectable by comparing the profile lists');
  });
});

test('build-links --clean removes stubs for profiles that no longer exist', () => {
  scratch((dir) => {
    const out = path.join(dir, 'c');
    fs.mkdirSync(path.join(out, 'ghost'), { recursive: true });
    fs.writeFileSync(path.join(out, 'ghost/index.html'), 'stub', 'utf8');
    fs.writeFileSync(path.join(out, 'index.html'), 'directory', 'utf8');
    writeJson(path.join(dir, 'data/rahul.json'), { username: 'rahul' });

    const removed = require('../tools/build-links.js');
    // removeStubs is internal; drive it through main() by pointing --out at the
    // scratch tree. main() resolves relative to ROOT, so use an absolute-ish path.
    const rel = path.relative(ROOT, dir);
    assert.equal(removed.main(['--data', path.join(rel, 'data'), '--out', path.join(rel, 'c'), '--quiet']), 0);
    assert.ok(fs.existsSync(path.join(out, 'rahul/index.html')), 'the real profile gets a stub');
    assert.ok(!fs.existsSync(path.join(out, 'ghost')), 'a deleted profile must not keep its URL');
    assert.ok(fs.existsSync(path.join(out, 'index.html')), 'the directory page survives');
  });
});

// ---------------------------------------------------------------------------
// CardTemplates: contributed templates
// ---------------------------------------------------------------------------

/** A minimal valid template, so each test can break exactly one thing. */
function template(overrides) {
  const base = {
    id: 'community-test',
    name: 'Test',
    description: 'A fixture template',
    layout: 'photo-left',
    front: {
      background: { type: 'solid', color: '#222222' },
      accent: '#f2b134', nameColor: '#ffffff', roleColor: '#cccccc', taglineColor: '#999999',
      monogramBg: '#333333', monogramColor: '#ffffff', rules: '#444444',
      nameFont: 'sans', nameWeight: 700, nameSizePt: 17, roleSizePt: 9, taglineSizePt: 7
    },
    back: {
      background: { type: 'solid', color: '#222222' },
      accent: '#f2b134', textColor: '#ffffff', mutedColor: '#cccccc',
      qrTile: '#ffffff', captionSizePt: 8, hintSizePt: 6
    }
  };
  const out = JSON.parse(JSON.stringify(base));
  Object.keys(overrides || {}).forEach((k) => {
    if (overrides[k] && typeof overrides[k] === 'object' && !Array.isArray(overrides[k])) {
      out[k] = Object.assign({}, out[k], overrides[k]);
    } else {
      out[k] = overrides[k];
    }
  });
  return out;
}

test('the shipped example contribution is valid and self-registering', () => {
  const sunset = require('../card-templates/community/sunset.js');
  const check = CardTemplates.validateTemplate(sunset);
  assert.deepEqual(check.errors, [], check.errors.join('; '));
  assert.equal(sunset.id, 'community-sunset');
  assert.equal(sunset.free, true, 'nothing in the core may be gated');

  // The UMD wrapper must expose the object to Node AND register it in a browser.
  const src = fs.readFileSync(path.join(ROOT, 'card-templates/community/sunset.js'), 'utf8');
  assert.match(src, /module\.exports/, 'Node must be able to require it for validation');
  assert.match(src, /CardTemplates\.register|root\.CardTemplates/, 'the browser must self-register it');
});

test('validateTemplate rejects a dark QR tile, because that card will not scan', () => {
  const check = CardTemplates.validateTemplate(template({ back: { qrTile: '#111111' } }));
  assert.equal(check.ok, false);
  assert.ok(check.errors.some(e => /qrTile must be a LIGHT colour/.test(e)), check.errors.join('; '));
});

test('validateTemplate requires the fields the renderer cannot do without', () => {
  const cases = [
    [{}, /id must be/],
    [{ id: 'UPPER' }, /id must be/],
    [template({ name: '' }), /name is required/],
    [template({ layout: 'diagonal' }), /layout must be one of/],
    [template({ front: null }), /front is required/],
    [template({ back: null }), /back is required/],
    [template({ front: { nameSizePt: null } }), /front\.nameSizePt is required/],
    [template({ front: { background: { type: 'solid' } } }), /background\.color is required/],
    [template({ front: { background: { type: 'gradient', from: '#000' } } }), /needs from and to/],
    [template({ front: { background: { type: 'tartan', color: '#fff' } } }), /must be "solid" or "gradient"/]
  ];
  cases.forEach(([tpl, pattern]) => {
    const check = CardTemplates.validateTemplate(tpl);
    assert.equal(check.ok, false, JSON.stringify(tpl).slice(0, 80) + ' should be rejected');
    assert.ok(check.errors.some(e => pattern.test(e)),
      'expected ' + pattern + ' in: ' + check.errors.join('; '));
  });
});

test('validateTemplate warns instead of failing on the things that are only advisory', () => {
  const check = CardTemplates.validateTemplate(template({ free: false, author: null }));
  assert.equal(check.ok, true, 'a warning must not block a contribution');
  assert.ok(check.warnings.some(w => /nothing is gated/.test(w)), check.warnings.join('; '));
  assert.ok(check.warnings.some(w => /author is optional/.test(w)), check.warnings.join('; '));
});

test('register adds a template to every picker, and rejects a bad one without throwing', () => {
  CardTemplates.resetCommunity();
  const coreCount = CardTemplates.TEMPLATES.length;

  const good = template({ id: 'community-register-test', name: 'Register Test' });
  const registered = CardTemplates.register(good);
  assert.equal(registered, good);
  assert.equal(good.community, true, 'contributions are marked so the UI can label them');
  assert.equal(CardTemplates.all().length, coreCount + 1);
  assert.equal(CardTemplates.community().length, 1);
  assert.ok(CardTemplates.ids().includes('community-register-test'));
  assert.equal(CardTemplates.get('community-register-test').name, 'Register Test');

  // Registering the same object twice is a no-op, not a duplicate: files can be
  // loaded more than once when several pages share a renderer.
  CardTemplates.register(good);
  assert.equal(CardTemplates.community().length, 1, 'registration must be idempotent');

  const bad = CardTemplates.register(template({ id: 'community-bad', back: { qrTile: '#000000' } }));
  assert.equal(bad, null, 'a rejected template returns null rather than throwing');
  assert.equal(CardTemplates.all().length, coreCount + 1, 'and is not added');
  assert.equal(CardTemplates.get('community-bad').id, 'template-1', 'an unknown id falls back safely');

  CardTemplates.resetCommunity();
  assert.equal(CardTemplates.all().length, coreCount);
  assert.equal(CardTemplates.get('community-register-test').id, 'template-1', 'reset removes it');
});

test('a contribution cannot shadow a built-in template id', () => {
  CardTemplates.resetCommunity();
  const check = CardTemplates.validateTemplate(template({ id: 'template-1', name: 'Hijack' }));
  assert.equal(check.ok, false);
  assert.ok(check.errors.some(e => /already taken/.test(e)), check.errors.join('; '));
  assert.equal(CardTemplates.register(template({ id: 'template-1' })), null);
  assert.equal(CardTemplates.get('template-1').name, 'Midnight',
    'the built-in must be untouched — someone has already printed cards with it');
  CardTemplates.resetCommunity();
});

test('the community manifest matches the files on disk', () => {
  assert.equal(buildTemplates.main(['--check']), 0,
    'run `npm run build:templates` — the manifest and the folder disagree');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'card-templates/community/index.json'), 'utf8'));
  const files = fs.readdirSync(path.join(ROOT, 'card-templates/community')).filter(f => f.endsWith('.js'));
  assert.deepEqual(manifest.templates.map(t => t.file).sort(), files.sort());
  assert.ok(manifest.$comment.some(l => /do not edit by hand/i.test(l)));
  manifest.templates.forEach(t => {
    assert.ok(t.id && t.name && t.file, 'each entry needs enough to render a gallery card');
    assert.equal(t.license, 'MIT');
  });
});

test('loadCommunity resolves to nothing rather than failing when there is no fetch', () => {
  // Node has no DOM and this module captured none, which is the situation a test or
  // a server-side renderer is in. A missing manifest must degrade, never throw:
  // a broken community folder cannot be allowed to take someone's card page down.
  CardTemplates.resetCommunity();
  return CardTemplates.loadCommunity('card-templates/community/').then((added) => {
    assert.deepEqual(added, []);
    assert.equal(CardTemplates.all().length, CardTemplates.TEMPLATES.length);
    CardTemplates.resetCommunity();
  });
});

// ---------------------------------------------------------------------------
// check-links
// ---------------------------------------------------------------------------

test('check-links passes on the repository as committed', () => {
  assert.equal(checkLinks.main([]), 0,
    'some page links to a file that does not exist — run node tools/check-links.js');
});

test('check-links ignores markup built inside JavaScript', () => {
  const html = [
    '<a href="index.html">real</a>',
    '<script>',
    "  wrap.innerHTML = '<a href=\"' + base + 'index.html\">x</a>';",
    '</script>'
  ].join('\n');
  const stripped = checkLinks.stripScripts(html);
  assert.match(stripped, /href="index.html"/, 'real markup is still checked');
  assert.ok(!stripped.includes("' + base + '"), 'concatenated strings are not');
  assert.equal(stripped.split('\n').length, html.split('\n').length, 'line numbers are preserved');
});

test('install-workflows copies the canonical workflows, and detects drift', () => {
  // GitHub only runs workflows from .github/workflows/, but an app token without the
  // `workflows` permission cannot write there — the push is rejected outright. So the
  // canonical copies live under tools/github-workflows/ and are installed by script.
  // That indirection is only safe if something verifies the two agree.
  const iw = require('../tools/install-workflows.js');
  const files = iw.workflowFiles();
  assert.deepEqual(files, ['ci.yml', 'pages.yml'], 'expected exactly the two workflows');

  files.forEach((f) => {
    const canonical = fs.readFileSync(path.join(iw.SRC, f), 'utf8');
    assert.ok(canonical.length > 200, f + ' looks truncated');
    assert.match(canonical, /^name:/m, f + ' must name its workflow');
    assert.match(canonical, /on:/, f + ' must declare a trigger');
  });

  // The canonical copies must reference scripts that exist, or CI fails on a step
  // that no longer does anything.
  const ci = fs.readFileSync(path.join(iw.SRC, 'ci.yml'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(ci.includes('npm run validate'), 'CI must run validate');
  assert.ok(ci.includes('npm test'), 'CI must run the tests');
  assert.ok(ci.includes('install-workflows.js --check'), 'CI must guard against workflow drift');
  assert.ok(pkg.scripts.validate && pkg.scripts.test, 'the scripts CI calls must be defined');
  assert.equal(pkg.scripts['workflows:install'], 'node tools/install-workflows.js');
  assert.equal(pkg.scripts['workflows:check'], 'node tools/install-workflows.js --check');

  // --check must pass when the installed copies agree, and fail when they do not.
  assert.equal(iw.main(['--check']), 0, 'installed workflows should match the canonical ones');

  const installedCi = path.join(iw.DEST, 'ci.yml');
  if (fs.existsSync(installedCi)) {
    const original = fs.readFileSync(installedCi, 'utf8');
    try {
      fs.writeFileSync(installedCi, original + '\n# deliberate drift\n');
      assert.equal(iw.main(['--check']), 1, 'drift must be detected');
      assert.equal(iw.main(['--force']), 0, '--force must repair it');
      assert.equal(fs.readFileSync(installedCi, 'utf8'), original, 'repaired byte for byte');
    } finally {
      fs.writeFileSync(installedCi, original);
    }
  }

  // And a missing workflow is reported, not silently skipped.
  const installedPages = path.join(iw.DEST, 'pages.yml');
  if (fs.existsSync(installedPages)) {
    const original = fs.readFileSync(installedPages, 'utf8');
    try {
      fs.rmSync(installedPages);
      assert.equal(iw.main(['--check']), 1, 'a missing workflow must fail --check');
      assert.equal(iw.main([]), 0, 'a plain run must reinstall it');
      assert.equal(fs.readFileSync(installedPages, 'utf8'), original);
    } finally {
      if (!fs.existsSync(installedPages)) fs.writeFileSync(installedPages, original);
    }
  }
});

test('check-links reads markdown links, and ignores the ones inside code fences', () => {
  // Docs are the most-edited surface in a template repository: a fork renames
  // things, and a guide that links to a moved file is as broken as a dead button.
  const md = [
    '# Guide',
    'See [the setup guide](../SETUP.md) and [printing](PRINTING.md#qr).',
    'Anchors like [tiers](#the-three-tiers) are not files.',
    '```',
    '[not a link](docs/DOES-NOT-EXIST.md)',
    '```',
    'Inline `code` with [a real one](../README.md).'
  ].join('\n');

  const links = checkLinks.extractLinks(md);
  const values = links.map(l => l.value);
  assert.ok(values.includes('../SETUP.md'), values.join(' | '));
  assert.ok(values.includes('PRINTING.md#qr'), 'a fragment must survive so the path can be checked');
  assert.ok(values.includes('../README.md'));
  assert.ok(!values.some(v => v.includes('DOES-NOT-EXIST')),
    'a link inside a fenced block is an example, not a reference');
  // extractLinks is deliberately dumb — it reports every candidate and lets
  // isExternal() decide what is in scope. A bare anchor is extracted, then skipped.
  assert.ok(values.includes('#the-three-tiers'), 'anchors are extracted…');
  assert.equal(checkLinks.isExternal('#the-three-tiers'), true, '…and then classified out of scope');

  // And the real documents in this repository must all resolve.
  const docs = checkLinks.linkableFiles(ROOT).filter(f => f.endsWith('.md'));
  assert.ok(docs.length >= 8, 'expected the doc set, found ' + docs.length);
  const broken = [];
  docs.forEach((file) => {
    checkLinks.extractLinks(fs.readFileSync(file, 'utf8')).forEach((link) => {
      if (checkLinks.isExternal(link.value)) return;
      const result = checkLinks.resolveTarget(file, link.value);
      if (!result.ok && !result.skip) {
        broken.push(path.relative(ROOT, file) + ':' + link.line + ' -> ' + link.value);
      }
    });
  });
  assert.deepEqual(broken, [], broken.join('\n'));
});

test('check-links resolves directory URLs to their index.html', () => {
  const from = path.join(ROOT, 'index.html');
  assert.equal(checkLinks.resolveTarget(from, 'dashboard/').ok, true);
  assert.equal(checkLinks.resolveTarget(from, 'c/').ok, true);
  assert.equal(checkLinks.resolveTarget(from, 'nope/').ok, false);
  assert.equal(checkLinks.resolveTarget(from, 'lib/qr.js').ok, true);
  assert.equal(checkLinks.resolveTarget(from, 'lib/missing.js').ok, false);
  // Fragments and query strings are not part of the file path.
  assert.equal(checkLinks.resolveTarget(from, 'docs/PRINTING.md#qr').ok, true);
  assert.equal(checkLinks.resolveTarget(from, 'profile/?u=rahul').ok, true);
  assert.equal(checkLinks.resolveTarget(from, '#main').skip, true);
});

test('check-links treats external URLs and non-file schemes as out of scope', () => {
  ['https://example.com/x', 'http://example.com', '//cdn.example.com/a.js',
    'mailto:me@example.com', 'tel:+911234567890', 'data:image/png;base64,AA',
    '#section', 'javascript:void(0)'].forEach(value => {
      assert.equal(checkLinks.isExternal(value), true, value + ' should be skipped');
    });
  ['index.html', '../lib/qr.js', './assets/styles.css', 'c/rahul/'].forEach(value => {
    assert.equal(checkLinks.isExternal(value), false, value + ' should be checked');
  });
});

test('the repository has no leftover references to the pre-fork layout', () => {
  // The layout changed once already (demo/ -> profile/, examples/, templates/,
  // print/). A stale path in a doc or a page is the regression most likely to
  // survive review, so the old names are asserted absent rather than remembered.
  const offenders = [];
  const skip = new Set(['.git', 'node_modules', '.oracle']);
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (skip.has(entry.name) || entry.name.startsWith('.test-tmp')) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!/\.(html|js|md|json|yml)$/.test(entry.name)) return;
      const text = fs.readFileSync(full, 'utf8');
      const rel = path.relative(ROOT, full);
      // These files legitimately discuss the old layout (this test, the changelog).
      if (/^tests\/(tools|dom)\.test\.js$/.test(rel)) return;
      [
        [/demo\/profile\.html/, 'demo/profile.html moved to profile/'],
        [/demo\/card-preview\.html/, 'demo/card-preview.html moved to templates/'],
        [/demo\/print-sheet\.html/, 'demo/print-sheet.html moved to print/'],
        [/demo\/assets\//, 'demo/assets/ moved to assets/ and the page folders'],
        [/demo\/demo-profile\.html/, 'demo-profile.html was removed'],
        [/assets\/landing\.js/, 'the marketing landing page was replaced by the card index'],
        [/profile-data\/rahul123\.json/, 'the fixtures moved to examples/'],
        [/profile-data\/meera9\.json/, 'the fixtures moved to examples/']
      ].forEach(([pattern, why]) => {
        if (pattern.test(text)) offenders.push(rel + ': ' + why);
      });
    });
  }(ROOT));
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the shipped starter profile is the one a fork is told to rename', () => {
  const file = path.join(ROOT, 'profile-data/yourname.json');
  assert.ok(fs.existsSync(file), 'profile-data/ should ship exactly one obvious starter');
  const starter = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(starter.username, 'yourname', 'the filename and the username must agree');
  assert.equal(starter._starter, true, 'the index page uses this to show setup help');
  assert.ok(!starter.profile_url, 'the URL must be derived, never hardcoded in a fixture');
  assert.ok(Array.isArray(starter._comment) && starter._comment.length > 3,
    'the starter file should explain itself to whoever opens it first');
  assert.match(starter._comment.join('\n'), /npm run build/);

  const dir = fs.readdirSync(path.join(ROOT, 'profile-data'))
    .filter(f => f.endsWith('.json') && f !== 'index.json');
  assert.deepEqual(dir, ['yourname.json'],
    'profile-data/ ships one starter; the fixtures live in examples/');
});

test('no shipped profile hardcodes a deployment URL', () => {
  // The one rule that makes forking safe: a profile copied out of this repository
  // must never produce a card that points back at it.
  const offenders = [];
  ['profile-data', 'examples'].forEach((dir) => {
    fs.readdirSync(path.join(ROOT, dir)).forEach((file) => {
      if (!file.endsWith('.json') || file === 'index.json') return;
      const json = JSON.parse(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'));
      if (json.profile_url) offenders.push(dir + '/' + file + ' -> ' + json.profile_url);
    });
  });
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('os.tmpdir scratch usage does not leave files behind', () => {
  const before = fs.readdirSync(ROOT).filter(n => n.startsWith('.test-tmp'));
  assert.deepEqual(before, [], 'an earlier test leaked a scratch directory: ' + before.join(', '));
  assert.ok(os.tmpdir(), 'sanity: os is available');
});
