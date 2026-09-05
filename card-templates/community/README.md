# Community card templates

One file per design. Drop a `.js` file in here and it appears in every template picker on the
site — the card builder, the dashboard, the print sheet and the gallery. Nothing in
`card-templates.js` changes, and no core file needs editing.

Start from the worked example:

```bash
cp card-templates/community/sunset.js card-templates/community/my-design.js
$EDITOR card-templates/community/my-design.js    # change id, name, colours, author
node tools/build-templates.js                    # validate and refresh index.json
```

Full authoring guide: [docs/TEMPLATES.md](../../docs/TEMPLATES.md).
Contributing one upstream: [CONTRIBUTING.md](../../CONTRIBUTING.md).

## `index.json` is generated — do not edit it

`tools/build-templates.js` writes it, `npm run validate` checks it, and the Pages workflow
regenerates it on deploy. It exists because `CardTemplates.loadCommunity()` needs to know which
files to load **and in what order**: two scripts racing to register would produce a picker whose
contents depend on which one finished first.

Editing it by hand means your change is silently overwritten at the next build. Add the file and
run the script instead.

## Why a design can be rejected

`register()` returns `null` and logs the reason rather than throwing — a bad template must never
break someone's cards. `node tools/build-templates.js` reports the same failures, so CI catches
them before you do.

The rules, in the order that matters to a printed card:

- **`back.qrTile` must be light.** A dark tile behind the code inverts it, and inverted QR codes
  fail to scan on a large fraction of phone cameras. This is a broken card, not an ugly one.
- **`id` must be unique across core and community.** Shadowing a built-in id would silently change
  cards that have already been printed and handed out.
- **Every `front.*` and `back.*` field must be present.** The display list draws exactly what the
  template says; there are no defaults to fall back on.
- **`layout` must be `photo-left` or `centered`** — the renderer branches on it. Adding a third
  means a branch in `Card.buildFront`; see
  [docs/CUSTOMIZATION.md](../../docs/CUSTOMIZATION.md#the-harder-case-a-new-layout).

Warnings, not errors: an unknown `photoShape` (drawn as `round`), `free: false` (recorded, but
nothing in this project is gated on it — the core is free), and a missing `author`.

## One more thing if you fork this repository

This folder is yours as much as the rest of the repo is. A template you add here ships with your
site; it does not need to go upstream. If you do want it in the project, the pull request needs
the same file and nothing else — CI runs `node tools/build-templates.js --check`, so include the
regenerated `index.json`.
