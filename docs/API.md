# API reference

Every module is UMD: a browser global from a `<script>` tag, or `require()` in Node. There is
no build step, no runtime dependency, and no transpilation — the files are ES5-compatible on
purpose, so they run in the browser a print shop's Windows 7 machine has.

```html
<script src="lib/qr.js"></script>          <!-- window.QRCode      -->
<script src="lib/access.js"></script>      <!-- window.AccessRules -->
```

```js
const QR = require('./lib/qr.js');
const AccessRules = require('./lib/access.js');
```

| Module | Global | Needs the DOM? |
| --- | --- | --- |
| [`lib/qr.js`](#qrcode) | `QRCode` | no |
| [`card-templates/card-templates.js`](#cardtemplates) | `CardTemplates` | no |
| [`lib/access.js`](#accessrules) | `AccessRules` | no |
| [`lib/card.js`](#card) | `Card` | no |
| [`lib/pdf.js`](#pdfcard) | `PdfCard` | no |
| [`lib/pdfdoc.js`](#simplepdf) | `SimplePdf` | no |
| [`lib/store.js`](#store) | `Store` | **yes** — `fetch`, `localStorage`, `location` |
| [`lib/export.js`](#exporter) | `Exporter` | **yes** — `Blob`, `URL`, `document`, canvas |
| [`qr-generator/generator.js`](#qrgenerator) | `QrGenerator` | no |

The three DOM-free modules at the top of that list are the ones a V2 backend can reuse as-is.

---

## QRCode

A complete QR encoder: byte-mode segments, versions 1–40, all four error-correction levels,
Reed–Solomon with block interleaving, all eight masks with full penalty scoring. Verified
byte-for-byte against the reference `qrcode` npm package.

### `QRCode.create(text, options?) → qr`

| Option | Default | Notes |
| --- | --- | --- |
| `ecl` | `'M'` | `'L' \| 'M' \| 'Q' \| 'H'`. Unknown values fall back to `'M'`. |
| `version` | auto | Force a version 1–40. Throws if the content does not fit. |
| `minVersion` | `1` | Smallest version the auto-picker may choose. |
| `mask` | auto | Force a mask 0–7. By default all eight are scored and the lowest penalty wins. |
| `margin` | — | Only used by the renderers, not by `create`. |

`text` may be a string (encoded as UTF-8 bytes) or a `Uint8Array` of raw bytes.

```js
const qr = QRCode.create('https://you.dev/c/rahul123', { ecl: 'Q' });
qr.version    // 3
qr.size       // 29 — modules per side
qr.mask       // 4  — the winning mask
qr.penalty    // 447 — its penalty score
qr.ecl        // 'Q'
qr.get(0, 0)  // true — top-left finder pattern is dark
qr.modules    // Uint8Array(841), row-major, 1 = dark
```

Throws `QRCode: content too long to encode (N bytes at ECC X)` when the payload exceeds
version 40.

### `QRCode.toSVG(textOrQr, options?) → string`

| Option | Default | Notes |
| --- | --- | --- |
| `margin` | `4` | Quiet zone, in modules. |
| `width` | `(size + 2·margin) · 4` | Output width in CSS px. The viewBox is always in modules, so it scales losslessly. |
| `colorDark` | `'#111111'` | |
| `colorLight` | `'#ffffff'` | |
| `title` | none | Adds an SVG `<title>` for screen readers. |

The first argument may be a string or an object from `create()` — passing the object avoids
encoding twice.

### `QRCode.toDataURL(text, options?) → string`

Same options as `toSVG`. Returns a base64 `data:image/svg+xml` URL, so it works in Node too
(no canvas involved) and stays sharp at any size.

### `QRCode.toASCII(text, options?) → string`

Two characters per module, for terminals and log output. Useful in a build script that wants to
show what it just generated.

### `QRCode.escapeXml(s) → string`

Escapes `< > & " '`. Exported because anything composing SVG by hand needs it and it is easy
to get subtly wrong.

---

## CardTemplates

The registry that makes "physical equals digital" true: the card and the web page read the same
colours from the same place.

### `CardTemplates.GEOMETRY`

```js
{
  widthMm: 89, heightMm: 51,   // ISO/IEC 7810 ID-1
  bleedMm: 3,                  // per edge, when enabled
  marginMm: 4,                 // safe margin for text
  qrSizeMm: 30,                // the symbol, quiet zone excluded
  qrQuietMm: 2.5,              // light border, part of the printed tile
  photoSizeMm: 22,
  cornerRadiusMm: 2.5
}
```

Change these and every card, preview and print sheet in the project follows. See
[docs/CUSTOMIZATION.md](CUSTOMIZATION.md).

### `CardTemplates.TEMPLATES`

The **built-in** templates, as an array. Contributed ones live in a separate list and are
reachable through `all()` — see [Contributed templates](#contributed-templates). Each has:

```js
{
  id: 'template-1',            // referenced by card_settings.template_id
  name: 'Midnight',
  description: 'Deep navy with a warm accent stripe. Photo left, type right.',
  free: true,                  // cosmetic tier flag only — nothing is gated on it
  layout: 'photo-left',        // 'photo-left' (photo beside the type) | 'centered' (type over a monogram)
  front: { background, accent, nameColor, roleColor, taglineColor,
           monogramBg, monogramColor, photoShape, photoRing, rules,
           nameFont, nameWeight, nameSizePt, roleSizePt, taglineSizePt, stripe, border },
  back:  { background, accent, textColor, mutedColor, qrTile, captionSizePt,
           hintSizePt, border, stripe }
}
```

`background` is either `{ type: 'solid', color }` or
`{ type: 'gradient', from, to, angle }` with `angle` in degrees.

Shipped templates — `TPL.TEMPLATES`, the built-ins every deployment has:

| `id` | Name | Layout | Read it as |
| --- | --- | --- | --- |
| `template-1` | Midnight | `photo-left` | navy gradient, warm accent |
| `template-2` | Paper | `centered` | off-white, ink type, cheap to print |
| `template-3` | Signal | `photo-left` | black on white, maximum contrast |
| `template-4` | Bloom | `centered` | blush gradient, serif name |
| `template-5` | Terminal | `photo-left` | ink-blue, phosphor green |
| `template-6` | Terra | `photo-left` | clay and cream, for food and craft |

The fixture profiles in `examples/` each wear a different one, so the gallery page is also the
theme catalogue. A contributed template is not in this array — it joins through `all()`.

`layout` is the only field that changes the *structure* of a card — `Card.buildFront` branches
on it. Everything else is colour and type, so a new template that reuses an existing layout is
pure data and needs no renderer changes. Adding a genuinely new layout means adding a branch to
`buildFront`; see [docs/CUSTOMIZATION.md](CUSTOMIZATION.md#adding-a-template).

### `CardTemplates.get(id) → template`

Returns the template, or the first one if `id` is unknown. Never throws — a typo in a JSON file
should not produce a blank card. Falls back to `template-1` for a contributed id that failed to
load, so a broken contribution degrades to a working card rather than a blank one.

### `CardTemplates.toCssVars(template, profile?) → object`

Maps a template onto the CSS custom properties that `assets/styles.css` consumes:

```js
CardTemplates.toCssVars(CardTemplates.get('template-1'))
// { '--bg': '#141428', '--bg-2': '#232345', '--accent': '#f2b134',
//   '--text': '#ffffff', '--muted': 'rgba(255,255,255,0.74)',
//   '--faint': …, '--surface': …, '--border': …, '--radius': '14px', '--font-name': … }
```

Pass the profile as the second argument and `card_settings.primary_color` /
`accent_color` override the template's own background and accent. That is how a person can
tint a template without editing the registry. `--surface` and `--radius` adapt to whether the
background is light and to the layout, so a Paper card gets a white-on-light surface and a
rounder corner radius automatically.

The profile page applies the result to `:root`, which is why a Midnight card produces a Midnight
web page with no second colour palette to maintain.

### Contributed templates

A template is one file. Nothing in `card-templates.js` changes when someone adds one, which is
the difference between a project people can contribute to and one they have to fork. See
[docs/TEMPLATES.md](TEMPLATES.md) for the authoring guide.

```js
CardTemplates.register(template)      // → template, or null if rejected (never throws)
CardTemplates.validateTemplate(t)     // → { ok, errors[], warnings[] }
CardTemplates.loadCommunity(baseUrl)  // → Promise<template[]> of what was added
CardTemplates.community()             // the contributed ones, in load order
CardTemplates.resetCommunity()        // unregister them all (tests, gallery reload)
```

`register()` marks the template `community: true` so the UI can label it, and is idempotent —
loading the same file twice adds it once.

`loadCommunity(baseUrl)` fetches `<baseUrl>/index.json` and injects each listed file as a
`<script>`, **in order**, letting each self-register. Order matters: two files racing to register
would produce a nondeterministic picker. It resolves to `[]` and **never rejects** when there is
no fetch, no manifest, or a broken file — a missing community folder must not break a card. Call
it before rendering anything that reads a template, which is what `profile/boot.js`,
`card-builder/builder.js`, `templates/gallery.js` and `print/print-sheet.js` all do.

`validateTemplate()` is the same check `tools/build-templates.js` runs under `npm run validate`.
It returns errors
for anything that would produce a broken or unscannable card, and warnings for advice:

| Rule | Level | Why |
| --- | --- | --- |
| `id` lowercase and unique across core **and** community | error | shadowing a built-in silently changes cards someone already printed |
| `name` present, `layout` is `photo-left` or `centered` | error | the renderer branches on `layout` |
| every `front.*` / `back.*` colour and size field present | error | the display list has no defaults to fall back on |
| `background.type` is `solid` or `gradient`, with the fields that implies | error | — |
| `back.qrTile` is a **light** colour | error | inverted QR codes fail on a large fraction of phone cameras |
| `photoShape` is `circle` or `round` | warning | anything else is drawn as `round` |
| `free: false` | warning | recorded, but nothing is gated on it — the core is free |
| `author` missing | warning | shown in the gallery |

### Also exported

```js
CardTemplates.all()          // every template: built-ins first, then contributed
CardTemplates.ids()          // their ids, in the same order
CardTemplates.LAYOUTS        // ['photo-left', 'centered']
CardTemplates.isLight(hex)   // true for backgrounds that need dark text on top
CardTemplates.SANS           // the system sans stack, as one string
CardTemplates.SERIF          // the serif stack
```

Use `all()` in any UI that lists templates. `TEMPLATES` is the built-in array only, and picking
it by hand is how a contribution ends up invisible in one picker and visible in another.

---

## AccessRules

The tier logic. Pure functions, no DOM, no I/O — the same code runs in the browser today and
can run in a server handler in V2.

### Constants

```js
AccessRules.TIER             // { PUBLIC: 'public', TEMPORARY: 'temporary', FOLLOWER: 'follower' }
AccessRules.VISIBILITY       // { PUBLIC: 'public', FOLLOWERS_ONLY: 'followers_only' }
AccessRules.FOLLOWER_STATUS  // ['pending', 'approved', 'rejected', 'removed']
AccessRules.TOKEN_PREFIX     // 'temp_'
AccessRules.LIMITS           // { maxPublicLinks: 5, maxActiveTokens: 1,
                             //   tokenDurationsSeconds: { '10m': 600, '1h': 3600,
                             //                            '24h': 86400, '7d': 604800 } }
AccessRules.DURATION_LABELS  // { 600: '10 minutes', 3600: '1 hour', … }
```

```js
AccessRules.durationOptions()
// [{ key: '10m', seconds: 600, label: '10 minutes' }, …] shortest first
AccessRules.humanDuration(604800)   // '7 days'
```

`durationOptions()` is what the dashboard builds its expiry picker from, so editing
`tokenDurationsSeconds` edits the UI. Labels are looked up in `DURATION_LABELS` and fall back to
`humanDuration()`, which you can also use for an unlabelled custom duration.

### `AccessRules.resolveAccess(profile, context?, registry?, atTime?) → result`

The one function that decides what a visitor sees.

```js
const result = AccessRules.resolveAccess(profile, { token: 'temp_abc', viewerId: 'user_1' }, registry);
result.tier          // 'public' | 'temporary' | 'follower'
result.visibleLinks  // the links to render, already sorted by `order`
result.hiddenCount   // how many were withheld — the page says "2 links are private"
result.token         // the evaluateToken verdict, or null
result.follower      // the follower record, or null
result.notices       // [{ kind, message }] explaining a downgrade
```

`atTime` (ms since epoch) exists so tests can travel; omit it to use now. Precedence is
follower → token → public, and a token can only widen access, never narrow it.

### `AccessRules.evaluateToken(tokenValue, profileUsername, registry, atTime?) → verdict`

```js
{ valid: true,  token, tokenValue, linkId, reason: 'ok', msLeft, usesLeft }
{ valid: false, tokenValue, reason }
```

| `reason` | Meaning |
| --- | --- |
| `'ok'` | Valid; `linkId` is the one link it unlocks |
| `'malformed'` | Does not match `temp_` + 22 characters |
| `'not_found'` | No such token in the registry |
| `'wrong_profile'` | Real token, different owner |
| `'expired'` | Past `expires_at` (`msLeft` is negative) |
| `'exhausted'` | `current_uses >= max_uses` |

Only `'expired'` and `'exhausted'` produce a visitor-facing notice. The others fail silently, so
a URL cannot be used to probe whether other people's tokens exist.

### `AccessRules.createToken({ profileUsername, linkId, durationSeconds?, maxUses? }) → token`

Returns a complete token record with a cryptographically-random 22-character value
(`crypto.getRandomValues` where available, a seeded fallback otherwise), `created_at`,
`expires_at`, `max_uses` (default 1) and `current_uses: 0`.

### Followers

```js
AccessRules.createFollowerRequest({ profileUsername, followerId, followerEmail?, followerName? })
  // → { follower_id, follower_email, follower_name, profile_username,
  //     status: 'pending', requested_at }

AccessRules.findFollower(registry, profileUsername, followerId)      // → record | null
AccessRules.isApprovedFollower(registry, profileUsername, followerId) // → boolean
```

Status transitions are your code's job — `resolveAccess` only ever reads them. The dashboard
implements approve/reject/remove by writing the status and an `approved_at` timestamp.

### Link helpers

```js
AccessRules.sortedLinks(profile)         // links ordered by `order`, then by array position
AccessRules.isPrivate(link)              // visibility !== 'public'  (fails closed)
AccessRules.isLinkVisible(link, tier, tokenVerdict)
  // public      → visible to everyone
  // temporary   → public, plus the single link the verdict unlocks
  // follower    → everything
```

### Validation

```js
AccessRules.validateProfile(raw)   // → { ok, profile, errors: string[], warnings: string[] }
AccessRules.validateRegistry(raw)  // → { tokens: [], followers: [] }
```

`validateProfile` deep-clones, fills in defaults and returns a *repaired* profile alongside the
messages, so a hand-edited JSON file with a missing `id` still renders. Hard errors:
`username` not matching `/^[a-z0-9_.-]{3,32}$/i`, missing `display_name`, `links` not an array,
a link with no `url`, duplicate link ids, and more public links than `LIMITS.maxPublicLinks`.
Warnings: a URL with no scheme, a missing label, and an unknown `visibility`.

An unknown `visibility` is normalised to `followers_only`, not `public`. Only an exact
`"public"` is ever public — see the rule below.

`validateRegistry` returns only `{ tokens, followers }` — it drops every other key. That is
deliberate (unknown fields should not survive a round-trip), but it means callers that attach
provenance metadata must re-attach it afterwards; `Store.loadRegistry` does exactly that with
`_remoteTokens` / `_localTokens`.

### `AccessRules.pruneExpiredTokens(registry, atTime?) → { kept, removed }`

Returns a new registry with expired tokens dropped, plus what it dropped. Nothing calls this
automatically: an expired token still produces a useful "this link has expired" message, which
is better than a silent 404, so pruning is a housekeeping choice, not a correctness one.

### `AccessRules.parseTime(value) → number | null`

Parses ISO strings and epoch numbers into milliseconds. `null` for `expires_at` means "never
expires".

### `AccessRules.randomToken(prefix?) → string`

`'temp_'` plus 22 characters from
`abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789` — 56 symbols with `0/O/1/l/I`
removed so a token can be read aloud and typed by hand. That is ~123 bits of entropy, which is
why the length is 22 and not 16. Uses `crypto.getRandomValues` where available and falls back
to `Math.random` only in environments without it (which in a browser means very old ones).

Pass `''` as the prefix for a bare token body.

---

## Card

Turns a profile into drawing instructions, then into SVG.

### `Card.buildCard(profile, options?) → card`

```js
{
  template,          // the CardTemplates entry used
  widthMm: 89,
  heightMm: 51,
  front: [ …display list… ],
  back:  [ …display list… ]
}
```

| Option | Default | Notes |
| --- | --- | --- |
| `templateId` | `card_settings.template_id` or `'template-1'` | |
| `profileUrl` | `profile.profile_url` | Overrides the URL encoded in the QR |
| `ecl` | `'Q'` | Error correction for the back-of-card QR |
| `photoDataUrl` | — | A pre-embedded photo; see `Exporter.prepareCard` |

`buildCard` does **not** attach the profile to its result. If you want a meaningful PDF
document title, pass `{ title }` to `PdfCard.generate` (which `Exporter.exportPdf` does for
you).

### `Card.buildFront(profile, template, options?)` / `Card.buildBack(...)`

Each returns a display list — an array of drawing commands in millimetres, y increasing
downwards:

```js
{ type: 'rect',     x, y, w, h, fill, stroke?, strokeWidthMm?, radius? }
{ type: 'circle',   cx, cy, r, fill?, stroke?, strokeWidthMm? }
{ type: 'line',     x1, y1, x2, y2, stroke, strokeWidthMm? }
{ type: 'text',     x, y, text, sizePt, fontFamily, weight?, fill, align?,
                    baseline?, letterSpacingPt? }
{ type: 'qr',       qr, x, y, moduleMm, fill }        // qr from QRCode.create
{ type: 'image',    x, y, w, h, href, clip? }         // clip: 'circle' | 'round'
{ type: 'gradient', … }                               // emitted by gradientRect
```

`buildBack` draws a white rounded tile, the QR inside it with the quiet zone, a caption
(`Card.shortUrl`) and the hint line *"Scan for public links · Ask for private access"*. If
there is no profile URL it draws that instruction instead of a QR — a card without a URL should
say so loudly rather than encode an empty string.

### `Card.toSVG(card, side, options?) → string`

`side` is `'front'` or `'back'`.

| Option | Default | Notes |
| --- | --- | --- |
| `pxPerMm` | `4` | Preview density. Use `Exporter.PX_PER_MM` (≈ 11.81) for 300 DPI. |
| `bleed` | `false` | Adds `GEOMETRY.bleedMm` on every edge and shifts the viewBox. |

The SVG is clipped to the trim box and, with bleed on, sits on a white ground. `width`/`height`
are in px and the `viewBox` is in mm, so the same markup is both a screen preview and a
scalable asset.

### `Card.toDataURL(card, side, options?) → string`

Base64 `data:image/svg+xml`. This is what the dashboard and builder put in an `<img>` for the
live preview: no blob URLs to revoke, no async, and it works in a `src` attribute.

### Text helpers

```js
Card.fitText(str, { sizePt, minSizePt, maxWidthMm, fontFamily, weight })
  // → { text, sizePt } — shrinks until it fits, ellipsises below minSizePt
Card.textWidthMm(str, sizePt, fontFamily, weight)   // → number
Card.avgWidth(fontFamily, weight)                   // → average glyph width factor
Card.initials(name)                                 // 'Rahul Kumar' → 'RK'
Card.shortUrl(url)                                  // strips scheme and www for the caption
Card.qrPathData(qr, x, y, moduleMm)                 // one <path> for a whole QR
Card.shapePath(item)                                // rounded-rect / circle path data
Card.esc(s)                                         // XML escaping
```

`textWidthMm` uses per-character width tables rather than measuring the DOM. That is a
deliberate trade: the SVG and the PDF must agree on text width *without* a browser present, so
both use the same tables. The consequence is that an unusual font will be estimated, not
measured — `fitText` is conservative for that reason.

---

## PdfCard

Writes the card display list to a real PDF 1.4 file.

### `PdfCard.generate(card, options?) → { bytes, warnings }`

| Option | Default | Notes |
| --- | --- | --- |
| `sides` | `['front', 'back']` | Two pages, front then back. Also accepts `'sheet'`, which puts both sides on **one** page with an 8 mm gap for a guillotine cut. |
| `bleed` | `false` | 3 mm per edge; page becomes 95 × 57 mm. |
| `title` | `'<name> — QR Link Card'` | PDF document title. |

`bytes` is a `Uint8Array`. `warnings` collects anything that had to be approximated — most
commonly a character outside WinAnsiEncoding, or a photo format that could not be embedded.

Supported drawing: rects (incl. rounded), lines, circles, axial gradients, text in the standard
14 fonts, and embedded JPEG/PNG photos clipped to circles or rounded rects. **Not** supported:
arbitrary paths, patterns, transparency groups, embedded font subsets. Text outside
WinAnsiEncoding (Latin-1 plus the CP1252 extras) is substituted and reported; CJK and
Devanagari would need an embedded TrueType font, which is on the
[roadmap](../PLANNING.md).

### Lower-level exports

`PdfCard.PdfDoc` is the specialised writer underneath (note: a different, richer class than
`lib/pdfdoc.js`'s `SimplePdf` — they are unrelated implementations with unfortunately similar
names). Also exported for reuse and testing: `encodeText`, `pdfString`, `parseColor`,
`decodePng`, `unfilter`, `rectPath`, `shapePath`, `jpegEntry`, `hasZlib`, `PT_PER_MM`.

---

## SimplePdf

A general-purpose PDF writer for things that are not business cards — A4 QR sheets, stickers,
badge inserts. Coordinates are **millimetres from the top-left**, which it converts to PDF
points internally.

```js
const doc = new SimplePdf({ title: 'QR sheet', author: 'me', subject: '…' });
const page = doc.addPage(210, 297);            // A4, in mm

page.rect(10, 20, 30, 40, '#111111');          // x, y, w, h, fill
page.circle(50, 50, 8, '#f2b134');             // cx, cy, r, fill
page.line(10, 90, 200, 90, '#cccccc', 0.35);   // x1, y1, x2, y2, stroke, widthMm
page.text('Hello', 105, 100, 12, '#111111', 'middle');  // text, x, y(baseline), pt, fill, align, bold?
page.textWidthMm('Hello', 12);                 // → mm, for fitting text to a box

const bytes = doc.build();                     // Uint8Array
doc.getWarnings();                             // ['Character U+20B9 (₹) is not in …']
```

Every drawing method returns the page, so calls chain. `align` is `'start' | 'middle' | 'end'`.
`addPage()` defaults to A4. A document with no pages gets one on `build()`.

`SimplePdf.MM_PER_PT` (0.3528) and `SimplePdf.PT_PER_MM` (2.8346) are exported because
mixing those two up is the single easiest way to produce a PDF that is 8× the wrong size —
multiply millimetres by `PT_PER_MM`.

---

## Store

Bridges the static JSON files and `localStorage` — and answers the question every page needs
but no page should have to be told: *where is this site?* Browser-only.

```js
Store.KEY_PREFIX      // 'qrlinkcard.v1.'
```

### Deployment discovery

```js
Store.siteRoot()                    // 'https://you.github.io/repo/'  (always ends in '/')
Store.basePath()                    // '/repo/'
Store.rootRelative('docs/API.md')   // '../docs/API.md' from a page one level down
Store.profileUrlFor('rahul')        // 'https://you.github.io/repo/c/rahul/'
Store.setSiteRoot(url)              // test hook; pass null to clear
Store.githubPagesIdentity()         // { owner, repo } on github.io, else null
Store.githubPagesRoot('you', 'repo')// 'https://you.github.io/repo/'
Store.isUpstreamDemo()              // true only on clickalex.github.io/GrinCard
```

`siteRoot()` is derived, not configured. It reads the URL of its own `<script>` tag — this file
always lives at `<site root>/lib/store.js`, so stripping that suffix gives the root at any depth,
on any host, with no build step. Resolution order:

1. `<body data-site-root="https://cards.example.com">` — an explicit override, for the rare case
   where the canonical URL is not the URL being served.
2. The script's own URL.
3. Walking up from `location.pathname`, using `<body data-base-depth="N">` if present.

This is what makes the repository safe to fork: a fork's cards point at the fork, a move to a
custom domain changes nothing, and a project page served from `/<repo>/` works the same as a user
page served from `/`. **Nothing in this project may hardcode a deployment URL** — see
`profileUrlFor()`.

`rootRelative(path)` expresses a site-root-relative path from the current page's directory, which
is what every in-page link should use. It is depth-aware, so the same renderer works from
`/profile/`, from a generated `/c/<username>/` stub, and from `404.html` at an arbitrary depth.
`pageRelative(path)` is the older, simpler helper: it joins onto the page's own directory without
climbing to the root, and is still used where that is what is wanted.

```js
Store.profileUrlFor(username, profile?)
```

The permanent, printable URL for a profile: `<site root>/c/<username>/`. An **absolute**
`profile.profile_url` wins over the derived value — that is the custom-domain escape hatch. A
relative or empty `profile_url` is ignored, because honouring one would let a copied fixture
silently produce a card that points at someone else's site. Returns `''` for no username.

### Data directory

```js
Store.dataDir()       // '../profile-data/' relative to the current page
```

`<body data-profile-dir="../examples/">` repoints it. That is how `templates/` and `examples/`
render the shipped fixtures instead of the owner's real profiles — a public gallery must not
print someone's private links into a page anyone can open. `tools/build-links.js --data <dir>`
generates the manifest for the same directory.

### Profiles

| Call | Returns |
| --- | --- |
| `listProfiles()` | `Promise<summary[]>` — one per profile in the data directory |
| `loadProfile(username)` | `Promise<profile \| null>` — local override if present, else the repo file |
| `saveProfile(profile)` | `Promise<profile>` — validates, then writes to `localStorage` |
| `hasLocalProfile(username)` | `boolean` |
| `deleteLocalProfile(username)` | — |

Each summary is `{ username, display_name, designation, tagline, theme, link_count, url,
_starter }`, where `url` is the derived `profileUrlFor()` value and `_starter` marks the
untouched profile a fork ships with (the site root uses it to decide whether to show setup help).

A static site cannot list a directory, so `listProfiles()` reads `profile-data/index.json` — a
manifest `tools/build-links.js` writes, `npm run validate` checks, and the Pages workflow
regenerates on deploy. A stale manifest means the index page does not list a new person; it never
breaks `/c/<username>/`, because that loads `<username>.json` by name. If the manifest is missing,
`listProfiles()` resolves to `[]` rather than rejecting.

`loadProfile` sets `_source` to `'repo'` or `'local'` and records `lastUsername`, so a page can
say where its data came from and open the same profile next time.

### Registry (tokens + followers)

| Call | Returns |
| --- | --- |
| `loadRegistry(username)` | `Promise<{ tokens, followers, _remoteTokens, _remoteFollowers, _localTokens, _localFollowers }>` |
| `saveRegistry(username, registry)` | validates and persists |
| `saveLocalRegistry(username, registry)` | writes **only** your own tokens/followers, leaving repo-seeded demo data untouched |

The `_remote*` arrays are provenance: they let the UI show repo demo tokens as read-only
instead of offering a "Revoke" button that cannot actually revoke a file in git.

### Session-ish state

```js
Store.getViewer() / setViewer(id)            // who you are simulating a visit as
Store.getLastUsername() / setLastUsername(u) // "continue where you left off"
Store.localKeys()                            // every key this app owns
Store.clearLocal()                           // wipe them all
```

All `localStorage` access is wrapped in `try/catch`: private-browsing modes that throw on
write must not break the page, they just make edits non-persistent.

---

## Tools

Node scripts, not part of the shipped site. Each exports its internals so the test suite can
exercise them without spawning a process, and each returns a process exit code from `main()`.

### `tools/build-links.js`

Turns profile JSON into permanent URLs.

```bash
node tools/build-links.js                  # profile-data/ -> manifests + c/<username>/ stubs
node tools/build-links.js --check          # CI: fail if a committed manifest is stale
node tools/build-links.js --clean          # remove generated stubs
node tools/build-links.js --data examples --manifest-only   # a fixture set, no stubs
node tools/build-links.js --data DIR --out DIR --quiet
```

```js
const { main, readProfiles, stubHtml, manifest, directoryHtml, args } = require('./tools/build-links.js');
readProfiles(dir)          // → { profiles: [{ file, username, json }], errors: string[] }
stubHtml(username, name)   // → the ~14-line host page for /c/<username>/
manifest(profiles)         // → the index.json object
directoryHtml(profiles)    // → the /c/ listing page
```

`readProfiles()` is strict about the things that silently break a printed card: the filename must
be a valid username, it must equal the `username` field inside (the URL is `/c/<filename>/`), and
the JSON must parse. It skips `index.json`, `tokens.json`, `followers.json` and `_`-prefixed
files, so a registry beside the profiles is never published as a person called "tokens".

`main()` also removes stubs for profiles that no longer exist — a deleted profile must not leave a
working URL behind.

### `tools/build-templates.js`

Validates contributed templates and keeps `card-templates/community/index.json` in sync.

```bash
node tools/build-templates.js           # validate, then write the manifest
node tools/build-templates.js --check   # CI: fail if invalid, or if the manifest is stale
node tools/build-templates.js --json
```

Validation is `CardTemplates.validateTemplate()` plus two checks that need the whole folder: ids
must be unique across files, and every manifest entry must point at a file that exists.
`generated_at` is ignored when comparing, so an unchanged folder does not look dirty in CI.

### `tools/check-links.js`

Asserts that every internal link in every page **and every markdown document** resolves to a file
that exists.

```bash
node tools/check-links.js           # report; exit 1 on a broken link
node tools/check-links.js --json
node tools/check-links.js --strict  # also fail if generated stubs are missing
```

```js
const { main, extractLinks, stripScripts, resolveTarget, isExternal, linkableFiles } =
  require('./tools/check-links.js');
```

Two deliberate choices. `<script>` bodies and fenced code blocks are blanked out before scanning,
because an attribute regex cannot tell a real reference from a string being concatenated — false
positives are how a check like this gets ignored. And a link into `c/<username>/` whose stub is
missing but whose profile exists is reported as a *notice*, not an error: the stubs are generated
at deploy time and `404.html` serves the path either way, so a fresh clone must pass CI.

---

## Exporter

Downloads. Browser-only.

```js
Exporter.DPI          // 300
Exporter.PX_PER_MM    // 11.811…
```

### `Exporter.prepareCard(profile, options?) → Promise<{ card, warnings }>`

Builds the display list, first embedding the photo as a data URL (downscaled to a 600 px edge,
JPEG quality 0.92) so the PDF and PNG do not depend on a cross-origin image the browser refuses
to read. If embedding fails — a hostile `Cross-Origin-Resource-Policy`, an offline host — the
card is built without the photo and a warning explains it. Always use this instead of
`Card.buildCard` when you intend to export.

### Downloads

| Call | Produces |
| --- | --- |
| `exportSvg(prepared, side, username)` | an `.svg` file, returns the markup |
| `exportPng(prepared, side, username, { bleed, pxPerMm })` | a 300 DPI `.png`, resolves `null` if the browser cannot rasterise |
| `exportPdf(prepared, username, { bleed, sides, title })` | `{ bytes, warnings }`, and downloads the PDF |
| `exportAll(prepared, username, opts)` | SVG front + SVG back + PDF, plus PNG where possible; resolves `{ warnings }` |
| `toPngCanvas(prepared, side, opts)` | the raw canvas, if you want to draw it somewhere yourself |

### `Exporter.rasteriseSvg(svg, width, height, background?) → Promise<Blob|null>`

Rasterises **any** SVG markup, not just cards — the QR generator uses it. Resolves `null` when
the browser cannot do SVG → canvas (Firefox, and any environment without a real canvas) so the
caller can hand over the vector original instead.

### Capability checks

```js
Exporter.canRasteriseSvg()   // user-agent check: false on Firefox
Exporter.canvasAvailable()   // feature check: can we actually get a 2d context?
```

Use `canvasAvailable()` if you want one answer; `canRasteriseSvg()` is the historical check and
is kept because Firefox's restriction is about tainting, not about canvas support.

### Utilities

```js
Exporter.download(blob, filename)             // creates a temporary <a download> and clicks it
Exporter.copyText(text)                       // → Promise<boolean>, clipboard with a textarea fallback
Exporter.safeName(username, kind, ext)        // → 'qr-link-card_rahul123_front-300dpi.png'
Exporter.toEmbeddedDataUrl(url, maxEdge?, quality?)  // → Promise<string|null>
```

---

## QrGenerator

Batch QR codes and paper layout. Used by `qr-generator/`, and useful on its own in a build
script.

### `QrGenerator.parseList(text) → entries`

Parses pasted lines into `[{ id, label, url }]`. Accepts `url`, `Label | url`, `Label, url` or
tab-separated. Blank lines and `#` comments are skipped. The split happens at the **last**
delimiter that is followed by a URL or URI scheme, so `https://maps.example/?q=Delhi,India`
survives intact. Missing labels are guessed from the host and last path segment
(`guessLabel`).

### `QrGenerator.layout(entries, options?) → lo`

```js
{
  paper,            // { width, height, label } in mm
  columns, rows, perPage, pageCount,
  cell,             // { width, height } in mm — symbol + quiet zone (+ label)
  sizeMm,           // what you asked for: the MINIMUM symbol size
  symbolMm,         // what actually prints
  moduleMm,         // one module, in mm
  boxMm, quietMm, marginMm, gapMm, labelMm,
  quietZoneModules, maxModules, ecl
}
```

| Option | Default | Notes |
| --- | --- | --- |
| `paper` | `'a4'` | `'a4' \| 'letter' \| 'a5' \| 'a6'` — see `QrGenerator.PAPER` |
| `sizeMm` | `25` | Minimum symbol size, quiet zone excluded |
| `marginMm` | `10` | Unprintable border around the sheet |
| `gapMm` | `4` | Space between cells |
| `ecl` | `'M'` | |
| `quietZoneModules` | `4` | |
| `showLabels` / `labelMm` | `false` / `5` | Adds label height to each cell |

**Important behaviour:** every code on a sheet shares one module size, so the grid stays even.
The batch is therefore laid out for its *longest* payload — the biggest code gets exactly
`sizeMm` and shorter ones come out slightly larger. This guarantees the quiet zone is right for
every code, which is what actually decides whether a scanner finds it. Compare
`symbolMm` with `sizeMm` to see whether that happened.

### `QrGenerator.position(index, lo) → { page, x, y }`

Row-major packing, the grid centred on the page, coordinates in mm from the top-left. Cells
never overlap and never leave the paper.

### `QrGenerator.sheetSvg(entries, page, options?) → string`

One page as SVG, sized in mm (`width="210mm"`), so it prints at true size. Each code is a
`<g data-index="…" data-url="…">` containing a single `<path>` — small files, crisp edges.
Labels are truncated to fit their cell.

### `QrGenerator.sheetPdf(entries, options?) → Uint8Array`

Every page, as a vector PDF whose page boxes are the exact paper size. The returned array also
carries two non-enumerable conveniences: `.warnings` (character substitutions) and `.layout`
(the `lo` it used).

### `QrGenerator.singleSvg(text, options?) → string`

One code, sized in mm including its quiet zone. `{ ecl, sizeMm, quietZoneModules, color,
background }`; `background: 'none'` omits the backing rect.

### `QrGenerator.runs(text, options?) → { runs, moduleMm, symbolMm, size, version, quietModules, quietMm }`

The drawing primitive underneath both renderers: the dark modules as horizontal runs
(`{x, y, w}` in mm, origin at the symbol's top-left). Pass `moduleMm` for a sheet-wide size or
`sizeMm` for a single code. One run per row-segment means a 41×41 code is a few hundred path
commands rather than 1681 rectangles.

### Also

`QrGenerator.PAPER`, `truncate(text, maxChars)`, `charsFor(cellWidthMm, fontSizeMm)`,
`fontSize(cellWidthMm)`, `MM_PER_PT`, `PT_PER_MM`.

---

## Data schemas

### Profile — `profile-data/<username>.json`

```jsonc
{
  "username": "rahul123",                 // must match the filename; /^[a-z0-9_.-]{3,32}$/i
  "display_name": "Rahul Kumar",          // required
  "designation": "Freelance Illustrator", // role line on the card
  "tagline": "Brands, packaging and the occasional mural",
  "photo_url": "data:image/jpeg;base64,…",// URL, data URL, or omit for initials
  "profile_url": "https://you.dev/c/rahul123",  // what the QR encodes — set this first
  "theme": "template-1",                  // drives the web page palette
  "created_at": "2026-09-04T10:00:00Z",
  "links": [
    { "id": "lnk_1", "label": "Instagram", "url": "https://instagram.com/rahul_art",
      "visibility": "public", "order": 1 },
    { "id": "lnk_4", "label": "Pricing List", "url": "https://docs.example.com/pricing",
      "visibility": "followers_only", "order": 4 }
  ],
  "card_settings": {
    "template_id": "template-1",
    "primary_color": "#1a1a2e",
    "accent_color": "#f2b134",
    "show_photo": true,
    "tagline": "optional override"
  }
}
```

`tagline` is read from the top level first and `card_settings.tagline` second, so either works.
`visibility` is `"public"` or `"followers_only"`.

**The check fails closed.** `AccessRules.isLinkVisible()` returns true at the public tier only
for an exact `"public"`. Anything else — `"private"`, `"PRIVATE"`, `"followers-only"` with a
hyphen, a missing field, `null` — is treated as `followers_only`, so it stays hidden from a
stranger and still appears for an approved follower or a matching token.

This is deliberate, and it was not always so. The rule used to read "not `followers_only` means
public", and the shipped starter profile said `"visibility": "private"` — a value the enum never
contained — so the link labelled *Pricing (private)* was published to everyone who scanned the
card. Two independent defects, one visible failure, and the asymmetry is what decides it: failing
closed costs a missing link the owner notices on their own page; failing open publishes a private
link permanently, on a URL that is printed and cannot be taken back.

`order` is 1-based; links are rendered in that
order regardless of how they are arranged in the array.

Keys beginning with `_` (`_source`, `_comment`, `_note`) are internal or documentation and are
stripped on export.

### Registry — `examples/tokens.json`

```jsonc
{
  "tokens": [
    {
      "token_id": "tok_demo_live",
      "token_value": "temp_demo_live",        // what appears in the URL as ?t=
      "profile_username": "rahul123",
      "target_link_id": "lnk_4",              // exactly one link
      "created_at": "2026-09-04T10:00:00Z",
      "expires_at": null,                     // null = never expires
      "max_uses": 0,                          // 0 = unlimited
      "current_uses": 0
    }
  ],
  "followers": [
    {
      "follower_id": "user_priya",
      "follower_email": "priya@example.com",
      "follower_name": "Priya Nair",
      "profile_username": "rahul123",
      "status": "approved",                   // pending | approved | rejected | removed
      "requested_at": "2026-09-01T09:00:00Z",
      "approved_at": "2026-09-02T11:30:00Z"
    }
  ]
}
```

One file holds tokens and followers for **all** profiles; each record names its
`profile_username`, and `Store.loadRegistry(username)` filters to the ones that matter. That
keeps the repository tidy at demo scale. A hosted deployment would use two tables and an index
on `(profile_username, status)` instead — see
[docs/ARCHITECTURE.md](ARCHITECTURE.md#everything-else-v2-needs).

> **V1 caveat, restated where it is hardest to miss:** this file is fetched by the visitor's
> browser. It demonstrates the flow; it does not enforce it. Server-side filtering is the first
> V2 task.
