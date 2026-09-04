# Contributing

Thank you for looking at this. The bar for contributing here is low: the whole project is
plain HTML, CSS and ES5-compatible JavaScript with no build step, so you can change something
and see it in a browser in five seconds.

There are two very different kinds of contribution, and the difference is deliberate:

- **[A card template](#contributing-a-card-template)** — one new file in
  `card-templates/community/`, no core changes, validated by CI. Designs are a matter of taste
  and taste does not need a maintainer's approval to exist, so this path is as frictionless as
  we can make it. Start with [docs/TEMPLATES.md](docs/TEMPLATES.md).
- **[A change to the core](#adding-a-feature)** — the encoder, the access rules, the card
  geometry, the tools, the tests. Read the rest of this file first.

This repository is also a template that people fork to make their own link-sharing system, so
one extra rule applies to everything: **a fork must never have to edit a URL, a domain or a
deployment path.** If your change requires the person who forked it to configure where they
hosted it, derive it instead (see `Store.siteRoot()`).

---

## Getting set up

```bash
git clone https://github.com/clickalex/GrinCard.git
cd GrinCard
npm run build                      # generate the /c/<username>/ stubs and manifests
npm start                          # python3 -m http.server 8080
```

Open <http://localhost:8080/>. There is nothing to install to *run* the project — no
`node_modules`, no bundler, no transpiler, no CSS preprocessor. Node is needed for the tests and
for `npm run build`, which writes a handful of small generated files and nothing else.

Please do not open the HTML files directly over `file://`: browsers block `fetch()` between
local files, so the pages load but show no data. That looks like a bug and is not one.

---

## The two rules

**1. Zero runtime dependencies.** Nothing in `lib/`, `card-templates/` or any page may import a
package, load a CDN script, or fetch a web font. The point of this project is that you can fork
it, host it anywhere, and it will still work in ten years when the CDN is gone — and that a
person printing a card is not silently shipping their visitors' data to a third party.

Dev-only *test* dependencies are fine and are used heavily (see below), but they live outside the
repository and nothing in the shipped site touches them. `package.json` exists only so that
`npm test` and `npm start` work; its `dependencies` and `devDependencies` are both `{}` and
should stay that way. Adding a package there is the same mistake as adding a CDN script.

**2. ES5-compatible JavaScript in `lib/` and the pages.** `var`, not `let`. No arrow functions,
no template literals, no `Object.assign` in a hot path, no modules. This is not nostalgia: the
profile page is opened by whoever scans your card, on whatever phone they have, and a print
shop's proofing machine is often running a browser from 2015. Test files run in modern Node and
may use anything Node supports.

If you find yourself wanting to break rule 2 for a good reason, open an issue first — there may
be a way to get it without giving up the compatibility.

---

## Code style

There is no linter configured, on purpose: a linter is a dependency, and the codebase is small
enough to keep consistent by reading it. Follow what is already there.

- Two-space indent, semicolons, single quotes in JS.
- `function` declarations over assigned expressions in `lib/`; small named helpers over inline
  closures.
- Comment the **why**, not the what. The comments that earn their keep in this repo are the ones
  that say *"the format modules count towards the penalty, so they must be rewritten for every
  candidate"* — a fact you cannot recover from reading the code.
- Every module is UMD with the same shape:

  ```js
  (function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./x.js'));
    else root.MyGlobal = factory(root.X);
  }(typeof self !== 'undefined' ? self : this, function (X) {
    'use strict';
    // …
    return { /* public surface */ };
  }));
  ```

- Keep DOM-free logic DOM-free. `qr.js`, `access.js`, `card-templates.js`, `card.js`, `pdf.js`,
  `pdfdoc.js` and `generator.js` never touch `document`, `window` or `fetch`, which is why they
  are testable in plain Node and reusable in a future backend. Only `store.js`, `export.js` and
  the page scripts may use browser APIs.
- Paths inside pages are **relative** (`../lib/qr.js`), never root-absolute (`/lib/qr.js`), so the
  site works at any depth. Use `Store.pageRelative()` when you need to turn the current page's
  location into a URL — directory URLs like `/card-builder/` have no filename to replace, and
  getting this wrong produces a QR code pointing somewhere that does not exist.

---

## Tests

```bash
npm test          # all five suites
npm run test:core # just lib/access.js — tiers, tokens, followers; needs nothing installed

node --test tests/qr.test.js          # individually, if you prefer
```

On a fresh clone `npm test` gives **58 passing and 68 skipped**, and finishes in under a second.
The skips are the suites that compare our output against independent implementations; they print
an install hint rather than crashing, so a missing oracle never looks like a broken build. With
the oracles installed you get all **126**.

> The script lists the five files explicitly. `node --test tests/` trips over module resolution
> in some Node versions — a known papercut, not something you did.

### The dev-only oracles

These are how we know a printed card will actually scan: render our own PDF with Mozilla's
reader, then decode the pixels with an independent QR decoder. They are **not** project
dependencies — install them outside the repository:

```bash
mkdir -p /tmp/oracle && cd /tmp/oracle
npm init -y
npm i qrcode@1.5.4 jsqr pdfjs-dist @napi-rs/canvas jsdom
```

`tests/oracle.js` looks for them in `$QR_ORACLE_DIR`, then `/tmp/oracle`, then
`$TMPDIR/oracle`, then a gitignored `.oracle/` in the repo. Point it anywhere:

```bash
QR_ORACLE_DIR=~/dev/oracles npm test
QR_ORACLE_DIR=/tmp/empty    npm test   # deliberately run the skip path
```

| Package | What it proves |
| --- | --- |
| `qrcode` | Our QR matrices are byte-identical to the reference encoder's, across versions and ECLs |
| `jsqr` | The QR we drew decodes back to the exact URL we put in — after being rendered to pixels |
| `pdfjs-dist` | Our hand-written PDF is a valid PDF that a real reader parses, at the right page size |
| `@napi-rs/canvas` | Renders that PDF at 300 DPI so jsQR can scan it |
| `jsdom` | Runs the pages, with real scripts and real events, without a browser |

If you add a test that needs one, gate it rather than letting it crash:

```js
const ORACLE = require('./oracle.js');
test('my check', { skip: !ORACLE.available ? ORACLE.INSTALL_HINT : false }, async () => {
  const { doc } = await ORACLE.readPdf(bytes);          // pdfjs-dist
  const { ctx } = await ORACLE.rasterisePage(doc, 1, 300);  // @napi-rs/canvas
  assert.equal(ORACLE.decodeQr(ctx.getImageData(x, y, w, h)).data, url);  // jsQR
});
```

The two round-trip tests are the most valuable thing in the repo: **render our own PDF with
someone else's reader, then decode the pixels with someone else's QR decoder.** That catches
wrong module sizes, wrong quiet zones, inverted coordinate systems and off-by-one bleed — a whole
class of bug that no amount of self-consistent asserting would find, because our own code would
agree with itself.

If you change anything in `lib/qr.js`, `lib/card.js`, `lib/pdf.js`, `lib/pdfdoc.js` or
`qr-generator/generator.js`, run all five suites. If you change a page, `dom.test.js` is the one
that matters.

### What to add tests for

- A new access rule → `tests/access.test.js`. Cover every tier transition and every failure
  reason; the existing tests are a good shape to copy.
- A new template → nothing, and that is intentional. `tools/build-templates.js` validates it
  against the schema in CI (including the "QR tile must be light" rule), and `templates/` renders
  every registered template twice per side — once normal, once with a 28-character name — so
  layout regressions are visible by eye. If your template does something *structural*, add a
  `tests/card.test.js` case. See [docs/TEMPLATES.md](docs/TEMPLATES.md).
- A new tool in `tools/` → a `tests/tools.test.js` case that runs it against a fixture directory
  and asserts on the files it wrote, including that a second run changes nothing.
- A new generated file → make `npm run validate` check it. CI fails on a stale manifest, which
  is the only thing standing between a contributor and a silently missing profile.
- A new page → add it to the page/script pairs in `tests/dom.test.js`. Two static checks run
  automatically over every HTML file: no reference to a missing local file, and no CDN or
  dependency mention. They will fail your PR if you add a `<script src="https://…">`.
- Anything that produces a printable artefact → assert the millimetre dimensions and, if it
  contains a QR, decode it. Do not assert "the PDF contains the string `89`".

---

## Contributing a card template

The short version — [docs/TEMPLATES.md](docs/TEMPLATES.md) has the full schema and the
troubleshooting table.

```bash
cp card-templates/community/sunset.js card-templates/community/my-design.js
$EDITOR card-templates/community/my-design.js     # change id, name, colours
npm run build:templates                            # validates it, writes index.json
npm start                                          # open /templates/ to see it
```

Then commit **both** the new file and the regenerated
`card-templates/community/index.json`, and open a pull request.

A template is data, not code, so review is about three things:

1. **It is valid.** `tools/build-templates.js` already checked the schema, that the `id` is
   unique across core and community, and — the one rule that is not about taste — that
   `back.qrTile` is a light colour, because inverted QR codes fail on a large fraction of phone
   cameras.
2. **It survives real content.** The gallery renders every template twice: once normally, once
   with a 28-character name, a long role and a long tagline. Both must fit inside the
   89 × 51 mm trim area with no overflow.
3. **It is honest about itself.** `name`, `description` and `author` are what the gallery shows,
   so they should describe the design rather than advertise. `license` defaults to MIT.

No core file changes, which is the point: a pull request that only adds a file cannot conflict
with another one that only adds a file.

Please also check what a browser preview cannot tell you — print one (the PDF export from
`card-builder/`, at 100%, not fit-to-page), scan it with a phone in ordinary indoor light, and
look at it in greyscale, because plenty of cards are printed in one colour.

---

## Adding a feature

1. **Check [PLANNING.md](PLANNING.md).** If it is on the roadmap, there may already be a decision
   about how it should work, and the V1/V2 boundary is drawn deliberately.
2. **Keep it static-first.** If the feature needs a server, it is V2, and it needs a design that
   lets V1 keep working without one. `lib/access.js` is the model: the tier logic is a pure
   function, so the same code can run in a browser today and in a server handler later without a
   rewrite.
3. **One layout, two outputs.** If it draws on a card, emit display-list items in `lib/card.js`.
   Never draw separately for preview and print — that is how the two end up disagreeing, and you
   find out at the print shop.
4. **Say what it does not do.** This project's credibility rests on being honest about V1's
   limits (the client-side tier logic demonstrates privacy, it does not enforce it). If your
   feature has a caveat, put the caveat in the UI, not only in the docs.
5. **Update the docs in the same PR.** [docs/API.md](docs/API.md) documents every public function
   with its real signature and defaults; [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) documents
   every knob. A new knob nobody knows about is not a feature.

---

## Pull requests

- One idea per PR. Small, reviewable diffs get merged; 2000-line ones wait.
- Describe what a user can now do that they could not before, and how you tested it.
- Include the test. If you cannot write one, explain why — "it is visual" is acceptable for a
  template, "it is hard" is not.
- Run `npm test` with the oracles installed (all 126, not the 58 that skip) and say so in the
  description.
- If you changed print geometry, say what you measured. A ruler against
  `print/` counts.

Things that will get a PR bounced:

- A CDN `<script>` or any runtime dependency.
- A new global that collides with an existing one. There are exactly nine: `QRCode`,
  `CardTemplates`, `AccessRules`, `Card`, `PdfCard`, `SimplePdf`, `Store`, `Exporter`,
  `QrGenerator`. (`lib/pdf.js` has an internal class also called `PdfDoc`, which is a known
  wart — it is not exported as a global. If you touch that file, consider renaming it.)
- Removing the "this is a demo, not real access control" note from the profile page.
- Encoding a temporary (`?t=`) URL into a printable card.
- `let`/`const`/arrow functions in `lib/` or the pages.

---

## Reporting a bug

The most useful report says:

1. The page and the full URL, including query parameters.
2. What you expected and what happened.
3. Browser and version.
4. If it is a print problem: what you printed (PDF/PNG/print sheet), what the print dialog's
   scale setting was, and what the card measured with a ruler.
5. If it is a scan problem: the URL encoded in the QR (the caption under the code is the short
   form; the dashboard shows the full one), the phone, and how far away you held it.

For anything involving a QR that will not scan, the fastest diagnosis is
`templates/` — its QR panel reports the version, module count and mm-per-module for
your exact URL, which tells you immediately whether the problem is density or something else.

---

## Where things are

| Question | Look in |
| --- | --- |
| Why does the visitor see these links? | `lib/access.js` → `resolveAccess` |
| Why does the card look like this? | `card-templates/card-templates.js` (colours, type) and `lib/card.js` (layout) |
| Why is the PDF like this? | `lib/pdf.js` (cards) or `lib/pdfdoc.js` (sheets) |
| Where does the page's data come from? | `lib/store.js` — repo JSON merged with `localStorage` |
| Where does a page's URL come from? | `lib/store.js` → `siteRoot()`, `rootRelative()`, `profileUrlFor()` |
| How does `/c/<username>/` exist? | `tools/build-links.js` (stubs) and `404.html` (fallback) |
| How does a template get loaded? | `CardTemplates.loadCommunity()` + `card-templates/community/index.json` |
| Why is the download like this? | `lib/export.js` |
| What are the physical dimensions? | `CardTemplates.GEOMETRY` |
| What is planned and why? | [PLANNING.md](PLANNING.md) |
| How does it all fit together? | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

---

## License

By contributing, you agree your contributions are licensed under the project's
[MIT license](LICENSE).
