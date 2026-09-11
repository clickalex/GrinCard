# Customization

Everything you might want to change, from "a different accent colour" to "a new card layout",
in rough order of how deep you have to go.

---

## 1. Your own profile

The smallest change and the one everybody makes first. Either:

- Open **[card-builder/](../card-builder/index.html)**, fill it in, and click **Download
  profile JSON**; or
- rename `profile-data/yourname.json` to `profile-data/<your-username>.json` and edit it.

The filename must equal the `username` field inside it, and it is what your printed address
becomes: `profile-data/riley.json` → `https://<your-site>/c/riley/`. Then run `npm run build`
so the manifests and the `/c/riley/` page are regenerated. Every field is documented in
[docs/API.md#data-schemas](API.md#data-schemas).

**You never type your URL.** The `profile_url` field is derived from where the page is actually
served, so a fork's cards point at the fork, a move to a custom domain changes nothing, and a
project page served from `/<repo>/` works the same as one served from `/`. The dashboard shows it
read-only so you can see what you are about to print. The only reason to set `profile_url`
yourself is a domain you own that is not where the site is served — it must then be **absolute**
(`https://cards.example.com/c/riley/`), because a relative one is ignored. Leaving it out is the
normal case and nothing warns you about it.

**Photo.** Three options, best first:

1. **Upload it** in the builder or dashboard. It is downscaled to a 600 px edge and embedded as
   a JPEG data URL, so the card is self-contained and prints identically everywhere.
2. **Host it in this repository** (`assets/me.jpg`) and use a relative path.
3. **Link to it** elsewhere. This works on screen but can silently fail in the exported PDF and
   PNG, because the browser refuses to read pixels from another origin. You will get a warning
   rather than a broken file — but a card without your face on it.

A 600 × 600 px source is the sweet spot: the photo prints at 22 mm, which needs ~260 px at
300 DPI, so 600 px leaves room for the round crop and a little sharpening.

---

## 2. Colours, without touching code

Each profile can override its template:

```jsonc
"card_settings": {
  "template_id": "template-2",
  "primary_color": "#0f3d3e",   // replaces the template's background
  "accent_color": "#e8b04b",    // replaces the stripe, ring and rules
  "show_photo": true
}
```

These two colours flow into the **web page too**, because
`CardTemplates.toCssVars(template, profile)` applies them as `--bg` and `--accent` on `:root`.
That is the "physical equals digital" principle implemented as one code path rather than a
promise: change the card's colour and the profile page follows, with nothing to keep in sync.

The dashboard exposes both as colour pickers, so you can see the effect on the card and the page
before you save.

---

## 3. Limits

```js
// lib/access.js
var LIMITS = {
  maxPublicLinks: 5,
  maxActiveTokens: 1,
  tokenDurationsSeconds: { '10m': 600, '1h': 3600, '24h': 86400, '7d': 604800 }
};
```

Self-hosting? Change them. They are product decisions for a hosted service, not restrictions on
the software, and nothing else in the codebase reads a licence or phones home.

To add a duration (say, 30 days) add `'30d': 2592000` to `tokenDurationsSeconds`; the
dashboard's picker is built from `AccessRules.durationOptions()`, so it appears automatically,
labelled "30 days" by `humanDuration()`. Add an entry to `DURATION_LABELS` if you want different
wording.

To turn a limit *off* rather than raise it, set it to `Infinity`. `validateProfile` and the
dashboard's counter both handle that without special cases.

> If you are running the hosted service described in [PLANNING.md](../PLANNING.md), remember the
> rule the whole project is built on: **paid features are cosmetic**. A paid tier may offer more
> templates, a custom domain, hosting and analytics. It may never charge someone for the ability
> to share their own links.

---

## 4. Geometry

One object controls the physical card, in `card-templates/card-templates.js`:

```js
var GEOMETRY = {
  widthMm: 89, heightMm: 51,   // ISO/IEC 7810 ID-1
  bleedMm: 3,
  marginMm: 4,
  qrSizeMm: 30,
  qrQuietMm: 2.5,
  photoSizeMm: 22,
  cornerRadiusMm: 2.5
};
```

Change it and the card renderer, the SVG preview, the print PDF, the print sheet and the
dashboard's stated dimensions all follow — they all read this object, none of them hardcode a
number. `print/` re-renders at true millimetre size, so you can measure the
result with a ruler.

Things worth knowing before you change it:

- **Do not go below `qrSizeMm: 20`.** That is the floor for a phone camera at arm's length, and
  the project's own recommendation. Above 25 mm is comfortable; below 20 mm you are betting on
  good light and a clean lens.
- **Keep `qrQuietMm` ≥ 2.** The quiet zone is what lets a scanner find the code. Shrinking it to
  fit a bigger symbol is a false economy.
- **Non-standard sizes are fine but cost you something.** 85 × 55 mm (the European credit-card
  size) and square cards both work — set the numbers, everything follows. What you lose is the
  assumption every card printer, die and wallet slot makes. If you want cards that survive being
  handed to a stranger, 89 × 51 mm is the boring correct answer.
- **`marginMm` is the safe zone, not the bleed.** Bleed is what gets cut off; margin is what must
  not be cut into. They solve opposite problems and both are needed.

---

## 5. Adding a template

A template is data. If it reuses an existing layout, you do not write any renderer code.

There are two ways to add one, and they are not the same thing:

- **For your own site** — drop a file into `card-templates/community/` and run
  `npm run validate`. It appears in every picker. Nothing in `card-templates.js` changes.
- **As a contribution to this project** — the same file, plus a pull request. See
  [CONTRIBUTING.md](../CONTRIBUTING.md) and the authoring guide in
  [docs/TEMPLATES.md](TEMPLATES.md).

### The drop-in path (what you want for your own cards)

Create `card-templates/community/<name>.js`:

```js
CardTemplates.register({
  id: 'my-forest',
  name: 'Forest',
  description: 'Deep green, cream type.',
  layout: 'photo-left',
  author: { name: 'You' },
  front: { /* every field in the table below */ },
  back:  { /* … */ }
});
```

`register()` returns the template, or `null` with a console warning explaining exactly what to
fix — it never throws, so a typo in your own template cannot break your cards. Then run
`node tools/build-templates.js` to refresh the manifest.

The rules, because `npm run validate` and `CardTemplates.validateTemplate()` enforce the same
ones:

- `id` must be **unique across core and community**. Shadowing a built-in id would silently
  change cards somebody already printed, so it is rejected.
- `layout` must be `photo-left` or `centered`.
- Every `front.*` and `back.*` colour and size field must be present — the display list has no
  defaults to fall back on.
- `back.qrTile` must be **light**. An inverted QR code fails to scan on a large fraction of phone
  cameras, which is a broken card rather than an ugly one.

### The easy case: adding to the core registry

If you are changing this project's built-ins rather than adding your own, append an object to
`TEMPLATES` in `card-templates/card-templates.js`:

```js
{
  id: 'template-4',
  name: 'Forest',
  description: 'Deep green, cream type, no stripe.',
  free: true,
  layout: 'photo-left',            // reuse an existing layout
  front: {
    background: { type: 'gradient', from: '#0f3d3e', to: '#1b5e5a', angle: 135 },
    accent: '#e8b04b',
    nameColor: '#f7f5ef',
    roleColor: 'rgba(247,245,239,0.74)',
    taglineColor: 'rgba(247,245,239,0.5)',
    monogramBg: 'rgba(247,245,239,0.10)',
    monogramColor: '#f7f5ef',
    photoShape: 'circle',          // 'circle' | 'round'
    photoRing: 'rgba(232,176,75,0.85)',
    rules: 'rgba(247,245,239,0.14)',
    nameFont: 'sans',              // 'sans' | 'serif'
    nameWeight: 700,
    nameSizePt: 17,
    roleSizePt: 9.5,
    taglineSizePt: 7.5,
    stripe: false,                 // the 2.6 mm accent bar on the left edge
    border: 'none'
  },
  back: {
    background: { type: 'solid', color: '#0f3d3e' },
    accent: '#e8b04b',
    textColor: '#f7f5ef',
    mutedColor: 'rgba(247,245,239,0.6)',
    qrTile: '#ffffff',             // keep this light — see the note below
    captionSizePt: 8,
    hintSizePt: 6,
    border: 'none',
    stripe: false
  }
}
```

That is the whole change. The template picker in the builder, the dashboard and
`templates/` are all generated from `TEMPLATES`, so it appears everywhere
immediately, with a live preview on both sides.

**Keep `qrTile` light and the QR modules dark.** QR readers look for contrast; an inverted code
(light modules on a dark tile) fails on a large fraction of phone cameras, and the failure is
silent — the code just does not scan. This is the one styling decision that is not a matter of
taste.

### The harder case: a new layout

`layout` is the only field that changes structure. `Card.buildFront` branches on it:

```js
if (template.layout === 'centered') { /* type over a monogram, photo as a small ring */ }
else                                { /* photo-left: photo beside the type */ }
```

To add a third layout, add a branch that pushes items onto the display list. Everything is in
millimetres with y increasing downwards, and you have `GEOMETRY.widthMm` / `heightMm` to work
in:

```js
function buildMyLayout(profile, template, options) {
  var list = [];
  var W = TPL.GEOMETRY.widthMm, H = TPL.GEOMETRY.heightMm;
  gradientRect(list, template.front.background, 0, 0, W, H);

  var fit = Card.fitText(profile.display_name, {
    sizePt: template.front.nameSizePt, minSizePt: 8,
    maxWidthMm: W - 2 * TPL.GEOMETRY.marginMm,
    fontFamily: 'sans', weight: template.front.nameWeight
  });
  list.push({
    type: 'text', text: fit.text, x: W / 2, y: 20,
    sizePt: fit.sizePt, fontFamily: 'sans', weight: template.front.nameWeight,
    fill: template.front.nameColor, align: 'center'
  });
  return list;
}
```

Rules that keep the output printable:

- **Always `fitText`.** Names are unbounded. A 34-character name at 17 pt does not fit in 81 mm,
  and the alternative is text running off the card. `fitText` shrinks to `minSizePt` and then
  ellipsises.
- **Stay inside `marginMm`.** Nothing important closer than 4 mm to the trim edge.
- **Emit items, do not draw them.** The display list is consumed by both `toSVG` and
  `PdfCard.generate`. If you draw something directly you have created a preview/print mismatch,
  which is exactly the bug this architecture exists to prevent. Supported item types are listed
  in [docs/API.md#card](API.md#card).
- **Test it.** `templates/` renders every template twice per side — once with a
  normal profile and once with deliberately over-long text — so a new template's overflow
  problems are visible immediately, without writing a test.

---

## 6. The web page

`assets/styles.css` is the whole theme. It reads the CSS custom properties set by
`CardTemplates.toCssVars`, so most visual changes need no CSS at all — change the template.

Structural changes:

- **The link list** is rendered by `profile/profile.js` into `.link-card` elements. Each has
  a label, the URL, a visibility flag and an icon. Reorder the markup, restyle with CSS; the
  behaviour (external links open in a new tab with `rel="noopener"`) is set in JS and is worth
  keeping.
- **The share block** (`.share-block`) is the page's one offer: the permanent URL as selectable
  text, a Copy link button and Open. It is not demo-only — it is on every card, real or example.
  If you do not want it, replace it rather than delete it: a visitor who likes your card has no
  other way to take the link with them. It carries `.no-print`, so it never reaches paper.
- **The page theme** comes from `profile_settings` in the profile JSON — `layout` (`pinterest`
  grid or `stack`), `link_shape` (`rounded`, `pill`, `square`), `page_color`, `link_color` and an
  optional `page_background_image` — applied by `applyTheme()` as `--profile-page-*` custom
  properties on top of the card template's palette. The pale veil that keeps type legible over a
  background photo is only painted when there is a photo, so a dark theme stays dark. Each profile
  in `examples/` sets a different one, which is what makes that page a theme gallery.
- **Print rules** are at the bottom of the stylesheet (`@media print`). The profile page is not
  meant to be printed, but the print sheet is, and it hides every piece of chrome.

`profile/` is the page a QR code opens. Keep it fast: one JSON fetch, no framework, no
web font, no third-party script. A stranger scanning your card is often on mobile data outside a
venue, and every 100 ms is a chance they give up.

---

## 7. URL structure

The permanent address a card prints is `/c/<username>/`. It is a **real file**, generated by
`tools/build-links.js`, so it works on plain GitHub Pages with no rewrite rules, no build step,
and no server configuration:

```
profile-data/riley.json   ──npm run build──▶   c/riley/index.html   (a ~14-line stub)
                                              c/index.html         (a directory of your cards)
```

The stub runs the same renderer as `profile/`, so there is one implementation and one set of
tests for both. `404.html` boots that renderer for any path, which is why the URLs also work on
a deployment that skipped the build.

`profile/?u=<username>` still works and is what every tool links to when you are editing. The
difference is that `/c/` is what gets printed, because it is the URL a stranger types and the one
that survives moving hosts.

### Nothing about this is configured

The deployment root is derived at runtime from the page's own location (`Store.siteRoot()`), and
the address encoded in a QR is `Store.profileUrlFor(username)` — see
[docs/ARCHITECTURE.md §4b](ARCHITECTURE.md#4b-nothing-knows-where-it-is-deployed). Rename the
repository, deploy to Netlify, put it behind a custom domain: the cards follow, and you change no
file. That is deliberate — the one thing you cannot fix after printing is a QR code pointing at
the wrong website.

Also supported in the URL:

| Param | Meaning |
| --- | --- |
| `?u=rahul123` | Which profile to show |
| `?t=temp_abc123` | A temporary-access token |
| `?viewer=user_priya` | Simulate being an approved follower (V1 demo only; V2 uses a session) |
| `?demo=1` | Read the shipped fixtures instead of your own profiles, and treat the page as an evaluation view |

The first three combine, and precedence is follower → token → public.

`?demo=1` does two things that have to agree. It repoints the data directory at `examples/`
(`Store.dataDir()`, unless the page sets `<body data-profile-dir>` itself), and it tells
`profile/boot.js` that this is a demo rather than somebody's real card, so the page drops the
owner's navigation. Splitting those would mean a demo link for a person the page cannot find —
which is exactly what happened when the fixtures moved out of `profile-data/`: the README's demo
URLs and every link in the examples gallery rendered "No profile here".

**So any link that names a fixture must carry the flag.** Navigating to another page loses the
current page's `data-profile-dir`, and the destination has no way to know it was handed a fixture
username. `tests/dom.test.js` sweeps the whole repository for links to a name in
`examples/index.json` that omit `demo=1`.

The flag is only ever set on fixture URLs, where every link is fake and public. Without it a
username that is not in `profile-data/` shows the empty state rather than falling back to the
fixtures — rendering a stranger's example profile on somebody's own domain would be worse than an
empty page. And nothing on a real profile invites anybody to guess at a `?viewer=` shortcut:
publishing `/profile/?viewer=user_priya` would be publishing a way to see your followers-only
links, and this project's whole premise is that a URL you hand out is not a URL you can take
back.

### Moving hosts, and the one override

Because the URL is derived, moving hosts needs no code change — but **it does mean reprinting**,
since the address on an existing card stops resolving. If you want a card to survive the move,
print a domain you own and point it at the deployment. That is the only reason to set
`profile_url` (or `<body data-site-root>`) by hand, and it must be absolute.

---

## 8. Your own print products

`lib/pdfdoc.js` (`SimplePdf`) is a general-purpose PDF writer with millimetre coordinates, so
you can script things the UI does not offer:

```js
const doc = new SimplePdf({ title: 'Table tent' });
const page = doc.addPage(148, 210);                    // A5
page.rect(0, 0, 148, 210, '#0f3d3e');
page.text('Scan me', 74, 40, 28, '#f7f5ef', 'middle', true);
const qr = QRCode.create('https://you.dev/c/rahul123', { ecl: 'Q', margin: 0 });
const moduleMm = 60 / qr.size;                         // a 60 mm symbol
for (let y = 0; y < qr.size; y++) {
  for (let x = 0; x < qr.size; x++) {
    if (qr.get(y, x)) page.rect(44 + x * moduleMm, 70 + y * moduleMm, moduleMm, moduleMm, '#f7f5ef');
  }
}
fs.writeFileSync('tent.pdf', doc.build());
```

For sheets of many codes, `qr-generator/generator.js` already does the packing:
`QrGenerator.layout()`, `position()` and `sheetPdf()` handle any paper size in `QrGenerator.PAPER`
(A4, Letter, A5, A6 — add your own in one line).

Coordinates are millimetres from the **top-left**; the writer converts to PDF's bottom-left
points internally. Multiply millimetres by `SimplePdf.PT_PER_MM` if you need points yourself —
dividing by `MM_PER_PT` gives the same number, and mixing the two up produces a PDF that is 8×
the wrong size, which is the most common mistake when writing PDF geometry by hand.

---

## 9. Changing what "private" means

`visibility` has two values, `public` and `followers_only`, matching the three tiers in
[docs/ARCHITECTURE.md](ARCHITECTURE.md#2-the-three-access-tiers). Adding a third — say
`token_only`, for a link that is never visible to followers and only ever reachable through a
temporary link — means:

1. Add it to `AccessRules.VISIBILITY`.
2. Teach `AccessRules.isLinkVisible(link, tier, tokenVerdict)` about it. `resolveAccess` calls
   that one function, so the tiers themselves need no changes.
3. Add it to the dashboard's visibility picker and the profile page's flag rendering.
4. Add tests to `tests/access.test.js` — the existing suite covers every tier transition, so the
   gap is easy to see.

`validateProfile` defaults an unknown `visibility` to `public` and warns, rather than failing.
That is deliberate: a typo should not blank somebody's card. But it also means a typo silently
*publishes* a link you meant to hide, so if you add a value, add it to the validator's accepted
list in the same commit.

---

## 10. What not to change

- **Do not print a temporary link.** It expires. The QR on a card encodes `profile_url`, which is
  permanent, and that is the entire premise. If you find yourself wanting to encode a `?t=` URL
  on paper, what you actually want is a second public link.
- **Do not remove the "this is not real access control" note** from the profile page while V1 is
  client-side. It is the difference between a demo that is honest and one that misleads someone
  into publishing a private price list. Remove it when, and only when, the tier decision runs on
  a server that filters the response.
- **Do not put a third-party script on the profile page.** No analytics, no font CDN, no chat
  widget. The page has zero dependencies so that it works offline, loads instantly on mobile
  data, and cannot be broken by someone else's outage — and so that a person who forks this repo
  to make their own card is not silently shipping their visitors' data to a company they have
  never heard of.
- **Do not make `qrTile` dark.** See [§5](#5-adding-a-template).
