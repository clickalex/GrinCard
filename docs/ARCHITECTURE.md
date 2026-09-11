# Architecture

How this project is put together, why it is put together that way, and — most importantly —
exactly what it does and does not protect you from.

---

## 1. The one idea

A printed card cannot be updated. A URL can.

So the card carries a URL, and the URL is **permanent**: it is the identity, not the content.
Everything that changes — your links, your photo, your pricing, whether a given visitor is
allowed to see a given link — lives behind that URL and can change the day after you print
ten thousand cards.

```
        printed once, never changes
                    │
        ┌───────────▼───────────┐
        │  /c/rahul123          │   ← the QR code on the back of the card
        └───────────┬───────────┘
                    │  who is asking?
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
  stranger      token holder    approved follower
  public links  public + 1      everything
                private link
```

The three outcomes are called **tiers**, and they are the product. Everything else in this
codebase exists to serve them.

---

## 2. The three access tiers

| Tier | Reached by | Sees | Defined in |
| --- | --- | --- | --- |
| `public` | `/c/rahul123` with no token and no session | Links with `visibility: "public"`, up to `LIMITS.maxPublicLinks` | [spec §5.1](../PLANNING.md) |
| `temporary` | `/c/rahul123?t=temp_abc123` | Public links **plus exactly one** `followers_only` link named by the token | `AccessRules.evaluateToken` |
| `follower` | An approved follower id (a session in V2, `?viewer=` in this demo) | Every link | `AccessRules.isApprovedFollower` |

Tier is **not** a property of the profile. It is a property of one request, computed fresh
each time. The same profile produces all three views.

Two rules fall out of this and are enforced everywhere:

- **A temporary link is never printed.** It expires. A card that stops working is worse than
  a card that never worked, so the QR on a card always encodes the permanent URL. Temporary
  links are for chat, email and QR codes shown on a screen.
- **Failing a tier check downgrades, it does not error.** An expired token, a used-up token, a
  token from someone else's profile — all of them render the public view with a short
  explanation. Nobody who scans your card should ever see a 404 because of a clock.

---

## 3. The decision logic

This is [spec §6.2](../PLANNING.md), and it is implemented once, in
`AccessRules.resolveAccess(profile, context, registry, atTime)`:

```
if (context.viewerId is an APPROVED follower of this profile)
    tier = follower                      → all links
else if (context.token exists)
    verdict = evaluateToken(token, profile.username, registry, now)
    if (verdict.valid)
        tier = temporary                 → public links + verdict.linkId
    else
        tier = public                    → public links + a notice explaining why
else
    tier = public                        → public links
```

Order matters: an approved follower who *also* arrives with a token still sees everything.
The token can only widen access, never narrow it.

`evaluateToken` returns a verdict rather than a boolean, because the reason is part of the
user experience:

| `reason` | Meaning | What the visitor sees |
| --- | --- | --- |
| `ok` | Valid, and here is the `linkId` it unlocks | The extra link, flagged *Unlocked* |
| `malformed` | Not shaped like a token (`temp_` + 22 chars) | Public view, no message — this is usually a typo or a scanner |
| `not_found` | No such token | Public view, no message — we do not confirm whether tokens exist |
| `wrong_profile` | A real token, but for someone else | Public view, no message |
| `expired` | Past `expires_at` | Public view + "This temporary link has expired" |
| `exhausted` | `current_uses >= max_uses` | Public view + "This temporary link can no longer be used" |

The silent cases are deliberate. Telling an anonymous visitor "that token belongs to someone
else" turns a URL into an oracle for probing other people's tokens.

### Limits

```js
AccessRules.LIMITS = {
  maxPublicLinks: 5,          // free tier
  maxActiveTokens: 1,         // free tier
  tokenDurationsSeconds: { '10m': 600, '1h': 3600, '24h': 86400, '7d': 604800 }
}

AccessRules.durationOptions()   // [{ key, seconds, label }] shortest first
AccessRules.humanDuration(604800)  // '7 days'
```

One object, one file, no licence check anywhere in the codebase. A self-hoster who wants 50
public links edits one number; adding a duration to `tokenDurationsSeconds` adds it to the
dashboard's picker too, because the picker is generated from `durationOptions()` rather than
hardcoded in the HTML. That is intentional: these are product decisions for a hosted
service, not restrictions on the software. See [PLANNING.md](../PLANNING.md) for what a paid
tier is meant to contain (cosmetics and hosting — never the ability to share your own links).

---

## 4. Where the data comes from

V1 has no backend. There are two sources, merged in `lib/store.js`:

```
profile-data/<username>.json   ← the published truth, in the repo, served to everyone
        +
localStorage['qrlinkcard.v1.profile.<username>']   ← your unsaved edits in this browser
        =
the profile the pages render
```

The merge rule is simple and always favours the local copy, because the local copy is
something a human just typed. `Store.loadProfile()` also records where the result came from
(`_source: 'repo' | 'local'`), and the dashboard shows that in its subtitle so you are never
unsure which one you are looking at.

### Two things a static host cannot do

**It cannot list a directory.** So `tools/build-links.js` writes `index.json` beside the
profiles, and `Store.listProfiles()` reads that. `npm run build` regenerates it, `npm run
validate` fails if it is stale, and the Pages workflow regenerates it on deploy. Forgetting it is
therefore a cosmetic problem — the index page does not list the new person — and never a broken
link, because `/c/<username>/` loads `<username>.json` by name.

**It cannot rewrite a URL.** So the permanent address a card prints, `/c/<username>/`, is a real
file: a generated ~14-line stub that runs the same renderer as `profile/`. Stubs are gitignored
(they are derived, and a renamed profile should not leave a stale URL behind), and `404.html`
boots the same renderer for any path — see §4b.

### Two data directories, deliberately separate

`profile-data/` is yours: it ships one starter profile (`yourname.json`) and is what the site
root, the dashboard and your printed cards read. `examples/` belongs to the project: fixture
people with fixture tokens, used by `examples/` and `templates/` for previews and by the test
suite as assertions. A page chooses between them with `<body data-profile-dir>`, which is also
why a public gallery can never render the owner's private links.

The same pattern applies to `examples/tokens.json`, which is merged with
`localStorage['qrlinkcard.v1.tokens.<username>']`. Tokens that came from the repo are marked
`_remoteTokens` and shown read-only in the dashboard: you cannot revoke a file that lives in
git from a browser, and pretending otherwise would silently copy the token into
`localStorage` where it would haunt you.

Keys:

```
qrlinkcard.v1.profile.<username>     an edited profile
qrlinkcard.v1.tokens.<username>      { tokens: [...], followers: [...] } you created
qrlinkcard.v1.viewer                 the id you are simulating a visit as
qrlinkcard.v1.lastUsername           "continue where you left off"
qrlinkcard.v1.qrgen.list             the QR generator's batch input
qrlinkcard.v1.qrgen.options          the QR generator's settings
```

`Store.clearLocal()` wipes all of them; the dashboard has a button for it.

---

## 4b. Nothing knows where it is deployed

This repository is a template, so the most important architectural rule is not about cards: **no
file may contain a deployment URL.** Not a domain, not a repository name, not a directory depth.

The alternative is a fork that has to edit its own URLs — which means a person editing config they
do not understand, and the failure mode is a printed QR code that opens someone else's website.
That is unrecoverable, because the card is already in a wallet.

So the deployment root is *derived*:

```
Store.siteRoot()          reads the URL of its own <script> tag
                          (this file is always <root>/lib/store.js)
        ↓
Store.profileUrlFor(u)    <root>/c/<username>/   ← what a QR encodes
Store.rootRelative(p)     '../' × depth + p      ← every in-page link
```

Three consequences worth knowing:

1. **One renderer, three hosts.** `profile/profile.js` renders entirely into `#profile-root` from
   JSON, so `profile/boot.js` can hand it a chrome and a username from anywhere: `/profile/?u=x`,
   a generated `/c/x/` stub, or `404.html` at an arbitrary depth. Nothing in the renderer knows
   which host it is running under.
2. **`404.html` is part of the architecture, not an error page.** A static host serves it for a
   missing path while keeping the requested URL in the address bar. It cannot know its own depth in
   advance, so it *probes* for a file that always exists (`lib/store.js`) at increasing depths and
   uses the first hit — then boots the renderer in place. No redirect, so the URL a person scanned
   is the URL they see. This is what makes a plain branch deploy work with no build step at all.
3. **An override exists and is narrow.** An absolute `profile_url` in a profile, or
   `<body data-site-root>`, wins over derivation — that is how someone points a card at a domain
   they own. A *relative* `profile_url` is ignored, because honouring one is how a copied fixture
   produces a card pointing at the wrong site.

---

## 5. The one-layout rule

A card is built **once** into a display list, and rendered twice:

```
profile JSON ──► Card.buildCard() ──► display list ──┬──► Card.toSVG()      → screen preview
                     (lib/card.js)   (mm, y-down)    └──► PdfCard.generate() → print PDF
```

A display list is a flat array of drawing commands in **millimetres**, with y increasing
downwards — the coordinate system a designer thinks in, not the one PDF uses:

```js
{ type: 'rect',   x: 0,  y: 0,  w: 89, h: 51, fill: '#141428', radius: 2.5 }
{ type: 'text',   x: 34, y: 24, text: 'Rahul Kumar', sizePt: 17, weight: 700, fill: '#fff' }
{ type: 'qr',     x: 55, y: 10, sizeMm: 30, ecl: 'Q', url: 'https://…' }
{ type: 'circle', cx: 18, cy: 25.5, r: 11, fill: '…', stroke: '…' }
{ type: 'image',  x: 7,  y: 14.5, w: 22, h: 22, href: 'data:image/jpeg;base64,…', clip: 'circle' }
```

Why bother? Because the alternative is the bug this design eliminates. If the screen preview
is HTML/CSS and the print output is a canvas rasterisation of that HTML, then the two are
different programs, and they *will* disagree — a font metrics difference, a rounding
difference, a browser version difference. You find out at the print shop.

With one display list, "the preview is wrong" and "the PDF is wrong" become the same bug with
the same fix, and the PDF is real vector geometry at exactly 89 × 51 mm rather than a picture
of a webpage.

`lib/pdf.js` converts mm → points (`1 mm = 72/25.4 pt`) and flips y at the last possible
moment, so nothing above it ever needs to know PDF's coordinate system exists.

**This is also a deliberate departure from the original spec**, which called for
`html2canvas` + PNG. The reasoning is in [§10](#10-decisions-and-alternatives).

---

## 6. Module map

Every file is a UMD module: a browser global, or `require()` in Node. No bundler, no
transpiler, no `node_modules` at runtime.

| File | Global | Responsibility | Depends on |
| --- | --- | --- | --- |
| `lib/qr.js` | `QRCode` | QR encoding: segments, Reed–Solomon, masking, penalty scoring, SVG/ASCII/data-URL output | nothing |
| `card-templates/card-templates.js` | `CardTemplates` | The template registry (colours, type sizes, layout, geometry constants) | nothing |
| `lib/access.js` | `AccessRules` | Tiers, tokens, followers, validation, limits | nothing |
| `lib/card.js` | `Card` | profile + template → display list → SVG | `CardTemplates`, `QRCode` |
| `lib/pdf.js` | `PdfCard` | display list → vector PDF 1.4 (photos, gradients, bleed) | `Card` |
| `lib/pdfdoc.js` | `SimplePdf` | generic PDF writer: any page size, rects, text | nothing |
| `lib/store.js` | `Store` | derive the deployment root; fetch profile JSON; merge `localStorage` | `AccessRules` |
| `lib/export.js` | `Exporter` | SVG/PNG/PDF download, photo embedding, clipboard | `Card`, `PdfCard`, `CardTemplates` |
| `qr-generator/generator.js` | `QrGenerator` | batch QR, paper layout, sheet SVG + PDF | `QRCode`, `SimplePdf` |
| `profile/boot.js` | `ProfileBoot` | resolve the username and build the chrome at any depth | `Store` |
| `profile/profile.js` | `ProfileRender` | the profile renderer itself | `Store`, `AccessRules`, `CardTemplates` |
| `card-templates/community/*.js` | — | contributed templates; self-register on load | `CardTemplates` |

Node-only, and not part of the shipped site:

| File | Responsibility |
| --- | --- |
| `tools/build-links.js` | profile JSON → manifests, the `/c/` directory page, per-username stubs |
| `tools/build-templates.js` | validate contributions, keep the community manifest in sync |
| `tools/check-links.js` | every internal link in every page and document resolves |

Dependency arrows point one way and there are no cycles. `qr.js`, `access.js` and
`card-templates.js` know nothing about the DOM, which is why they can be tested in plain Node
and reused in a future backend without modification.

`lib/pdf.js` and `lib/pdfdoc.js` are both PDF writers, which looks redundant and is not:
`pdf.js` is specialised (it understands the card display list, embeds JPEG/PNG photos, clips
them to circles, draws gradients, adds bleed) while `pdfdoc.js` is general (any page size,
rectangles and text) and exists so the QR generator does not need to pretend a sheet of A4 is
a business card. `pdfdoc.js` is also the extension point if you want to script your own print
products — stickers, tent cards, badge inserts.

---

## 7. Pages

| Page | Reads | Writes |
| --- | --- | --- |
| `index.html` | `profile-data/index.json` + each profile | nothing |
| `c/<username>/` | that profile + registry (generated stub) | `lastUsername` only |
| `c/` | the manifest (generated directory page) | nothing |
| `profile/` | `?u`, `?t`, `?viewer`, profile JSON, registry | `lastUsername` only |
| `404.html` | the requested path, then the profile it names | `lastUsername` only |
| `dashboard/` | `?u` or `lastUsername` | profile, tokens, followers in `localStorage` |
| `card-builder/` | `?u` or `lastUsername`, or the starter defaults | `lastUsername`; offers a JSON download |
| `print/` | `?u`, `lastUsername`, or the first real profile | nothing |
| `templates/` | `examples/` fixtures + every registered template | nothing |
| `examples/` | `examples/*.json` including tokens | nothing |
| `qr-generator/` | `?url`, `?mode`, saved batch, your profiles | its own list and options |

No page defaults to a hardcoded fixture username any more. Where a page needs "someone", it asks
the manifest for the first profile that is not the starter — so on a fork it lands on the fork's
own person.

The profile page is deliberately the only one that a stranger ever loads, and it is the only
one that must be fast and correct on a mid-range Android phone over mobile data. It fetches
one JSON file, renders, and does no writing beyond remembering which profile you last viewed.

---

## 8. The V1 trust model — read this before trusting a private link

**V1 proves the user experience. It does not enforce privacy.**

When a visitor opens `profile/?u=rahul123`, their browser downloads
`examples/rahul123.json`. That file contains *every* link, including the
`followers_only` ones, because in V1 the file is static and there is no server to filter it.
The tier logic then decides what to **render**. A visitor who opens their browser's devtools
can read what was not rendered.

So the honest statement of V1's guarantee is:

> A visitor sees the right thing without trying. A visitor who is actively curious can see
> everything.

That is a demonstration, and it is fine for a price list or a portfolio draft. It is not fine
for anything that would hurt you if it were public. The UI says so out loud: the
[examples gallery](../examples/) leads with *"these are demonstrations, not enforcement"*, and
the card page itself links here rather than promising more than a static host can keep.

### What V2 changes

The fix is not more client-side cleverness. It is moving the decision to a place the visitor
does not control:

```
GET /api/profile/rahul123?viewer=…&token=…
  → 200 { username, display_name, links: [ …only the ones you may see… ] }
```

The server runs the *same* `resolveAccess()` logic — `lib/access.js` has no DOM dependencies
precisely so it can be lifted into a Node/Cloudflare Worker/Deno handler unchanged — and
returns a profile that simply does not contain the links the requester may not see. Nothing
hidden arrives at the device, so there is nothing to find in devtools.

The client contract stays identical:

```js
// V1
Store.loadProfile(username).then(profile => render(profile))

// V2
fetch('/api/profile/' + username + qs).then(r => r.json()).then(profile => render(profile))
```

`AccessRules.resolveAccess()` already accepts a resolved decision, so a V2 client can pass the
server's answer straight through and render it. This is the single most important structural
decision in V1: **the access logic is a pure function of (profile, context, registry, time),
so it can run on either side of the network without being rewritten.**

### Everything else V2 needs

| Concern | V1 | V2 |
| --- | --- | --- |
| Profile storage | JSON files in git | A database, or files + an API |
| Tokens | `tokens.json` + `localStorage` | Rows with `uses`, expiry enforced server-side |
| Followers | `?viewer=` simulation | Real accounts, sessions, and an approve/reject inbox |
| Use counting | Not counted (a static file cannot count) | `current_uses` incremented atomically per hit |
| Analytics | None | Optional scan counts per card, per token |
| Rate limiting | None (static hosting does it for you) | Needed once tokens are checked server-side |

`max_uses` already exists in the token schema and `evaluateToken()` already honours it. It
cannot *work* in V1 because a static file cannot increment a counter — that field is present
so that V2 does not need a schema migration.

---

## 9. Physical equals digital

[Spec §20](../PLANNING.md) asks that the card and the web page feel like the same object. In
code, that means one source of colours:

```
card-templates/card-templates.js   template-1: { background: {from: '#141428', to: '#232345'},
                                                 accent: '#f2b134', nameColor: '#ffffff', … }
        │
        ├──► Card.buildCard()   → the printed card
        └──► CardTemplates.toCssVars()  → :root { --bg: #141428; --accent: #f2b134; … }
                                          consumed by assets/styles.css
```

Change a template's accent colour and the card, the profile page, its link cards, its share
block and the print preview all change together, because they are all reading the same registry.
There is no second copy of the palette to keep in sync, which is the usual way this kind of
promise gets broken.

---

## 10. Decisions and alternatives

**Vector PDF instead of `html2canvas` + PNG.** The spec asked for `html2canvas`. It produces a
raster of your DOM at screen resolution, so a card downloaded on a 1× display prints soft, the
QR edges are anti-aliased (which costs scan reliability), the file is hundreds of KB instead of
a few KB, and the physical size is whatever the CSS happened to be that day. Writing the PDF
directly costs about 700 lines and gives exact millimetre geometry, selectable text, crisp QR
paths and a file a print shop can impose into a gang run. It also removes a CDN dependency,
which matters because [§20](../PLANNING.md) wants this to work offline.

**A from-scratch QR encoder instead of `qrcode.js` from a CDN.** Same reasoning, plus the CDN
version is the single point of failure on a printed artefact: if the CDN changes URL, every
card in the world silently stops generating previews. `lib/qr.js` is verified against the
reference `qrcode` npm package (byte-identical matrices across versions and error-correction
levels) and against `jsQR` (the output decodes back to the input URL after being rendered at
300 DPI), so "no dependencies" does not mean "unverified".

**`localStorage` instead of a database.** It keeps V1 static-hostable, which keeps it free,
which is the whole premise. The cost is that edits are per-browser and invisible to visitors;
the dashboard therefore always offers a JSON export, and the file in `profile-data/` is the
published truth. `Store` merges the two rather than pretending either is complete.

**One display list instead of HTML preview + separate print code.** See [§5](#5-the-one-layout-rule).
This is the decision that most reduces the chance of a bad print run.

**Directory-relative paths everywhere.** `../lib/qr.js`, never `/lib/qr.js`. The site must work
at `username.github.io/repo/`, at a custom domain root, and inside a subdirectory of a larger
site, without a configuration step. The one place that needs care is turning a page's location
into a URL for a QR code — `Store.pageRelative()` exists for exactly that, because a directory
URL like `/card-builder/` has no filename to replace.

**No framework.** The largest page here is the dashboard, at roughly a thousand lines of
vanilla JS. A framework would add a build step, a dependency and a version-maintenance burden
to a project whose entire appeal is that you can read it and host it anywhere. The pages are
built from small `el()` helpers and explicit render functions instead; the trade is more lines
of code in exchange for zero indirection.

---

## 11. Testing strategy

Six suites, 168 tests, no browser required:

| Suite | What it proves |
| --- | --- |
| `tests/qr.test.js` | Our matrices are byte-identical to the reference encoder's, across versions and ECLs |
| `tests/card.test.js` | The display list is correct; the SVG is well formed; the PDF parses in `pdfjs-dist`; **a QR rendered from the PDF at 300 DPI decodes with `jsQR` to the exact profile URL** |
| `tests/access.test.js` | Every tier transition, every token failure reason, validation and limits |
| `tests/generator.test.js` | Batch parsing, paper layout, quiet zones, sheet PDF; **printed sheet codes decode back to their exact URLs** |
| `tests/dom.test.js` | Every page, executed in `jsdom` with real scripts and real events: public view, token unlock, expiry fallback and follower access, the share link's copy button, saving, minting, revoking, approving, exporting, the generated stub and the `404.html` fallback booting the real renderer, deployment-root discovery at every depth and under a `/<repo>/` prefix, plus static checks that no page references a missing file or a CDN, that every `getElementById` in a page script exists in its HTML, and that the nine globals do not collide |
| `tests/tools.test.js` | The generators: profile → stub/manifest correctness, the username-must-match-filename rule, a registry never published as a person, stale-manifest detection, idempotency, template validation and registration, link checking, and a guard against references to the pre-fork layout |

The oracles live **outside** the repository (`/tmp/oracle`, or `$QR_ORACLE_DIR`; see
`tests/oracle.js`) and the suites that need them skip with an install hint rather than crashing,
so `npm test` on a fresh clone passes 87 and skips 81 instead of failing. A
project whose premise is having no dependencies should not acquire them through its test setup.

The two round-trip tests are the ones that matter most. Rendering our own PDF with an
independent reader and decoding the pixels with an independent QR decoder is the only way to
know that a card printed today will scan in three years, and it catches a class of bug — wrong
quiet zone, wrong module size, wrong coordinate flip — that no amount of self-consistent
asserting would find.

`tests/dom.test.js` exists because a headless browser is not always available in CI. jsdom runs
the real page scripts against the real HTML with a file-backed fetch, so it catches the bugs
that actually ship: a typo in an element id, a script path that 404s, a click handler that
throws. It cannot rasterise, so anything involving canvas is covered by the PDF tests instead.

Three details of the harness are load-bearing rather than incidental, because each one was added
after it hid a real bug:

- **Polyfills are installed in `beforeParse`.** `404.html` boots from an *inline* script, which
  jsdom executes while constructing the DOM. Patching `window.fetch` afterwards would leave that
  page running without it — testing a different environment than a browser gives it.
- **Relative fetches resolve against the requested URL**, not the origin. That is what lets
  `404.html`'s base probe be tested honestly: it asks for `./lib/store.js`, then `../`, then
  `../../`, and the harness has to answer the way a server would.
- **A `deployBase` option serves the repo under a prefix**, so a GitHub Pages *project* site
  (`/<repo>/…`) is tested rather than assumed. Relative-path bugs only show up at depth.

CI also runs `npm run validate` and `node tools/check-links.js`, which together assert that the
generated files match the repository and that no page or document links to something that moved.
For a template that people restructure, those two catch more real breakage than any unit test.
