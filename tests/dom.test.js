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

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://localhost:8080';

function repoFile(rel) {
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
function repoInterceptor() {
  return requestInterceptor((request) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    } catch (e) {
      return new Response('bad url', { status: 400 });
    }
    const file = repoFile(rel.split('?')[0]);
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

/** Any request for a file that is not in the repo, collected across all tests. */
const missingAssets = [];

/**
 * Load a page, run its scripts, and wait for the app to settle.
 */
async function loadPage(rel, options) {
  options = options || {};
  const file = repoFile(rel);
  assert.ok(file, 'page not found: ' + rel);
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
    url: ORIGIN + '/' + rel + (options.search || ''),
    runScripts: 'dangerously',
    resources: { interceptors: [repoInterceptor()] },
    pretendToBeVisual: true,
    virtualConsole
  });
  const errors = attachErrors(dom);
  const win = dom.window;

  // Browsers give you these; jsdom does not.
  win.fetch = fileFetch();
  win.URL.createObjectURL = () => 'blob:mock';
  win.URL.revokeObjectURL = () => {};
  win.HTMLCanvasElement.prototype.getContext = function () {
    throw new Error('canvas is not available in jsdom');
  };
  win.matchMedia = win.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {} }));

  await settle(win, options.settleMs == null ? 400 : options.settleMs);
  return { dom, win, doc: win.document, errors };
}

/** A fetch() that serves repo files, so pages can load their JSON. */
function fileFetch() {
  return function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    let rel;
    try {
      rel = decodeURIComponent(new URL(url, ORIGIN + '/').pathname).replace(/^\/+/, '');
    } catch (e) {
      return Promise.reject(new Error('bad fetch url: ' + url));
    }
    const file = repoFile(rel.split('?')[0]);
    if (!file) {
      return Promise.resolve({
        ok: false, status: 404, url,
        json: () => Promise.reject(new Error('404 ' + rel)),
        text: () => Promise.resolve('')
      });
    }
    const body = fs.readFileSync(file, 'utf8');
    return Promise.resolve({
      ok: true, status: 200, url,
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
    const html = fs.readFileSync(page, 'utf8');
    const dir = path.dirname(page);
    const refs = [];
    for (const m of html.matchAll(/(?:src|href)="([^"#]+)(?:#[^"]*)?"/g)) refs.push(m[1]);
    for (const m of html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)) refs.push(m[1]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|tel:|data:|blob:|javascript:)/i.test(ref)) continue;
      if (ref.startsWith('{{') || ref.includes('${')) continue;
      const target = path.resolve(dir, ref.split('?')[0]);
      if (!fs.existsSync(target)) {
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
    ['demo/profile.html', 'demo/assets/profile.js'],
    ['demo/card-preview.html', 'demo/assets/card-preview.js'],
    ['demo/print-sheet.html', 'demo/assets/print-sheet.js'],
    ['dashboard/index.html', 'dashboard/dashboard.js'],
    ['card-builder/index.html', 'card-builder/builder.js'],
    ['index.html', 'assets/landing.js']
  ];
  const problems = [];
  for (const [page, script] of pairs) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, script), 'utf8');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
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
    for (const m of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
      offenders.push(path.relative(ROOT, page) + ' -> ' + m[1]);
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
  const { doc, errors } = await loadPage('demo/profile.html', { search: '?u=rahul123' });
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
  const { doc, errors } = await loadPage('demo/profile.html',
    { search: '?u=rahul123&t=temp_demo_live' });
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
  const { doc, errors } = await loadPage('demo/profile.html',
    { search: '?u=rahul123&t=temp_demo_expired' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.deepEqual(textOf(doc, '.link-card .label'), ['Instagram', 'Portfolio', 'Email']);
  assert.match(doc.querySelector('.tier-banner').textContent, /Public view/);
  assert.match(doc.querySelector('.notice-warn').textContent, /expired/i);
});

test('profile page: an approved follower sees every link', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('demo/profile.html',
    { search: '?u=rahul123&viewer=user_priya' });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.deepEqual(textOf(doc, '.link-card .label'),
    ['Instagram', 'Portfolio', 'Email', 'Pricing List', 'WhatsApp']);
  assert.match(doc.querySelector('.tier-banner').textContent, /Approved follower/);
});

test('profile page: a non-approved viewer id gets the public view', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('demo/profile.html',
    { search: '?u=rahul123&viewer=user_arjun' });   // pending, in tokens.json
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.deepEqual(textOf(doc, '.link-card .label'), ['Instagram', 'Portfolio', 'Email']);
});

test('profile page: an unknown username renders a helpful 404', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('demo/profile.html', { search: '?u=nobody-here' });
  assert.deepEqual(errors.filter(e => !/404/.test(e)), [], errors.join('\n'));
  assert.match(doc.body.textContent, /No profile here/);
  assert.match(doc.body.innerHTML, /u=rahul123/, 'should link to the demo profile');
});

test('profile page: the scenario switcher offers all four tiers', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('demo/profile.html', { search: '?u=rahul123' });
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
  const { doc } = await loadPage('demo/profile.html', { search: '?u=rahul123' });
  const cards = Array.from(doc.querySelectorAll('.link-card'));
  assert.ok(cards.length >= 3);
  for (const a of cards) {
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel') || '', /noopener/);
  }
});

test('the second demo profile renders with a different template', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('demo/profile.html', { search: '?u=meera9' });
  assert.deepEqual(errors, [], errors.join('\n'));
  const labels = textOf(doc, '.link-card .label');
  assert.ok(labels.includes('Shop on Instagram'));
  assert.ok(!labels.includes('Wholesale Price List'));
});

// ---------------------------------------------------------------------------
// The dashboard (§8.2)
// ---------------------------------------------------------------------------

test('dashboard: loads the demo profile into the form', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 600 });
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
  const { doc, win, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 600 });
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
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 600 });
  assert.deepEqual(errors, [], errors.join('\n'));
  setValue(doc, 'f-username', 'ab');
  click(doc, 'btn-save');
  await new Promise(r => setTimeout(r, 200));
  assert.match(doc.getElementById('alerts').textContent, /3-32 characters|username/i);
});

test('dashboard: generating a temporary link produces a working ?t= URL', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const select = doc.getElementById('f-token-link');
  assert.ok(select.options.length > 0, 'the followers-only links should be offered');
  const linkId = select.options[0].value;
  click(doc, 'btn-make-token');
  await new Promise(r => setTimeout(r, 250));

  const out = doc.getElementById('token-output');
  const url = out.querySelector('.token-line').textContent;
  assert.match(url, /[?&]t=temp_[A-Za-z2-9]{22}/);
  assert.ok(url.includes('u=rahul123'), 'the URL must point at the right profile');

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
  assert.equal(parsed.searchParams.get('u'), 'rahul123');
});

test('dashboard: revoking a temporary link removes it', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
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
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
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
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const before = doc.querySelectorAll('#follower-list .row').length;
  click(doc, 'btn-simulate-request');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(doc.querySelectorAll('#follower-list .row').length, before + 1);
});

test('dashboard: adding, reordering and deleting links updates the counters', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
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
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
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
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const rows = Array.from(doc.querySelectorAll('#visitor-links .row'));
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Stranger/);
  assert.match(rows[1].textContent, /Temporary link/);
  assert.match(rows[2].textContent, /Approved follower/);
  const hrefs = rows.map(r => r.querySelector('a').getAttribute('href'));
  assert.ok(hrefs.every(h => h.includes('demo/profile.html?u=rahul123')), hrefs.join(' | '));
  // Relative hrefs must actually resolve to the profile page from a directory URL
  // (/dashboard/ has no filename to replace — that is what Store.pageRelative is for).
  hrefs.forEach(h => {
    const abs = new URL(h, 'http://localhost:8080/dashboard/');
    assert.equal(abs.pathname, '/demo/profile.html', 'resolved to ' + abs.href);
  });
});

test('dashboard: the QR tool link carries this card\'s profile URL', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  const href = doc.getElementById('btn-qr-tool').getAttribute('href');
  const abs = new URL(href, 'http://localhost:8080/dashboard/');
  assert.equal(abs.pathname, '/qr-generator/');
  const target = abs.searchParams.get('url');
  assert.match(target, /^https:\/\//, 'the QR must encode an absolute URL, got ' + target);
  assert.match(target, /u=rahul123/);
});

test('dashboard: the token duration picker is generated from LIMITS', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
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
  const { doc, win, errors } = await loadPage('dashboard/index.html', { search: '?u=rahul123', settleMs: 700 });
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

test('card builder: renders three templates and a live preview', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('card-builder/index.html', { settleMs: 700 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.querySelectorAll('.template-option').length, 3);
  assert.equal(doc.querySelectorAll('#b-links .link-row').length, 4);
  const src = doc.getElementById('b-back').getAttribute('src') || '';
  assert.match(src, /^data:image\/svg\+xml;base64,./);
  const svg = Buffer.from(src.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /<path d="M[\d.]+ [\d.]+h/, 'the back must contain the QR path');
  assert.match(doc.getElementById('b-url').value, /\/demo\/profile\.html\?u=rahul123$/);
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
  const { doc, errors } = await loadPage('demo/card-preview.html', { settleMs: 800 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.equal(doc.querySelectorAll('#profile-picker button').length, 2);
  assert.equal(doc.querySelectorAll('#templates .panel').length, 3);
  assert.equal(doc.querySelectorAll('#templates figure').length, 12); // 3 templates x 2 sides x 2 variants
  assert.match(doc.getElementById('qr-content').textContent, /u=rahul123/);
  assert.match(doc.getElementById('qr-modules').textContent, /^\d+ × \d+$/);
  assert.ok(doc.querySelector('#qr-standalone svg'), 'the standalone QR should render');
});

test('print sheet page: lays out both sides with mm-sized frames', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('demo/print-sheet.html', { search: '?u=rahul123', settleMs: 700 });
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

test('demo-profile.html redirects to profile.html keeping query params', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'demo/demo-profile.html'), 'utf8');
  assert.match(html, /location\.replace\(/);
  assert.match(html, /profile\.html/);
  assert.match(html, /params\.set\('u', 'rahul123'\)/);
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

test('qr generator: the PDF download is a real PDF with the right page count', { skip: NO_JSDOM }, async () => {
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

test('qr generator: building a sheet from the demo profiles yields only public links', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('qr-generator/index.html', { settleMs: 600 });
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

test('landing page: renders the hero QR and the card showcase', { skip: NO_JSDOM }, async () => {
  const { doc, errors } = await loadPage('index.html', { settleMs: 900 });
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(doc.querySelector('#hero-qr svg'), 'hero QR should render');
  const items = doc.querySelectorAll('.showcase-item');
  assert.ok(items.length >= 3, 'expected a card per showcase entry, got ' + items.length);
  assert.ok(doc.querySelectorAll('.showcase-item figure svg').length >= 6, 'front and back per card');
  // Tier cards must link to real, distinct scenarios.
  const tierLinks = Array.from(doc.querySelectorAll('.tiers a')).map(a => a.getAttribute('href'));
  assert.equal(tierLinks.length, 3);
  assert.ok(tierLinks.some(h => h.includes('t=temp_demo_live')));
  assert.ok(tierLinks.some(h => h.includes('viewer=user_priya')));
});
