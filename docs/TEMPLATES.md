# Writing a card template

A template is one file. Drop it in `card-templates/community/`, add one line to that
folder's `index.json`, and it appears in the gallery, in the card builder, in the
dashboard's picker, in the PDF/PNG exports and on the profile page's colour scheme —
without changing a single core file.

That last part is the point. A contribution that has to edit `card-templates.js`
cannot be merged without a maintainer reconciling it against every other
contribution, so it never gets merged. One file per template means one pull request
per design, and designs stop competing with each other.

- **Just want different colours?** You do not need a template. Set
  `card_settings.primary_color` and `card_settings.accent_color` in your profile
  JSON — see [CUSTOMIZATION.md](CUSTOMIZATION.md).
- **Want to send your template upstream?** See
  [CONTRIBUTING.md](../CONTRIBUTING.md) for the pull-request checklist.

---

## 1. Start from the example

[`card-templates/community/sunset.js`](../card-templates/community/sunset.js) is a
complete, working contribution. Copy it:

```bash
cp card-templates/community/sunset.js card-templates/community/my-design.js
```

Then edit the `id`, `name`, `description`, `author` and the colours.

The file must be a self-registering UMD module, because the same file is loaded by
the browser *and* by the validator in Node:

```js
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // tests + CI
  else if (root.CardTemplates) root.CardTemplates.register(api);           // the browser
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return { /* the template */ };
}));
```

Keep that wrapper exactly as it is. `register()` is what makes the template appear
without anything else changing; the `module.exports` branch is what lets CI read it.

## 2. Register it

Run:

```bash
npm run build:templates
```

That scans the folder, validates every file, and writes `index.json`. Add the
generated line to your commit — CI checks that the manifest matches the folder, so a
template that is on disk but not listed fails the build rather than silently never
loading.

If you would rather edit `index.json` by hand, add one entry:

```json
{ "file": "my-design.js", "id": "community-my-design", "name": "My Design",
  "author": "You", "description": "…", "license": "MIT" }
```

`file` is the only required field; the rest is what the gallery displays.

## 3. The schema

```js
{
  id: 'community-my-design',   // lowercase; unique across core AND community
  name: 'My Design',           // shown in pickers and the gallery
  description: 'One line…',
  author: 'You',               // optional, appreciated
  license: 'MIT',              // optional, defaults to MIT
  layout: 'photo-left',        // or 'centered' — the two the renderer implements

  front: { … },                // the photo/name/role side
  back:  { … }                 // the QR side
}
```

### `front`

| Field | Type | Notes |
| --- | --- | --- |
| `background` | `{type:'solid', color}` or `{type:'gradient', from, to, angle}` | `angle` in degrees |
| `accent` | colour | Rules, the monogram ring, small highlights |
| `nameColor`, `roleColor`, `taglineColor` | colour | The three text levels |
| `monogramBg`, `monogramColor` | colour | Used when there is no photo |
| `photoShape` | `'circle'` \| `'round'` | Optional |
| `photoRing` | colour | Optional |
| `rules` | colour | Hairline separators |
| `nameFont` | `'sans'` \| `'serif'` | Resolved to the system stacks in `card-templates.js` |
| `nameWeight` | number | 400–800 |
| `nameSizePt`, `roleSizePt`, `taglineSizePt` | number | **Maximum** sizes — see §4 |
| `stripe`, `border` | boolean / colour | Optional |

### `back`

Same shape, plus the one field that decides whether the card works at all:

| Field | Type | Notes |
| --- | --- | --- |
| `qrTile` | colour | **Must be light.** The QR is drawn dark-on-`qrTile`. |
| `textColor`, `mutedColor` | colour | The caption and the hint line |
| `captionSizePt`, `hintSizePt` | number | Maximum sizes |

## 4. The rules that are not about taste

`CardTemplates.validateTemplate()` enforces these, and CI fails the build on any of
them. They exist because a template that violates them produces a card that looks
fine on screen and fails in someone's hand.

1. **`back.qrTile` must be a light colour.** Inverted (light-on-dark) QR codes fail
   on a large fraction of phone cameras — the finder patterns are specified as dark
   modules on a light background, and many decoders assume it. This is a hard error,
   not a warning. If you want a dark back, keep the QR on a light tile and let the
   tile read as a design element.
2. **`id` must be unique across core and community.** Shadowing a built-in template
   would silently change what someone's already-printed cards look like.
3. **Type sizes are maximums, not promises.** The renderer shrinks text to fit the
   89 × 51 mm trim area and then ellipsises it, so a long name cannot overflow. Set
   the size you want for a *short* name; the stress test in `templates/` shows what
   happens to a long one.
4. **Nothing is gated.** `free: false` is recorded and warned about, but the core is
   free — there is no code path that charges for a template. Paid features in this
   project are cosmetic and belong to a hosted service, not to the open-source core.
5. **No remote assets, no network calls, no fonts to download.** A template is data.
   If it fetches anything, the printed output depends on a server you do not control
   at the moment someone is at a print shop.

## 5. Check your work

```bash
npm run build:templates      # validate + regenerate the manifest
node tools/check-links.js    # nothing references a file you moved
npm test                     # the DOM suite renders every registered template
npm start                    # then open http://localhost:8080/templates/
```

The gallery at `templates/` is the fastest feedback loop: it renders your template
against two example profiles, twice each — once normally and once with a
deliberately awkward long name, role and tagline. If your design survives the second
pair, it survives real content.

Then check the things a browser preview cannot tell you:

- **Print it.** `print/` lays out a sheet; export the PDF from `card-builder/` and
  look at it at 100%, not fit-to-page. See [PRINTING.md](PRINTING.md).
- **Scan it.** On a phone, in ordinary indoor light, at arm's length. If your back
  design puts a colour or a rule near the QR, that is where scanning breaks first.
- **Greyscale it.** Plenty of cards are printed in one colour. A design that relies
  on hue alone to separate the name from the role will not survive.

## 6. How a template gets loaded

Worth knowing, because it explains the manifest:

1. A page calls `CardTemplates.loadCommunity('card-templates/community/')`.
2. That fetches `index.json` — a static site cannot list a directory, so the manifest
   *is* the directory listing.
3. Each listed file is injected as a `<script>`, in order, and self-registers.
4. `CardTemplates.all()` then returns core templates followed by contributed ones,
   and every picker and renderer uses `all()`.

`loadCommunity()` never rejects: a missing folder, a broken manifest or a rejected
file degrades to the built-in templates and logs a warning. A bad contribution can
make itself invisible; it cannot take someone's card page down with it.

## 7. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Template does not appear anywhere | Not in `index.json`. Run `npm run build:templates`. |
| `CardTemplates: rejected "…"` in the console | Validation failed; the message lists every reason. Run the build to see it in CI form. |
| Gallery shows it, builder does not | The builder loads community templates on startup — hard-reload, and check `npm run build:templates` passed. |
| Card renders as Midnight (`template-1`) | Your `id` does not match `card_settings.template_id`, or the file threw while loading. |
| QR will not scan | `qrTile` is too dark, the QR is printed under 20 mm, or the quiet zone was cropped. See [PRINTING.md](PRINTING.md). |
| Profile page colours do not match the card | The page uses `toCssVars()`; make sure `front.background`, `accent`, `nameColor`, `roleColor` and `taglineColor` are all set. |
