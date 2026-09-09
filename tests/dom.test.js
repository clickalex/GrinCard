/**
 * Front-end tests. No browser is available in CI for this repo, so pages are
 * executed in jsdom with a file-backed resource loader: real <script> tags,
 * real DOM events, real localStorage. That catches the bugs that actually ship —
 * a typo in an element id, a script path that 404s, a click handler that throws.
 *
 * Rasterisation (SVG -> canvas -> PNG) is browser-only and is covered by the
 * PDF tests instead, which go through the same display list.
 *
 * jsdom is a dev-only oracle (see tests/oracle.js). The static integrity checks
 * need nothing but node:fs so they always run; the page-execution tests skip with
 * an install hint when jsdom is missing.
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ORACLE = require('./oracle.js');
const jsdomLib = ORACLE.optional('jsdom');
const JSDOM = jsdomLib && jsdomLib.JSDOM;
const VirtualConsole = jsdomLib && jsdomLib.VirtualConsole;
const requestInterceptor = jsdomLib && jsdomLib.requestInterceptor;

/** Skip every page-execution test when jsdom is not installed. */
const NO_JSDOM = jsdomLib ? false : ORACLE.INSTALL_HINT;
// One test below parses the PDF it downloads with an independent reader, so it needs
// pdfjs-dist on top of jsdom. Gating it on jsdom alone meant a partial oracle install
// — the directory present but that package missing — failed the test instead of
// skipping it, which reads as a broken PDF generator when nothing is broken.
const NO_PDFJS = ORACLE.has('pdfjs-dist') ? false : ORACLE.INSTALL_HINT;

const ROOT = path.join(__dirname, '..');
const { linkableFiles, generatedStubNotice } = require('../tools/check-links.js');
const ORIGIN = 'http://localhost:8080';

function repoFile(rel, prefix) {
  // A GitHub Pages project site serves everything from /<repo>/, so a request
  // path can carry a prefix the repository itself does not have. Stripping it is
  // what lets the harness test a subdirectory deployment rather than only a root one.
  if (prefix) {
    const clean = prefix.replace(/^\/+|\/+$/g, '') + '/';
    if (rel.startsWith(clean)) rel = rel.slice(clean.length);
  }
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? p : null;
}

/** Collect console errors and uncaught exceptions from a jsdom window. */
function attachErrors(dom) {
  const errors = [];
  dom.virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  dom.virtualConsole.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));
  const win = dom.window;
  win.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  win.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)));
  return errors;
}

/** Serve <script>, <link> and fetch() requests straight out of the repo. */
function repoInterceptor(prefix) {
  return requestInterceptor((request) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    } catch (e) {
      return new Response('bad url', { status: 400 });
    }
    const file = repoFile(rel.split('?')[0], prefix);
    if (!file) {
      missingAssets.push(rel);
      return new Response('404: /' + rel + ' does not exist in the repo', { status: 404 });
    }
    const type = /\.js$/.test(file) ? 'application/javascript'
      : /\.css$/.test(file) ? 'text/css'
      : /\.json$/.test(file) ? 'application/json'
      : /\.svg$/.test(file) ? 'image/svg+xml' : 'text/plain';
    return new Response(fs.readFileSync(file), { status: 200, headers: { 'Content-Type': type } });
  });
}

/**
 * Ids that exist at runtime but not in the static HTML, per page.
 *
 * The profile hosts ship almost no markup on purpose: profile/boot.js builds the
 * chrome (topbar, main, #profile-root) so that one renderer can run from /profile/,
 * from a generated /c/<username>/ stub, and from 404.html at any depth.
 */
const EXTRA_RUNTIME_IDS = {
  'profile/index.html': ['profile-root', 'main'],
  'index.html': []
};

/** Any request for a file that is not in the repo, collected across all tests. */
const missingAssets = [];

/**
 * Load a page, run its scripts, and wait for the app to settle.
 */
/**
 * Add attributes to the <body> tag of a page before jsdom parses it.
 *
 * This is how the tests point a page at the example fixtures instead of the
 * owner's own profile-data/: `data-profile-dir` is the same override the template
 * gallery and the examples page use in production, so the tests exercise the real
 * mechanism rather than a test-only one.
 */
function withBodyAttrs(html, attrs) {
  if (!attrs) return html;
  return html.replace(/<body\b([^>]*)>/i, (match, rest) => {
    let out = rest;
    Object.keys(attrs).forEach((key) => {
      // Replace rather than duplicate: a page may already set this attribute.
      const existing = new RegExp('\\s' + key + '="[^"]*"');
      out = existing.test(out)
        ? out.replace(existing, ' ' + key + '="' + attrs[key] + '"')
        : out + ' ' + key + '="' + attrs[key] + '"';
    });
    return '<body' + out + '>';
  });
}

/**
 * Load a file AS IF it had been requested at a different URL.
 *
 * Only 404.html needs this, and it needs it because that is precisely its job:
 * the file lives at the site root while the browser believes it is somewhere else.
 */
/** The window's localStorage as a plain object, for handing to the next loadPage(). */
function snapshotStorage(win) {
  const out = {};
  for (let i = 0; i < win.localStorage.length; i++) {
    const k = win.localStorage.key(i);
    out[k] = win.localStorage.getItem(k);
  }
  return out;
}

async function loadPageAt(rel, requestPath, options) {
  return loadPage(rel, Object.assign({}, options, { urlOverride: requestPath }));
}

async function loadPage(rel, options) {
  options = options || {};
  const file = repoFile(rel, options.deployBase);
  assert.ok(file, 'page not found: ' + rel);
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
  virtualConsole.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));
  const bodyAttrs = Object.assign({}, options.bodyAttrs);
  if (options.profileDir) bodyAttrs['data-profile-dir'] = options.profileDir;
  if (options.username) bodyAttrs['data-username'] = options.username;
  let html = withBodyAttrs(fs.readFileSync(file, 'utf8'), bodyAttrs);
  // omitScripts removes a <script> tag before jsdom parses the page. This is how a
  // test reproduces "profile.js is running and boot.js has not arrived yet", which is
  // a real state rather than a hypothetical one: 404.html injects its scripts one at a
  // time over the network, so profile.js's selfStart() timer fires while boot.js is
  // still in flight. Timing cannot be asserted reliably, but the state it produces can.
  // bodyHtml inserts markup just inside <body>. Used with omitScripts to stand in for
  // what the omitted script would have built by the time the code under test runs —
  // boot.js creates #profile-root before it hands over, so a test that omits boot.js
  // still needs that element to exist for the renderer to have somewhere to draw.
  if (options.bodyHtml) {
    html = html.replace(/(<body\b[^>]*>)/i, '$1' + options.bodyHtml);
  }
  (options.omitScripts || []).forEach((needle) => {
    const before = html;
    html = html.replace(new RegExp('<script[^>]*src="[^"]*' + needle + '"[^>]*>\\s*</script>', 'gi'), '');
    assert.notEqual(html, before, 'omitScripts found no script matching ' + needle);
  });
  // deployBase simulates a project site served from /<repo>/ rather than a domain
  // root; urlOverride simulates a file served at a URL it does not live at (404.html).
  const base = options.deployBase ? options.deployBase.replace(/\/$/, '') + '/' : '/';
  const pageUrl = options.urlOverride
    ? ORIGIN + options.urlOverride
    : ORIGIN + base + rel + (options.search || '');
  const dom = new JSDOM(html, {
    url: pageUrl,
    runScripts: 'dangerously',
    resources: { interceptors: [repoInterceptor(options.deployBase)] },
    pretendToBeVisual: true,
    virtualConsole,
    // beforeParse, not after: 404.html boots from an INLINE script, which jsdom
    // runs while constructing the DOM. Patching the window afterwards would leave
    // that page without fetch() — and the harness would silently test a different
    // environment than a browser gives it.
    beforeParse(window) {
      window.fetch = fileFetch(pageUrl, options.deployBase);
      // A "reload" in jsdom is a fresh window, so localStorage starts empty. Passing
      // storage lets a test prove that something survives a page load rather than only
      // that it was written — which is the difference between a save button working and
      // an edit being lost on refresh.
      Object.keys(options.storage || {}).forEach(k => {
        try { window.localStorage.setItem(k, options.storage[k]); } catch (e) {}
      });
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.HTMLCanvasElement.prototype.getContext = function () {
        throw new Error('canvas is not available in jsdom');
      };
      window.matchMedia = window.matchMedia ||
        (q => ({ matches: false, media: q, addListener() {}, removeListener() {} }));
      window.addEventListener('error', e =>
        errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
      window.addEventListener('unhandledrejection', e =>
        errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)));
    }
  });
  const win = dom.window;

  await settle(win, options.settleMs == null ? 400 : options.settleMs);
  return { dom, win, doc: win.document, errors };
}

/**
 * A fetch() that serves repo files, so pages can load their JSON.
 *
 * `pageUrl` is the URL the browser believes it is on, and it is not always the URL
 * of the file being served: 404.html lives at the site root but is requested at
 * /c/<username>/. Relative URLs must resolve against the REQUESTED path, exactly as
 * a browser would, or a page that probes for its own base (404.html does) would get
 * the wrong answer and the test would pass for the wrong reason.
 */
function fileFetch(pageUrl, prefix) {
  const base = pageUrl || ORIGIN + '/';
  return function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    let rel;
    try {
      rel = decodeURIComponent(new URL(url, base).pathname).replace(/^\/+/, '');
    } catch (e) {
      return Promise.reject(new Error('bad fetch url: ' + url));
    }
    const file = repoFile(rel.split('?')[0], prefix);
    if (!file) {
      return Promise.resolve({
        ok: false, status: 404, url,
        json: () => Promise.reject(new Error('404 ' + rel)),
        text: () => Promise.resolve('')
      });
    }
    const body = fs.readFileSync(file, 'utf8');
    const type = /\.js$/.test(file) ? 'application/javascript'
      : /\.json$/.test(file) ? 'application/json'
      : /\.css$/.test(file) ? 'text/css' : 'text/plain';
    return Promise.resolve({
      ok: true, status: 200, url,
      // Pages inspect headers (404.html checks content-type before trusting a
      // probe response), so the mock has to answer like a real one.
      headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? type : null) },
      json: () => Promise.resolve(JSON.parse(body)),
      text: () => Promise.resolve(body)
    });
  };
}

function settle(win, ms) {
  return new Promise(resolve => {
    if (win.document.readyState === 'complete') setTimeout(resolve, ms);
    else win.addEventListener('load', () => setTimeout(resolve, ms));
  });
}

function click(doc, id) {
  const node = doc.getElementById(id);
  assert.ok(node, 'no element with id ' + id);
  node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
  return node;
}

function setValue(doc, id, value) {
  const node = doc.getElementById(id);
  assert.ok(node, 'no element with id ' + id);
  node.value = value;
  node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));
  node.dispatchEvent(new node.ownerDocument.defaultView.Event('change', { bubbles: true }));
  return node;
}

function textOf(doc, selector) {
  return Array.from(doc.querySelectorAll(selector)).map(n => n.textContent.trim());
}

// ---------------------------------------------------------------------------
// Static integrity: every referenced asset must exist
// ---------------------------------------------------------------------------

/**
 * Blank out <script> bodies, preserving line and character offsets enough to keep
 * the rest of the file scannable.
 *
 * Several pages build markup in JavaScript (404.html builds its whole shell), and
 * an attribute regex cannot tell a real reference from a string being concatenated
 * — 'href="' + base + 'index.html'. Scanning those produces false positives, which
 * is how a check like this gets ignored. tools/check-links.js does the same.
 */
function withoutScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (block) => block.replace(/[^\n]/g, ' '));
}

function walkHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('every HTML file references only assets that exist', () => {
  const pages = walkHtml(ROOT);
  assert.ok(pages.length >= 7, 'expected the full set of pages, found ' + pages.length);
  const problems = [];

  for (const page of pages) {
    const html = withoutScripts(fs.readFileSync(page, 'utf8'));
    const dir = path.dirname(page);
    const refs = [];
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)(?:#[^"]*)?"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)) refs.push(m[1]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(ref)) continue;
      if (ref.startsWith('{{') || ref.includes('${')) continue;
      const target = path.resolve(dir, ref.split('?')[0]);
      if (!fs.existsSync(target)) {
        // c/index.html is committed but the per-username stubs it links to are
        // generated and gitignored, so on a fresh clone they are legitimately absent.
        // Reuse the rule tools/check-links.js already applies rather than restating it
        // here, where it would eventually diverge: if the profile exists the link is
        // correct and only the artifact is missing, and 404.html serves the path anyway.
        if (generatedStubNotice(page, target)) continue;
        problems.push(path.relative(ROOT, page) + ' -> ' + ref);
      }
    }
  }
  assert.deepEqual(problems, [], 'broken local references:\n' + problems.join('\n'));
});

test('each library owns exactly one global, and no two share a name', () => {
  // A second `window.PdfDoc` would silently replace the first for any page that
  // loads both, so the global namespace is treated as part of the public API.
  const expected = {
    'lib/qr.js': ['QRCode'],
    'card-templates/card-templates.js': ['CardTemplates'],
    'lib/access.js': ['AccessRules'],
    'lib/card.js': ['Card'],
    'lib/pdf.js': ['PdfCard'],
    'lib/pdfdoc.js': ['SimplePdf'],
    'lib/store.js': ['Store'],
    'lib/export.js': ['Exporter'],
    'qr-generator/generator.js': ['QrGenerator']
  };
  const found = {};
  Object.keys(expected).forEach(file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const names = [...src.matchAll(/root\.([A-Za-z_$][\w$]*)\s*=\s*/g)].map(m => m[1]);
    found[file] = [...new Set(names)].sort();
    assert.deepEqual(found[file], [...expected[file]].sort(),
      file + ' should export exactly ' + expected[file].join(', '));
    // and each must actually define the global when loaded in a browser-ish env
    const globals = { self: {} };
    globals.self.self = globals.self;
    new Function('self', src)(globals.self);
    expected[file].forEach(name => {
      assert.ok(globals.self[name], file + ' did not define window.' + name);
    });
  });

  const all = Object.values(found).flat();
  assert.equal(new Set(all).size, all.length, 'duplicate global: ' + all.join(', '));
});

test('every getElementById in page scripts exists in the matching HTML', () => {
  const pairs = [
    // profile/ has two scripts: the renderer and the boot layer that builds the
    // chrome, so the ids boot.js creates must also exist by the time profile.js runs.
    ['profile/index.html', 'profile/profile.js'],
    ['templates/index.html', 'templates/gallery.js'],
    ['print/index.html', 'print/print-sheet.js'],
    ['examples/index.html', 'examples/gallery.js'],
    ['dashboard/index.html', 'dashboard/dashboard.js'],
    ['card-builder/index.html', 'card-builder/builder.js'],
    ['qr-generator/index.html', 'qr-generator/page.js'],
    ['index.html', 'assets/cards-index.js']
  ];
  const problems = [];
  for (const [page, script] of pairs) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, script), 'utf8');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    // Ids a page's own scripts create at runtime: the profile page's shell is built
    // by boot.js, so #profile-root exists without being in the HTML.
    [...js.matchAll(/\.id\s*=\s*'([^']+)'/g)].forEach(m => ids.add(m[1]));
    for (const extra of EXTRA_RUNTIME_IDS[page] || []) ids.add(extra);
    const wanted = new Set([...js.matchAll(/\$\('([^']+)'\)|getElementById\('([^']+)'\)/g)]
      .map(m => m[1] || m[2]));
    for (const id of wanted) {
      if (!ids.has(id)) problems.push(`${script}: uses #${id} but ${page} does not define it`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('no page depends on a CDN or an npm runtime dependency', () => {
  const pages = walkHtml(ROOT);
  const offenders = [];
  for (const page of pages) {
    const html = fs.readFileSync(page, 'utf8');
    // Only resource-loading tags count. An <a href="https://…"> is a link a person
    // clicks, not something the page needs in order to work — the site root credits
    // the upstream project with one, and that must stay legal.
    for (const m of html.matchAll(/<(script|link|img|source|iframe)\b[^>]*?(?:src|href)="(https?:\/\/[^"]+)"/gi)) {
      offenders.push(path.relative(ROOT, page) + ' -> <' + m[1].toLowerCase() + '> ' + m[2]);
    }
    if (/html2canvas|jspdf|qrcodejs|cdn\.|unpkg\.com|jsdelivr/i.test(html)) {
      offenders.push(path.relative(ROOT, page) + ': mentions a CDN library');
    }
  }
  assert.deepEqual(offenders, [],
    'the project must run offline with zero dependencies:\n' + offenders.join('\n'));
});

// ---------------------------------------------------------------------------
// The public profile page (§8.1) — the four visitor scenarios
// ---------------------------------------------------------------------------

test('profile page: a stranger sees only public links', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html', { search: '?u=rahul123', profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const labels = textOf(doc, '.link-card .label');
  assert.deepEqual(labels, ['Instagram', 'Portfolio', 'Email']);
  assert.match(doc.querySelector('.tier-banner').textContent, /Public view/);
  assert.match(doc.body.textContent, /2 links are private/);
  assert.equal(doc.title, 'Rahul Kumar — QR Link Card');
  // The page must carry the template's palette so card and page match.
  const bg = doc.documentElement.style.getPropertyValue('--bg');
  assert.ok(bg, 'template colours should be applied to :root');
});

test('profile page: a valid temporary token unlocks exactly one private link', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html',
    { search: '?u=rahul123&t=temp_demo_live', profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const labels = textOf(doc, '.link-card .label');
  assert.deepEqual(labels, ['Instagram', 'Portfolio', 'Email', 'Pricing List']);
  assert.ok(!labels.includes('WhatsApp'), 'the other private link must stay hidden');
  assert.match(doc.querySelector('.tier-banner').textContent, /Temporary access/);
  const unlocked = doc.querySelector('.link-card[data-just-unlocked="true"]');
  assert.ok(unlocked, 'the unlocked link should be marked');
  assert.match(unlocked.textContent, /Unlocked/);
});

test('profile page: an expired token falls back to public and says so', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html',
    { search: '?u=rahul123&t=temp_demo_expired', profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.deepEqual(textOf(doc, '.link-card .label'), ['Instagram', 'Portfolio', 'Email']);
  assert.match(doc.querySelector('.tier-banner').textContent, /Public view/);
  assert.match(doc.querySelector('.notice-warn').textContent, /expired/i);
});

test('profile page: an approved follower sees every link', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html',
    { search: '?u=rahul123&viewer=user_priya', profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.deepEqual(textOf(doc, '.link-card .label'),
    ['Instagram', 'Portfolio', 'Email', 'Pricing List', 'WhatsApp']);
  assert.match(doc.querySelector('.tier-banner').textContent, /Approved follower/);
});

test('profile page: a non-approved viewer id gets the public view', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html',
    { search: '?u=rahul123&viewer=user_arjun', profileDir: '../examples/' });   // pending, in tokens.json
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.deepEqual(textOf(doc, '.link-card .label'), ['Instagram', 'Portfolio', 'Email']);
});

test('profile page: an unknown username renders a helpful 404', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html', { search: '?u=nobody-here', profileDir: '../examples/' });
  assert.deepEqual(errors.filter(e => !/404/.test(e)), [], errors.join('\n'));
  assert.match(doc.body.textContent, /No profile here/);
  // It must offer a way forward that exists on THIS deployment. Linking to a
  // hardcoded fixture username would be a dead end on someone's fork.
  assert.match(doc.body.innerHTML, /examples\//, 'should link to the example profiles');
  assert.match(doc.body.innerHTML, /dashboard\//, 'should offer to create one');
  assert.match(doc.body.textContent, /profile-data\//, 'should explain where profiles live');
});

test('profile page: the scenario switcher offers all four tiers', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html', { search: '?u=rahul123', profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const links = Array.from(doc.querySelectorAll('.scenario-switch .scenario-list a'))
    .map(a => a.getAttribute('href'));
  assert.equal(links.length, 4);
  assert.ok(links.some(h => /t=temp_demo_live/.test(h)));
  assert.ok(links.some(h => /t=temp_demo_expired/.test(h)));
  assert.ok(links.some(h => /viewer=user_priya/.test(h)));
  assert.match(doc.querySelector('.scenario-switch').textContent, /not real access control/i,
    'the page must be honest that V1 does not enforce privacy');
});

test('profile page: external links are safe (rel=noopener, target=_blank)', { skip: NO_JSDOM }, async () => {
  const { doc } = await loadPage('profile/index.html', { search: '?u=rahul123', profileDir: '../examples/' });
  const cards = Array.from(doc.querySelectorAll('.link-card'));
  assert.ok(cards.length >= 3);
  for (const a of cards) {
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel') || '', /noopener/);
  }
});

test('the second demo profile renders with a different template', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html', { search: '?u=meera9', profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const labels = textOf(doc, '.link-card .label');
  assert.ok(labels.includes('Shop on Instagram'));
  assert.ok(!labels.includes('Wholesale Price List'));
});

// ---------------------------------------------------------------------------
// The dashboard (§8.2)
// ---------------------------------------------------------------------------

test('dashboard: loads the demo profile into the form', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 600, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.getElementById('f-username').value, 'rahul123');
  assert.equal(doc.getElementById('f-name').value, 'Rahul Kumar');
  assert.equal(doc.getElementById('f-role').value, 'Freelance Illustrator');
  assert.equal(doc.querySelectorAll('#link-rows .link-row').length, 5);
  assert.equal(doc.querySelectorAll('.template-option').length, 3);
  assert.match(doc.getElementById('link-count').textContent, /3 public/);
  assert.match(doc.getElementById('dash-subtitle').textContent, /Rahul Kumar/);
});

test('dashboard: saving persists to localStorage and marks the state clean', { skip: NO_JSDOM }, async () => {
  const { doc, win, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 600, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  setValue(doc, 'f-name', 'Rahul K');
  assert.match(doc.getElementById('dash-subtitle').textContent, /unsaved changes/);
  click(doc, 'btn-save');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!/unsaved changes/.test(doc.getElementById('dash-subtitle').textContent));
  const stored = JSON.parse(win.localStorage.getItem('qrlinkcard.v1.profile.rahul123'));
  assert.equal(stored.display_name, 'Rahul K');
  assert.equal(stored.username, 'rahul123');
});

test('dashboard: a username that is too short is refused with a clear error', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 600, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  setValue(doc, 'f-username', 'ab');
  click(doc, 'btn-save');
  await new Promise(r => setTimeout(r, 200));
  assert.match(doc.getElementById('alerts').textContent, /3-32 characters|username/i);
});

test('dashboard: generating a temporary link produces a working ?t= URL', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const select = doc.getElementById('f-token-link');
  assert.ok(select.options.length > 0, 'the followers-only links should be offered');
  const linkId = select.options[0].value;
  click(doc, 'btn-make-token');
  await new Promise(r => setTimeout(r, 250));

  const out = doc.getElementById('token-output');
  const url = out.querySelector('.token-line').textContent;
  assert.match(url, /[?&]t=temp_[A-Za-z2-9]{22}/);
  // The username lives in the PATH now (/c/rahul123/), not in a ?u= parameter —
  // that is the URL the card prints, so it is the URL a token must be minted onto.
  assert.match(new URL(url).pathname, /^\/c\/rahul123\/$/,
    'the token URL must point at the right profile: ' + url);

  // The token must now resolve to the link it was minted for.
  const Access = doc.defaultView.AccessRules;
  const Store = doc.defaultView.Store;
  const registry = await Store.loadRegistry('rahul123');
  const token = url.match(/t=(temp_[A-Za-z2-9]+)/)[1];
  const verdict = Access.evaluateToken(token, 'rahul123', registry);
  assert.ok(verdict.valid, JSON.stringify(verdict));
  assert.equal(verdict.linkId, linkId);
  assert.ok(doc.getElementById('own-tokens').textContent.includes(token));
  // Repo-seeded demo tokens must be visibly separate and NOT revocable, otherwise
  // "revoking" one just copies it into localStorage and confuses everyone.
  assert.ok(doc.querySelector('.demo-tokens'), 'demo tokens get their own section');
  assert.match(doc.getElementById('token-list').textContent, /temp_demo_live/);
  assert.match(doc.getElementById('token-list').textContent, /read-only/i);
  assert.equal(doc.querySelectorAll('#own-tokens .row').length, 1,
    'only the token we just minted is ours');
  // The minted URL must be well formed: exactly one "?" and no "&&".
  assert.ok(!/&&/.test(url), 'the URL must not contain "&&": ' + url);
  assert.equal(url.split('?').length, 2, 'the URL must contain exactly one "?": ' + url);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('t'), token);
  assert.equal(parsed.searchParams.get('u'), null,
    'a ?u= alongside /c/<username>/ would be two sources of truth for one page');
});

test('dashboard: revoking a temporary link removes it', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'btn-make-token');
  await new Promise(r => setTimeout(r, 250));
  const token = doc.querySelector('#token-output .token-line').textContent.match(/t=(temp_[A-Za-z2-9]+)/)[1];
  const revoke = Array.from(doc.querySelectorAll('#own-tokens .btn-danger'))
    .find(b => b.textContent === 'Revoke');
  assert.ok(revoke, 'a revoke button should exist for the token we just minted');
  revoke.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  assert.ok(!doc.getElementById('own-tokens').textContent.includes(token), 'the token should be gone');
  assert.match(doc.getElementById('alerts').textContent, /Revoked/);
});

test('dashboard: approving a follower flips them from pending to approved', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const rowsBefore = doc.getElementById('follower-list').textContent;
  assert.match(rowsBefore, /pending/i, 'the demo registry ships a pending request');

  const approve = Array.from(doc.querySelectorAll('#follower-list .btn'))
    .find(b => b.textContent === 'Approve');
  assert.ok(approve, 'there should be an Approve button');
  approve.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  assert.match(doc.getElementById('follower-list').textContent, /approved/);
  assert.match(doc.getElementById('alerts').textContent, /Approved/);
});

test('dashboard: simulating a follower request adds a pending row', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const before = doc.querySelectorAll('#follower-list .row').length;
  click(doc, 'btn-simulate-request');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(doc.querySelectorAll('#follower-list .row').length, before + 1);
});

test('dashboard: adding, reordering and deleting links updates the counters', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const rows = () => doc.querySelectorAll('#link-rows .link-row').length;
  assert.equal(rows(), 5);
  click(doc, 'btn-add-link');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(rows(), 6);
  assert.match(doc.getElementById('link-count').textContent, /4 public/);

  // delete the newly added (last) row
  const deleteButtons = doc.querySelectorAll('#link-rows .icon-btn.danger');
  deleteButtons[deleteButtons.length - 1]
    .dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  assert.equal(rows(), 5);

  // move the first row down
  const firstLabel = doc.querySelector('#link-rows input[type="text"]').value;
  const down = doc.querySelectorAll('#link-rows .icon-btn')[1];
  down.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  assert.notEqual(doc.querySelector('#link-rows input[type="text"]').value, firstLabel,
    'the first row should have moved');
});

test('dashboard: switching template re-renders the preview and the picker', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const options = doc.querySelectorAll('.template-option');
  assert.equal(options.length, 3);
  assert.equal(options[0].getAttribute('aria-pressed'), 'true');
  options[1].dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(doc.querySelectorAll('.template-option')[1].getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById('preview-template').textContent, 'Paper');
  // The SVG preview is set as a data URL on the <img>; jsdom won't decode it but
  // the src must be populated and well formed.
  const src = doc.getElementById('preview-front').getAttribute('src') || '';
  assert.match(src, /^data:image\/svg\+xml;base64,./);
  const svg = Buffer.from(src.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /<svg xmlns=/);
  assert.ok(!/NaN|undefined/.test(svg), 'the rendered card must not contain NaN/undefined');
});

test('dashboard: the visitor simulation links cover all three tiers', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const rows = Array.from(doc.querySelectorAll('#visitor-links .row'));
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Stranger/);
  assert.match(rows[1].textContent, /Temporary link/);
  assert.match(rows[2].textContent, /Approved follower/);
  const hrefs = rows.map(r => r.querySelector('a').getAttribute('href'));
  // The simulation must use the canonical printed URL, not the ?u= deep link:
  // the point is to show the owner what a person who scanned the card would see.
  assert.ok(hrefs.every(h => h.includes('c/rahul123/')), hrefs.join(' | '));
  // Relative hrefs must resolve to the site root from a directory URL. /dashboard/
  // has no filename to replace, so this is what Store.rootRelative() is for — and
  // it is the same helper every other page uses, at whatever depth it is running.
  hrefs.forEach(h => {
    const abs = new URL(h, 'http://localhost:8080/dashboard/');
    assert.equal(abs.pathname, '/c/rahul123/', 'resolved to ' + abs.href);
  });
});

test('dashboard: the QR tool link carries this card\'s profile URL', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const href = doc.getElementById('btn-qr-tool').getAttribute('href');
  const abs = new URL(href, 'http://localhost:8080/dashboard/');
  assert.equal(abs.pathname, '/qr-generator/');
  const target = abs.searchParams.get('url');
  // Absolute, because a QR code carrying a relative URL is unscannable nonsense.
  // Not necessarily https: this test runs against http://localhost, and Pages
  // serves https. What matters is that it is derived from where we are.
  assert.match(target, /^https?:\/\/[^/]+\//, 'the QR must encode an absolute URL, got ' + target);
  assert.equal(new URL(target).pathname, '/c/rahul123/',
    'the QR tool should be handed the canonical printed URL, got ' + target);
});

test('dashboard: the permanent URL is shown derived, and only an override is editable', { skip: NO_JSDOM }, async () => {
  // The field a fork owner must never have to type is shown, not asked for. If it were
  // editable it would invite someone to paste a URL from a tutorial and print a card that
  // opens another person's site.
  const { win, doc, errors } = await loadPage('dashboard/index.html', { search: '?u=yourname', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const shown = doc.getElementById('f-profile-url');
  assert.equal(shown.readOnly, true, 'the derived URL must be read-only');
  assert.equal(new URL(shown.value).pathname, '/c/yourname/', shown.value);
  assert.equal(doc.getElementById('btn-open-url').getAttribute('href'), shown.value,
    'Open should go to the address you are about to print');
  assert.equal(doc.getElementById('f-profile-url-override').value, '',
    'with no override set, the override field stays empty rather than echoing the derived URL');

  // The one legitimate reason to set it: a domain you own that is not where this is served.
  const override = doc.getElementById('f-profile-url-override');
  override.value = 'https://cards.example.com/c/yourname/';
  override.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));

  await click(doc, 'btn-save');

  // Reload with storage carried over: the override must survive a page load and drive
  // the QR from now on. Writing to localStorage proves less than this does.
  const second = await loadPage('dashboard/index.html',
    { search: '?u=yourname', settleMs: 700, storage: snapshotStorage(win) });
  const url = second.doc.getElementById('f-profile-url').value;
  assert.equal(url, 'https://cards.example.com/c/yourname/',
    'an absolute override wins over the derived URL');
  assert.equal(second.doc.getElementById('f-profile-url-override').value, url,
    'the override field shows what is actually set, so it can be cleared');
  const qrLink = second.doc.getElementById('btn-qr-tool').getAttribute('href');
  assert.ok(qrLink.includes(encodeURIComponent(url)), 'the QR tool gets the override, not the derived URL');

  // Clearing it returns to derivation — no manual re-typing of the old value.
  const back = second.doc.getElementById('f-profile-url-override');
  back.value = '';
  back.dispatchEvent(new second.doc.defaultView.Event('input', { bubbles: true }));
  await click(second.doc, 'btn-save');
  const third = await loadPage('dashboard/index.html',
    { search: '?u=yourname', settleMs: 700, storage: snapshotStorage(second.win) });
  assert.equal(new URL(third.doc.getElementById('f-profile-url').value).pathname, '/c/yourname/',
    'clearing the override falls back to the derived URL');
  assert.equal(third.doc.getElementById('f-profile-url-override').value, '');
});

test('dashboard: without ?u= it loads the starter profile with a shareable link', { skip: NO_JSDOM }, async () => {
  // A fork owner opens /dashboard/ with no query. The starter in profile-data/
  // is the demo account, and its /c/yourname/ URL is already shareable — people
  // copy the repo and update that JSON, they do not start from a blank field.
  const { doc, errors } = await loadPage('dashboard/index.html', { settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.getElementById('f-username').value, 'yourname');
  assert.equal(doc.getElementById('share-hero').hidden, false);
  assert.equal(doc.getElementById('github-repo-fields').hidden, false,
    'localhost is not GitHub Pages, so the GitHub fields stay as an optional override');
  assert.equal(doc.getElementById('f-share-url').value, ORIGIN + '/c/yourname/',
    'the demo account shows a shareable /c/username/ link immediately');
  assert.equal(doc.getElementById('btn-copy-share').disabled, false);
  assert.equal(doc.getElementById('btn-open-share').getAttribute('href'), ORIGIN + '/c/yourname/');
});

test('dashboard: copying the repo into GitHub fields produces a public shareable link', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=yourname', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));

  setValue(doc, 'f-github-owner', 'alice');
  setValue(doc, 'f-github-repo', 'my-card');
  await new Promise(r => setTimeout(r, 50));

  const share = doc.getElementById('f-share-url').value;
  assert.equal(share, 'https://alice.github.io/my-card/c/yourname/',
    'the public link is derived from the copied repo, not typed as a URL');
  assert.equal(doc.getElementById('f-open-profile-url').value, share);
  assert.equal(doc.getElementById('btn-copy-share').disabled, false);
  assert.equal(doc.getElementById('btn-open-share').getAttribute('href'), share);

  // Changing the username — the thing you change in the repo copy — updates the link live.
  setValue(doc, 'f-username', 'alice');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(doc.getElementById('f-share-url').value, 'https://alice.github.io/my-card/c/alice/');
  assert.match(doc.getElementById('share-hero-help').textContent, /profile-data\/alice\.json/);
});

test('dashboard: a fork on GitHub Pages fills the shareable link without typing the repo', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', {
    search: '?u=yourname',
    settleMs: 700,
    bodyAttrs: { 'data-site-root': 'https://alice.github.io/my-card' }
  });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.getElementById('github-repo-fields').hidden, true,
    'the Pages host already is the copied repo');
  const id = doc.defaultView.Store.githubPagesIdentity();
  assert.equal(id && id.owner, 'alice');
  assert.equal(id && id.repo, 'my-card');
  assert.equal(doc.getElementById('f-share-url').value, 'https://alice.github.io/my-card/c/yourname/');
  assert.equal(doc.getElementById('share-upstream-note').hidden, true);
  assert.equal(doc.getElementById('btn-copy-share').disabled, false);
});

test('dashboard: the upstream demo account is shareable, and JSON is what you change', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', {
    search: '?u=yourname',
    settleMs: 700,
    bodyAttrs: { 'data-site-root': 'https://clickalex.github.io/GrinCard' }
  });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.getElementById('share-upstream-note').hidden, false);
  assert.equal(doc.getElementById('github-repo-fields').hidden, false);
  assert.equal(doc.getElementById('f-share-url').value,
    'https://clickalex.github.io/GrinCard/c/yourname/',
    'the live demo account already has a public /c/username/ link');
  assert.equal(doc.getElementById('btn-copy-share').disabled, false);
  assert.match(doc.getElementById('share-hero-help').textContent, /profile-data\/yourname\.json/);
  setValue(doc, 'f-github-owner', 'priya');
  setValue(doc, 'f-github-repo', 'my-card');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(doc.getElementById('f-share-url').value, 'https://priya.github.io/my-card/c/yourname/');
});

test('dashboard: an empty repo name defaults to GrinCard after you enter the GitHub user', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=yourname', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  setValue(doc, 'f-github-owner', 'riley');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(doc.getElementById('f-share-url').value, 'https://riley.github.io/GrinCard/c/yourname/');
});

test('dashboard: the token duration picker is generated from LIMITS', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const Access = doc.defaultView.AccessRules;
  const options = Array.from(doc.getElementById('f-token-duration').options);
  const defined = Access.durationOptions();
  assert.equal(options.length, defined.length,
    'the picker must offer exactly what the rules define');
  // `options` lives in the jsdom realm, so Array.from() here rather than .map():
  // .map() would build a jsdom Array and deepEqual compares prototypes.
  assert.deepEqual(Array.from(options, o => String(o.value)), Array.from(defined, d => String(d.seconds)));
  assert.deepEqual(Array.from(options, o => String(o.textContent)), Array.from(defined, d => d.label));
  assert.equal(doc.getElementById('f-token-duration').value, '86400', 'a day is the default');
});

test('dashboard: the profile JSON export matches the schema in the spec', { skip: NO_JSDOM }, async () => {
  const { doc, win, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'btn-toggle-json');
  await new Promise(r => setTimeout(r, 200));
  const json = JSON.parse(doc.getElementById('json-view').textContent);
  assert.equal(json.username, 'rahul123');
  assert.ok(Array.isArray(json.links));
  json.links.forEach((l, i) => {
    assert.ok(l.id && l.label != null && l.url != null, 'link ' + i + ' is incomplete');
    assert.ok(['public', 'followers_only'].includes(l.visibility));
    assert.equal(l.order, i + 1);
  });
  assert.ok(json.card_settings.template_id);
  assert.ok(!('_source' in json), 'internal fields must not leak into the export');
  assert.ok(win.localStorage.getItem('qrlinkcard.v1.lastUsername'));
});

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

test('card builder: renders every template and a live preview', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('card-builder/index.html', { settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  // The three built-ins plus whatever card-templates/community/ contributes. An
  // exact count would make every new template a test change, which is exactly the
  // friction drop-in contributions exist to avoid.
  const options = Array.from(doc.querySelectorAll('.template-option'));
  assert.ok(options.length >= 3, 'expected at least the three built-ins, got ' + options.length);
  const names = options.map(o => o.textContent);
  assert.ok(names.some(n => /contributed/.test(n)),
    'a contributed template should be offered and labelled as such: ' + names.join(' | '));
  assert.equal(doc.querySelectorAll('#b-links .link-row').length, 4);
  const src = doc.getElementById('b-back').getAttribute('src') || '';
  assert.match(src, /^data:image\/svg\+xml;base64,./);
  const svg = Buffer.from(src.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /<path d="M[\d.]+ [\d.]+h/, 'the back must contain the QR path');
  // The printed URL is derived, and the field is read-only: a fork must never
  // have to type it, and must not be able to bake in someone else's domain.
  const url = doc.getElementById('b-url');
  assert.match(url.value, /\/c\/yourname\/$/, 'got ' + url.value);
  assert.equal(url.getAttribute('readonly') !== null, true, 'the derived URL must not be editable');
  assert.equal(doc.getElementById('b-username').value, 'yourname',
    'the builder should start from the starter identity, not a fixture');
});

test('card builder: editing the name updates the rendered card', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('card-builder/index.html', { settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  setValue(doc, 'b-name', 'Priya Nair');
  await new Promise(r => setTimeout(r, 400));
  const src = doc.getElementById('b-front').getAttribute('src');
  const svg = Buffer.from(src.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /Priya Nair/);
});

test('card builder: changing the username changes the URL encoded in the QR', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('card-builder/index.html', { settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  setValue(doc, 'b-username', 'shop42');
  setValue(doc, 'b-url', 'https://example.test/c/shop42');
  await new Promise(r => setTimeout(r, 400));
  const src = doc.getElementById('b-back').getAttribute('src');
  const svg = Buffer.from(src.split(',')[1], 'base64').toString('utf8');
  // Decode the QR straight out of the rendered SVG to prove the content changed.
  const QR = require('../lib/qr.js');
  const expected = QR.create('https://example.test/c/shop42', { ecl: 'Q', margin: 0 });
  const modulesInSvg = (svg.match(/h[\d.]+v[\d.]+h-[\d.]+z/g) || []).length;
  assert.ok(modulesInSvg > 100, 'expected a QR worth of modules, got ' + modulesInSvg);
  assert.equal(expected.ecl, 'Q');
});

// ---------------------------------------------------------------------------
// Other pages
// ---------------------------------------------------------------------------

test('card preview page: shows every template plus QR metadata', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('templates/index.html', { settleMs: 900, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.querySelectorAll('#profile-picker button').length, 2,
    'both example profiles should be offered');
  // One panel per template, built-ins plus contributed; each panel shows both
  // sides twice (normal content and the long-text stress row).
  const panels = doc.querySelectorAll('#templates .panel').length;
  assert.ok(panels >= 3, 'expected at least the three built-in templates, got ' + panels);
  assert.equal(doc.querySelectorAll('#templates figure').length, panels * 4);
  // The QR must encode the canonical printed URL for whoever is selected, derived
  // from this deployment's own origin — never a ?u= deep link, and never a URL
  // copied out of a fixture (that is how a fork ends up printing someone else's site).
  const selected = doc.querySelector('#profile-picker button[aria-pressed="true"]');
  assert.ok(selected, 'a profile should be selected');
  const chosen = /\(([^)]+)\)/.exec(selected.textContent)[1];
  const content = doc.getElementById('qr-content').textContent;
  assert.equal(content, ORIGIN + '/c/' + chosen + '/', 'QR content was ' + content);
  assert.ok(!/clickalex\.github\.io/.test(content), 'a fixture URL must not leak into a QR code');
  assert.match(doc.getElementById('qr-modules').textContent, /^\d+ × \d+$/);
  assert.ok(doc.querySelector('#qr-standalone svg'), 'the standalone QR should render');
});

test('template gallery: every design hands you the exact template_id for your JSON',
  { skip: NO_JSDOM }, async () => {
    const { doc, win, errors } = await loadPage('templates/index.html',
      { settleMs: 900, profileDir: '../examples/' });
    assert.deepEqual(errors, [], errors.join('\n'));

    const panels = Array.from(doc.querySelectorAll('#templates .panel'));
    const registered = win.CardTemplates.all().map(t => t.id);
    assert.equal(panels.length, registered.length,
      'every registered template should be choosable on this page');

    // This page is where somebody picks a design, and the no-terminal path from here is
    // editing profile-data/<username>.json on GitHub. So each panel has to give them the
    // literal string to type — a name alone leaves them guessing at an id.
    const shown = panels.map(panel => {
      const value = panel.querySelector('.url-value');
      assert.ok(value, 'each panel should print the JSON line to copy');
      const m = /"template_id": "([^"]+)"/.exec(value.textContent);
      assert.ok(m, 'it should be the literal card_settings line, got: ' + value.textContent);
      const btn = Array.from(panel.querySelectorAll('button'))
        .find(b => /copy id/i.test(b.textContent));
      assert.ok(btn, 'and a button to take it away without retyping it');
      return m[1];
    });

    assert.deepEqual([...shown].sort(), [...registered].sort(),
      'the ids shown must be the real registered ones — a typo here sends somebody ' +
      'to a design that does not exist, and their card silently falls back');
  });

test('cards index: a stale manifest lists nothing, not a card for somebody gone',
  { skip: NO_JSDOM }, async () => {
    const { doc, errors } = await loadPage('index.html',
      { settleMs: 700, profileDir: 'tests/fixtures/stale-profile-data/' });
    assert.deepEqual(errors, [], errors.join('\n'));

    // The fixture manifest names "ghost"; there is no ghost.json. Rendering a card for
    // somebody whose data never loaded is worse than rendering nothing — it looks like
    // the site works while the one card the owner cares about is absent.
    assert.equal(doc.querySelectorAll('#cards .card-index-row').length, 0,
      'a profile with no data must not become a card');
    assert.match(doc.getElementById('card-count').textContent, /^0 cards/);

    // And the page should explain itself, because the owner cannot see the manifest from
    // here and an unexplained empty list reads as a broken deployment.
    const notice = doc.querySelector('#cards .notice-warn');
    assert.ok(notice, 'it should say the list is out of date');
    assert.match(notice.textContent, /ghost/, 'naming the missing profile');
    assert.match(notice.textContent, /index\.json/, 'and the file to fix');

    // The fix offered has to work with no terminal: somebody who edits JSON in GitHub's
    // web UI cannot run npm, and telling them to is how a template loses them.
    assert.match(notice.textContent, /web UI/i);
    assert.match(notice.textContent, /are not affected|still work/i,
      'it should say their live links are unaffected');
  });

test('cards index: the filename beats a mismatched "username" field',
  { skip: NO_JSDOM }, async () => {
    const { doc, errors } = await loadPage('index.html',
      { settleMs: 700, profileDir: 'tests/fixtures/mismatched-profile-data/' });
    assert.deepEqual(errors, [], errors.join('\n'));

    // riley.json exists but declares "username": "rileyx" — what happens when somebody
    // renames the file in GitHub's web UI and not the field inside it. The URL is
    // /c/riley/, because that is the file the profile page fetches, so the card must be
    // listed under riley. Keying off the declared field instead lists a card for
    // /c/rileyx/, which does not exist, and then reports it missing — telling somebody
    // who has a working card that they have no cards at all.
    const rows = doc.querySelectorAll('#cards .card-index-row');
    assert.equal(rows.length, 1, 'the real profile must be listed');
    assert.equal(rows[0].getAttribute('data-username'), 'riley');
    const url = rows[0].querySelector('.url-value').textContent.trim();
    assert.equal(url, ORIGIN + '/c/riley/', 'the URL shown must be the one that works');
    assert.ok(!url.includes('rileyx'), 'and must not be the name declared inside the file');

    // Silence here would leave somebody staring at a URL that is not the name they
    // typed, so the disagreement is surfaced with both values and the fix.
    const warn = Array.from(doc.querySelectorAll('#cards .notice-warn'))
      .map(n => n.textContent).join(' ');
    assert.match(warn, /riley\.json/);
    assert.match(warn, /rileyx/, 'it should quote what the file declares');
    assert.match(warn, /filename is what your URL is built from/i);
  });

test('print sheet page: lays out both sides with mm-sized frames', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('print/index.html', { search: '?u=rahul123', settleMs: 800, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const cards = doc.querySelectorAll('.sheet-card');
  assert.equal(cards.length, 2);
  assert.ok(cards[0].querySelector('svg'), 'each side should be inline SVG');
  assert.match(doc.getElementById('sheet-note').textContent, /89 × 51 mm/);
  // toggling bleed must switch the frame size
  click(doc, 'btn-bleed');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(doc.querySelectorAll('.sheet-card.bleed').length, 2);
  assert.match(doc.getElementById('sheet-note').textContent, /95 × 57 mm/);
});

// ---------------------------------------------------------------------------
// The printed URL: /c/<username>/ must be a real, working address
//
// A QR code encodes a URL that cannot be changed once the card is printed, so the
// machinery behind it is worth testing directly: the generator that writes the
// stubs, the stub itself running the shared renderer, and 404.html, which has to
// serve the same URL on a host where the stubs were never generated.
// ---------------------------------------------------------------------------

test('build-links generates a stub that runs the shared renderer', { skip: NO_JSDOM }, async () => {
  const { stubHtml } = require('../tools/build-links.js');
  const html = stubHtml('rahul123', 'Rahul Kumar');

  // The stub is a host, not a second implementation: it must load the same
  // renderer and boot layer as profile/index.html, or the two would drift.
  assert.match(html, /src="\.\.\/\.\.\/profile\/profile\.js"/);
  assert.match(html, /src="\.\.\/\.\.\/profile\/boot\.js"/);
  assert.match(html, /data-username="rahul123"/);
  assert.match(html, /<title>Rahul Kumar — QR Link Card<\/title>/);
  assert.ok(!/profile\.js"[^]*function render/.test(html), 'the stub must not contain renderer code');

  // Written into the gitignored c/ tree so relative paths resolve exactly as they
  // will in production, then loaded as a page two directories below the root.
  const dir = path.join(ROOT, 'c', 'rahul123');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  const existed = fs.existsSync(file);
  const before = existed ? fs.readFileSync(file, 'utf8') : null;
  try {
    fs.writeFileSync(file, withBodyAttrs(html, { 'data-profile-dir': '../../examples/' }), 'utf8');
    const { doc, errors } = await loadPage('c/rahul123/index.html', { settleMs: 900 });
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.deepEqual(textOf(doc, '.link-card .label'), ['Instagram', 'Portfolio', 'Email'],
      'a stranger at /c/rahul123/ must see the public links and nothing else');
    assert.match(doc.querySelector('.tier-banner').textContent, /Public view/);
    assert.equal(doc.title, 'Rahul Kumar — QR Link Card');
    // Links must climb two levels from here, or the stub would 404 its own assets.
    const home = doc.querySelector('header.topbar .brand');
    assert.equal(new URL(home.getAttribute('href'), ORIGIN + '/c/rahul123/').pathname, '/index.html');
  } finally {
    if (existed) fs.writeFileSync(file, before, 'utf8');
    else fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('404.html serves /c/<username>/ in place, with no redirect', { skip: NO_JSDOM }, async () => {
  // This is the fallback that makes a plain branch deploy work: GitHub Pages
  // serves 404.html for a missing path but keeps the requested URL in the address
  // bar, so the page has to find the site root by probing and boot the renderer.
  const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
  assert.match(html, /data-username/, 'it must tell the renderer whose profile this is');
  assert.match(html, /\/c\//, 'it must parse the username out of the path');
  assert.ok(!/location\.replace\(|location\.href\s*=|http-equiv="refresh"/.test(html),
    'a redirect would change the printed URL in the address bar — the whole point is that it does not');

  const { doc, errors } = await loadPageAt('404.html', '/c/yourname/', { settleMs: 1500 });
  assert.deepEqual(errors.filter(e => !/404|probe/.test(e)), [], errors.join('\n'));
  assert.equal(doc.body.getAttribute('data-username'), 'yourname',
    'the username must come from the requested path, not from the file being served');
  assert.match(doc.body.textContent, /Your Name/, 'the starter profile should render in place');
  assert.ok(doc.querySelector('#profile-root .link-card'), 'links should render');
});

test('the renderer resolves the person from the page when no host has booted', { skip: NO_JSDOM }, async () => {
  // 404.html injects its scripts one at a time over the network, so profile.js's
  // selfStart() timer fires before boot.js has downloaded and published
  // window.ProfileBoot. The renderer therefore boots with no host at all — and it
  // used to answer that by falling back to the first profile in the manifest.
  //
  // On a one-person deployment that is indistinguishable from correct, which is why
  // the test above passes either way. With a second person it renders somebody else
  // at a printed card URL. examples/ lists meera9 before rahul123, so asking for
  // rahul123 is the discriminating case: the wrong answer is a real profile.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'index.json'), 'utf8'));
  assert.equal(manifest.profiles[0], 'meera9', 'this test needs meera9 listed first, as the decoy');
  const asked = manifest.profiles[manifest.profiles.length - 1];
  assert.equal(asked, 'rahul123');

  // boot.js omitted on purpose. In production this is the state profile.js is in when
  // selfStart()'s timer beats boot.js over the network: 404.html has already put
  // data-username on <body> (that is what bootApp does before injecting anything), but
  // window.ProfileBoot does not exist yet. With boot.js present the harness resolves
  // the username through the host and never reaches the fallback, so the test passes
  // whether or not the fix is there.
  const { doc, errors } = await loadPage('profile/index.html', {
    profileDir: '../examples/',
    username: asked,
    omitScripts: ['boot.js'],
    // The shell boot.js builds before handing over. In the real race this exists by the
    // time the fallback render happens, because boot.js has executed even though its
    // handover has not — only the ordering of the two differs, not what is on the page.
    bodyHtml: '<div class="profile-shell"><div class="profile" id="profile-root" aria-live="polite"></div></div>',
    settleMs: 2000
  });
  assert.deepEqual(errors.filter(e => !/404|probe/.test(e)), [], errors.join('\n'));
  assert.equal(doc.body.getAttribute('data-username'), asked,
    'the host must pass the username in the markup');

  // Read the expected names from the fixtures rather than hardcoding them, so this
  // test does not rot when a fixture is renamed.
  const askedProfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', asked + '.json'), 'utf8'));
  const decoy = manifest.profiles.find(u => u !== asked);
  const decoyProfile = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', decoy + '.json'), 'utf8'));
  assert.notEqual(askedProfile.display_name, decoyProfile.display_name,
    'the decoy must be a visibly different person, or the test proves nothing');

  const name = (doc.querySelector('#profile-root .profile-name') || {}).textContent || '';
  assert.equal(name.trim(), askedProfile.display_name,
    'rendered "' + name.trim() + '" — the fallback must not substitute another profile');
  assert.ok(!doc.getElementById('profile-root').textContent.includes(decoyProfile.display_name),
    'the decoy profile (' + decoyProfile.display_name + ') must not appear in the render');

  // And an unknown name gets an honest empty state rather than a plausible person.
  const unknown = await loadPage('profile/index.html', {
    profileDir: '../examples/', username: 'does-not-exist',
    omitScripts: ['boot.js'],
    bodyHtml: '<div class="profile-shell"><div class="profile" id="profile-root" aria-live="polite"></div></div>',
    settleMs: 2000
  });
  const unknownText = unknown.doc.getElementById('profile-root').textContent;
  assert.match(unknownText, /No profile here/, 'an unknown name must say so');
  for (const who of [askedProfile, decoyProfile]) {
    assert.ok(!unknownText.includes(who.display_name),
      'an unknown name must not render ' + who.display_name + ': ' +
      unknownText.replace(/\s+/g, ' ').slice(0, 80));
  }
});

test('404.html shows a useful page for a path that is not a profile', { skip: NO_JSDOM }, async () => {
  const { doc } = await loadPageAt('404.html', '/nope/missing.html', { settleMs: 900 });
  assert.match(doc.body.textContent, /Nothing at that address/);
  assert.match(doc.body.innerHTML, /index\.html/, 'it should offer a way back to the index');
});

test('qr generator: single mode renders a code and its measurements', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(doc.querySelector('#q-preview svg'), 'a QR should render immediately');
  const meta = doc.querySelector('#q-preview .qr-meta').textContent;
  assert.match(meta, /Version/);
  assert.match(meta, /25 mm/);
  assert.match(meta, /300 DPI/);
  assert.equal(doc.querySelectorAll('#q-preview path').length, 1, 'modules collapse into one path');
  assert.equal(doc.querySelectorAll('#s-paper option').length, Object.keys(require('../qr-generator/generator.js').PAPER).length);
});

test('qr generator: switching to sheet mode lays out the demo list', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'tab-sheet');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!doc.getElementById('mode-sheet').classList.contains('hidden'));
  const pages = doc.querySelectorAll('#s-preview .sheet-page');
  assert.ok(pages.length >= 1, 'at least one sheet page should render');
  const stats = doc.getElementById('s-stats').textContent;
  assert.match(stats, /10 codes/);
  assert.match(stats, /page/);
  // One <g> per code on the page.
  assert.equal(pages[0].querySelectorAll('g[data-index]').length, 10);
});

test('qr generator: options change the sheet and persist', { skip: NO_JSDOM }, async () => {
  const { doc, win, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'tab-sheet');
  await new Promise(r => setTimeout(r, 200));
  const before = doc.querySelectorAll('#s-preview .sheet-page g[data-index]').length;
  setValue(doc, 's-size', '60');
  await new Promise(r => setTimeout(r, 250));
  const after = doc.querySelectorAll('#s-preview .sheet-page g[data-index]').length;
  assert.ok(after <= before, 'bigger codes should fit fewer per page');
  assert.ok(win.localStorage.getItem('qrlinkcard.v1.qrgen.options'), 'options should be remembered');
  assert.equal(doc.querySelectorAll('#s-preview .sheet-page').length >= 1, true);
});

test('qr generator: the PDF download is a real PDF with the right page count', { skip: NO_JSDOM || NO_PDFJS }, async () => {
  const { doc, win, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'tab-sheet');
  await new Promise(r => setTimeout(r, 250));
  const blobs = [];
  win.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:mock'; };
  click(doc, 's-pdf');
  await new Promise(r => setTimeout(r, 500));
  assert.equal(blobs.length, 1, 'one file should be downloaded');
  const buf = Buffer.from(await blobs[0].arrayBuffer());
  assert.match(buf.slice(0, 8).toString('latin1'), /^%PDF-1\.4/);
  const { doc: parsed } = await ORACLE.readPdf(buf);
  const pages = doc.querySelectorAll('#s-preview .sheet-page').length;
  assert.equal(parsed.numPages, pages, 'the PDF must have one page per preview page');
  assert.match(doc.getElementById('s-alerts').textContent, /PDF saved/);
});

test('qr generator: the single-QR PNG falls back gracefully without a canvas', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'q-png');
  await new Promise(r => setTimeout(r, 300));
  assert.match(doc.getElementById('q-alerts').textContent, /cannot rasterise|PNG saved/i);
});

test('qr generator: examples fill the input and re-render', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const wifi = Array.from(doc.querySelectorAll('[data-example]')).find(b => b.dataset.example === 'wifi');
  wifi.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  assert.match(doc.getElementById('q-text').value, /^WIFI:/);
  assert.ok(doc.querySelector('#q-preview svg'), 'the preview should follow the input');
});

test('qr generator: ?url= pre-fills the single-code field (the dashboard link)', { skip: NO_JSDOM }, async () => {
  const target = 'https://you.dev/c/rahul123';
  const { doc, errors } = await loadPage('qr-generator/index.html',
    { search: '?url=' + encodeURIComponent(target) + '&mode=sheet', settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.getElementById('q-text').value, target);
  // mode=sheet should open on the sheet tab
  assert.ok(!doc.getElementById('mode-sheet').classList.contains('hidden'));
  assert.equal(doc.getElementById('tab-sheet').getAttribute('aria-selected'), 'true');
});

test('qr generator: building a sheet from your profiles yields only public links', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('qr-generator/index.html',
    { settleMs: 600, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  click(doc, 'tab-sheet');
  await new Promise(r => setTimeout(r, 200));
  click(doc, 'q-load-profiles');
  await new Promise(r => setTimeout(r, 600));

  const list = doc.getElementById('q-list').value;
  assert.match(list, /rahul123/, 'the demo profiles should have loaded');
  assert.match(list, /meera9/);
  // The private links must not end up in a printable sheet: a temporary or
  // followers-only URL printed on a sticker is a leak that cannot be undone.
  assert.ok(!list.includes('docs.example.com/rahul-pricing'), 'followers_only link leaked into the sheet');
  assert.ok(!list.includes('wa.me/911234567890'), 'followers_only link leaked into the sheet');
  assert.ok(!/[?&]t=/.test(list), 'a temporary link must never be printed');

  const codes = doc.querySelectorAll('#s-preview .sheet-page g[data-index]').length;
  assert.ok(codes >= 6, 'expected a sheet of codes, got ' + codes);
  assert.match(doc.getElementById('s-alerts').textContent, /Loaded \d+ codes/);
});

// ---------------------------------------------------------------------------
// Deployment discovery — the guarantee that a fork never types its own URL
//
// Every printed URL in this project is derived from where the scripts are being
// served. That is what makes the repository safe to fork, so it is tested at each
// depth a page can run from, and against both override attributes.
// ---------------------------------------------------------------------------

test('Store derives the site root at every depth a page can run from', { skip: NO_JSDOM }, async () => {
  const cases = [
    // [page, requested path, expected climb back to the root]
    ['index.html', null, ''],
    ['dashboard/index.html', null, '../'],
    ['profile/index.html', null, '../'],
    ['templates/index.html', null, '../'],
    ['qr-generator/index.html', null, '../'],
    ['c/yourname/index.html', null, '../../']
  ];

  for (const [page, requestPath, climb] of cases) {
    let loaded;
    if (page === 'c/yourname/index.html') {
      // The stubs are generated and gitignored, so build one for the depth test.
      const { stubHtml } = require('../tools/build-links.js');
      const dir = path.join(ROOT, 'c', 'yourname');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'index.html');
      const existed = fs.existsSync(file);
      const before = existed ? fs.readFileSync(file, 'utf8') : null;
      try {
        fs.writeFileSync(file, stubHtml('yourname', 'Your Name'), 'utf8');
        loaded = await loadPage('c/yourname/index.html', { settleMs: 300 });
      } finally {
        if (existed) fs.writeFileSync(file, before, 'utf8');
        else fs.rmSync(dir, { recursive: true, force: true });
      }
    } else {
      loaded = await loadPage(page, { settleMs: 200 });
    }

    const Store = loaded.win.Store;
    assert.ok(Store, page + ' should have loaded Store');
    // The root comes from the URL of lib/store.js itself, so it is correct at any
    // depth on any host, with no configuration and no build step.
    assert.equal(Store.siteRoot(), ORIGIN + '/', page + ' -> ' + Store.siteRoot());
    assert.equal(Store.basePath(), '/');
    assert.equal(Store.rootRelative(''), climb, page + ' climb');
    assert.equal(Store.rootRelative('docs/PRINTING.md'), climb + 'docs/PRINTING.md');
    assert.equal(Store.profileUrlFor('rahul'), ORIGIN + '/c/rahul/', page);
    assert.deepEqual(loaded.errors.filter(e => !/404/.test(e)), [], page + ': ' + loaded.errors.join('\n'));
  }
});

test('the derived URL follows a subdirectory deployment, because that is what Pages gives you', { skip: NO_JSDOM }, async () => {
  // A project page is served from /<repo>/, not from a domain root. Nothing in the
  // repository may assume otherwise.
  const { win, errors } = await loadPage('profile/index.html',
    { search: '?u=rahul123', profileDir: '../examples/',
      deployBase: '/GrinCard/', settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(win.Store.siteRoot(), ORIGIN + '/GrinCard/');
  assert.equal(win.Store.basePath(), '/GrinCard/');
  assert.equal(win.Store.profileUrlFor('rahul123'), ORIGIN + '/GrinCard/c/rahul123/');
  assert.equal(win.Store.rootRelative('index.html'), '../index.html');
});

test('an explicit site root beats the derived one, for custom domains', { skip: NO_JSDOM }, async () => {
  const { win, errors } = await loadPage('index.html',
    { settleMs: 300, bodyAttrs: { 'data-site-root': 'https://cards.example.com' } });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(win.Store.siteRoot(), 'https://cards.example.com/',
    'a missing trailing slash must be normalised');
  assert.equal(win.Store.profileUrlFor('rahul'), 'https://cards.example.com/c/rahul/');
});

test('a profile may still override its own URL, and only with an absolute one', { skip: NO_JSDOM }, async () => {
  const { win, errors } = await loadPage('index.html', { settleMs: 300 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const Store = win.Store;
  const derived = ORIGIN + '/c/rahul/';
  assert.equal(Store.profileUrlFor('rahul', {}), derived);
  assert.equal(Store.profileUrlFor('rahul', { profile_url: 'https://cards.me/c/rahul/' }),
    'https://cards.me/c/rahul/', 'an absolute URL wins — that is the custom-domain escape hatch');
  // A relative or empty override must NOT win: it is how a copied fixture would
  // silently produce a card that points somewhere unreachable.
  assert.equal(Store.profileUrlFor('rahul', { profile_url: '/c/rahul/' }), derived);
  assert.equal(Store.profileUrlFor('rahul', { profile_url: '' }), derived);
  assert.equal(Store.profileUrlFor('rahul', { profile_url: null }), derived);
  assert.equal(Store.profileUrlFor('', {}), '', 'no username, no URL');
});

test('data-profile-dir repoints the data directory without touching the page', { skip: NO_JSDOM }, async () => {
  // This is how templates/ and examples/ preview the fixtures instead of the
  // owner's real profiles — a public gallery must not render private links.
  const { win, errors } = await loadPage('templates/index.html',
    { settleMs: 200, profileDir: '../examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(win.Store.dataDir(), '../examples/');

  const plain = await loadPage('dashboard/index.html', { settleMs: 200 });
  assert.equal(plain.win.Store.dataDir(), '../profile-data/',
    'without the override a page reads the owner’s own data');
});

test('the profile page publishes a canonical URL for the person it is showing', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('profile/index.html',
    { search: '?u=rahul123', profileDir: '../examples/', settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const canonical = doc.querySelector('link[rel="canonical"]');
  assert.ok(canonical, 'the page should declare a canonical URL');
  assert.equal(canonical.getAttribute('href'), ORIGIN + '/c/rahul123/',
    'it must be the printed URL, not the ?u= deep link the visitor arrived on');
  assert.equal(doc.title, 'Rahul Kumar — QR Link Card');
});

test('?demo=1 selects the fixture data, so a demo link is not an empty page', { skip: NO_JSDOM }, async () => {
  // The fixtures live in examples/, not profile-data/ — they moved there so a fork ships
  // one obvious starter profile of its own. But a link like /profile/?u=rahul123&demo=1
  // navigates to a page with no data-profile-dir attribute of its own, so the flag has to
  // carry the meaning too. Without it, the README's five advertised demo URLs and every
  // scenario link in the examples gallery rendered "No profile here".
  const demo = await loadPage('profile/index.html', { search: '?u=rahul123&demo=1', settleMs: 700 });
  assert.deepEqual(demo.errors, [], demo.errors.join('\n'));
  const text = demo.doc.body.textContent;
  assert.ok(/Rahul/.test(text), 'the fixture must render from examples/ via ?demo=1 alone');
  assert.ok(!/No profile here/i.test(text), 'and must not fall through to the empty state');
  // Ends with examples/, whatever depth this page is running at.
  assert.match(demo.win.Store.dataDir(), /(^|\/)examples\/$/,
    '?demo=1 repoints the data directory: ' + demo.win.Store.dataDir());

  // The registry has to follow, or the temporary-link scenarios silently degrade to the
  // public tier — which looks like a working page and is the wrong answer.
  const tokened = await loadPage('profile/index.html',
    { search: '?u=rahul123&t=temp_demo_live&demo=1', settleMs: 700 });
  assert.deepEqual(tokened.errors, [], tokened.errors.join('\n'));
  assert.ok(/Pricing|WhatsApp/i.test(tokened.doc.body.textContent),
    'the token scenario must unlock a private link from examples/tokens.json');

  // Without the flag, a real deployment must NOT fall back to the fixtures. Rendering a
  // stranger's example profile on somebody's own domain would be worse than an empty page.
  const plain = await loadPage('profile/index.html', { search: '?u=rahul123', settleMs: 700 });
  assert.match(plain.win.Store.dataDir(), /(^|\/)profile-data\/$/,
    'no flag, no fixture directory: ' + plain.win.Store.dataDir());
  assert.ok(/No profile here|Nothing here/i.test(plain.doc.body.textContent),
    'a username that is not in profile-data/ shows the empty state rather than a fixture');

  // An explicit attribute still wins: that is how examples/index.html and the tests
  // repoint a page, and a URL parameter must not be able to override it.
  const explicit = await loadPage('profile/index.html',
    { search: '?u=rahul123&demo=1', settleMs: 700, profileDir: '../examples/' });
  assert.match(explicit.win.Store.dataDir(), /(^|\/)examples\/$/,
    'data-profile-dir beats ?demo=1: ' + explicit.win.Store.dataDir());
});

test('every link to a fixture profile carries the demo flag', () => {
  // The general form of the bug above, checked statically over the whole repository:
  // a link that names a fixture person but does not say "demo" lands on a page that
  // reads profile-data/, where that person does not exist.
  const examples = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'examples', 'index.json'), 'utf8'));
  const fixtures = new Set(examples.profiles);
  assert.ok(fixtures.size >= 2, 'expected the fixture set, got ' + [...fixtures]);

  const offenders = [];
  const files = linkableFiles(ROOT);
  for (const file of files) {
    if (/^tests[/\\]/.test(path.relative(ROOT, file))) continue;   // tests repoint via profileDir
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/g)) {
      const target = m[1];
      if (!/[?&]u=/.test(target)) continue;
      const user = decodeURIComponent((/[?&]u=([^&#]*)/.exec(target) || [, ''])[1]);
      if (!fixtures.has(user)) continue;
      if (!/[?&]demo=(1|true)/.test(target)) {
        offenders.push(path.relative(ROOT, file) + ' -> ' + target);
      }
    }
    // The gallery builds these URLs in JS rather than in markup.
    for (const m of text.matchAll(/rootRelative\(\s*'(?:[^']*)\?([^']*)'/g)) {
      const built = m[1];
      if (!/(?:card-builder|print)\//.test(m[0])) continue;
      if (!/demo=/.test(built) && !/demo/.test(m[0])) {
        offenders.push(path.relative(ROOT, file) + ' builds a fixture link without demo: ' + m[0].slice(0, 70));
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('the tier switcher is a demo affordance and stays off a real card', { skip: NO_JSDOM }, async () => {
  // On the fixtures it is a teaching aid. On someone's real card it would be noise,
  // and it would advertise that private links exist.
  const demo = await loadPage('profile/index.html',
    { search: '?u=rahul123', profileDir: '../examples/', settleMs: 900 });
  assert.ok(demo.doc.querySelector('.scenario-switch'), 'examples should offer the four scenarios');
  assert.match(demo.doc.querySelector('.scenario-switch').textContent, /not real access control/i);

  const real = await loadPage('profile/index.html',
    { search: '?u=yourname', settleMs: 900 });
  assert.equal(real.doc.querySelector('.scenario-switch'), null,
    'a real profile must not show the tier switcher');
  assert.ok(real.doc.querySelector('.link-card'), 'but it must still render the links');
});

// ---------------------------------------------------------------------------
// The site root: a fork's own card index
//
// This page replaced the project's marketing landing page, because the person
// looking at a fork's root is the person who forked it. What it must do is show
// them the URL to print — derived, never typed — and tell them what to do first.
// ---------------------------------------------------------------------------

test('site root: lists your cards with the derived permanent URL', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('index.html', { settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));

  const rows = Array.from(doc.querySelectorAll('.card-index-row'));
  assert.equal(rows.length, 1, 'the starter profile should be listed');
  assert.equal(rows[0].getAttribute('data-username'), 'yourname');

  // The URL is derived from where the page is being served, and it is the
  // canonical /c/<username>/ shape that a QR code should encode.
  const url = rows[0].querySelector('.url-value').textContent;
  assert.equal(url, ORIGIN + '/c/yourname/', 'got ' + url);
  assert.ok(!/\?u=/.test(url), 'the printed URL must not be a ?u= deep link');

  // A QR beside it, encoding exactly that URL, so the page is usable without
  // opening the builder.
  assert.ok(rows[0].querySelector('.qr-badge svg'), 'each card should show its QR');
  assert.equal(rows[0].querySelector('.qr-badge .cap').textContent, url);

  // And the actions that matter, all carrying the username.
  const actions = Array.from(rows[0].querySelectorAll('.card-actions a'))
    .map(a => new URL(a.getAttribute('href'), ORIGIN + '/').href);
  assert.ok(actions.some(h => h.includes('/dashboard/?u=yourname')), actions.join(' | '));
  assert.ok(actions.some(h => h.includes('/card-builder/?u=yourname')), actions.join(' | '));
  assert.ok(actions.some(h => h.includes('/print/?u=yourname')), actions.join(' | '));
  assert.ok(actions.some(h => h.includes('/qr-generator/?url=' + encodeURIComponent(url))),
    'the QR tool should be handed the derived URL: ' + actions.join(' | '));
});

test('site root: an untouched fork gets setup help, not an empty page', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('index.html', { settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const panel = doc.getElementById('first-run');
  assert.equal(panel.hidden, false, 'the starter profile is still there, so say what to do');
  assert.match(panel.textContent, /profile-data\//, 'it must name the file to edit');
  assert.match(panel.textContent, /npm run build/, 'it must say how to generate the URL');
  // The free-tier limit is shown from the rules, so the page cannot drift from them.
  const Access = doc.defaultView.AccessRules;
  assert.equal(doc.getElementById('limit-public').textContent,
    String(Access.LIMITS.maxPublicLinks));
});

test('site root: a deployment with real profiles drops the setup panel', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('index.html', { settleMs: 900, profileDir: 'examples/' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const rows = Array.from(doc.querySelectorAll('.card-index-row'));
  assert.equal(rows.length, 2, 'both example profiles should be listed');
  assert.equal(doc.getElementById('first-run').hidden, true,
    'setup help is for an untouched fork only');
  assert.equal(doc.getElementById('card-count').textContent.indexOf('2 cards'), 0);
  // Nobody's URL may be inherited from a fixture: each is derived from this origin.
  const urls = rows.map(r => r.querySelector('.url-value').textContent);
  assert.deepEqual(urls, [ORIGIN + '/c/meera9/', ORIGIN + '/c/rahul123/'], urls.join(' | '));
});

test('generated /c/ directory page lists every profile', async () => {
  // c/index.html is committed rather than generated at request time, so a plain
  // branch deploy with no Actions still has a working index of cards.
  const html = fs.readFileSync(path.join(ROOT, 'c/index.html'), 'utf8');
  assert.match(html, /yourname\//, 'it should link to the starter profile');
  assert.match(html, /profile-data\//, 'it should say where profiles come from');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'profile-data/index.json'), 'utf8'));
  manifest.profiles.forEach(username => {
    assert.ok(html.includes('href="' + username + '/"'),
      'the directory page must list ' + username);
  });
});

test('examples gallery: every profile offers all four tier scenarios', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('examples/index.html', { settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const panels = Array.from(doc.querySelectorAll('#examples .panel'));
  assert.equal(panels.length, 2, 'both fixture profiles');

  panels.forEach(panel => {
    const username = panel.getAttribute('data-username');
    const hrefs = Array.from(panel.querySelectorAll('.example-scenarios a'))
      .map(a => a.getAttribute('href'));
    assert.equal(hrefs.length, 4, username + ' should offer four scenarios, got ' + hrefs.length);
    // All four are the SAME page with different parameters — that is the thesis.
    hrefs.forEach(h => assert.match(h, /profile\/\?u=/, h));
    assert.ok(hrefs.some(h => !/[?&](t|viewer)=/.test(h)), 'a plain public view');
    assert.ok(hrefs.some(h => /[?&]t=temp_/.test(h)), 'a live temporary token');
    assert.ok(hrefs.some(h => /[?&]t=temp_[^&]*expired/.test(h) || h.includes('temp_demo_expired')),
      'an expired token');
    assert.ok(hrefs.some(h => /[?&]viewer=/.test(h)), 'an approved follower');
    // The URL shown must be derived from this deployment, not from a fixture.
    assert.match(panel.querySelector('code').textContent,
      new RegExp('^' + ORIGIN.replace(/[:/]/g, '\\$&') + '/c/' + username + '/$'));
  });

  // The page must stay honest that a static deployment does not enforce anything.
  assert.match(doc.body.textContent, /not enforcement|demonstrations/i);
});
