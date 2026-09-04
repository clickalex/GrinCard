# QR Link Card

**One printed card. One permanent QR code. Three different things it can show.**

A business card whose back is a QR code pointing at a URL *you* own. The URL never
changes — you print it once — but what a visitor sees depends on how they arrived:

| Who is looking | What they see | How |
| --- | --- | --- |
| A stranger who scans your card | Your public links only (5 max on the free tier) | `/c/rahul123/` |
| Someone you handed a link to | Public links **+ one** private link you chose | `/c/rahul123/?t=temp_abc123` |
| A follower you approved | Everything, including all private links | signed in, or `?viewer=…` in this static version |

That is the whole idea: the *card* is permanent, the *content* behind it is not.

It is also a **template**. Fork it, drop one JSON file in, enable GitHub Pages, and you
have your own link-sharing system at your own URL — no server, no database, no account,
no build step, no dependencies. Everything is MIT.

---

## Use it as your own (three steps)

```bash
# 1. Fork, then clone your fork
git clone https://github.com/YOU/GrinCard.git && cd GrinCard

# 2. Rename the starter profile to your username and edit your links
mv profile-data/yourname.json profile-data/rahul.json
$EDITOR profile-data/rahul.json

# 3. Generate your permanent URL and run it locally
npm run build && npm start
```

Open <http://localhost:8080/> and your card is listed with the URL to print and a QR code
beside it. Push to GitHub, enable Pages, and `https://YOU.github.io/GrinCard/c/rahul/` is
live — that is what goes on the card.

**You never type your own URL.** `Store.profileUrlFor()` derives it from wherever the site
is actually being served, so a fork's cards point at the fork, a custom domain changes
nothing, and a subdirectory deployment still works. The full walkthrough, including the
GitHub Action that regenerates your links on every push, is in **[SETUP.md](SETUP.md)**.

After that, day-to-day use is editing JSON — or using the [dashboard](dashboard/) if you
would rather have a form and a live preview.

---

## See it working

These run on the deployed copy of this repository, using the fixture profiles in
[`examples/`](examples/). Your fork gets the same pages pointed at your own data.

| Page | What it shows |
| --- | --- |
| [Example profiles](https://clickalex.github.io/GrinCard/examples/) | Both fixtures, with a link for each of the four tiers |
| [Public view](https://clickalex.github.io/GrinCard/profile/?u=rahul123&demo=1) | What a stranger's phone opens |
| [Temporary link](https://clickalex.github.io/GrinCard/profile/?u=rahul123&t=temp_demo_live&demo=1) | One private link unlocked, with an expiry countdown |
| [Expired temporary link](https://clickalex.github.io/GrinCard/profile/?u=rahul123&t=temp_demo_expired&demo=1) | The graceful fallback — no error page, just the public view |
| [Approved follower](https://clickalex.github.io/GrinCard/profile/?u=rahul123&viewer=user_priya&demo=1) | Every link visible |
| [Card index](https://clickalex.github.io/GrinCard/) | The site root on a fork: your cards, your URLs, your QR codes |
| [Card builder](https://clickalex.github.io/GrinCard/card-builder/) | Design a card, download print-ready files |
| [Dashboard](https://clickalex.github.io/GrinCard/dashboard/) | Edit links, mint temporary links, approve followers |
| [Template gallery](https://clickalex.github.io/GrinCard/templates/) | Every template, both sides, live QR stats |
| [Print sheet](https://clickalex.github.io/GrinCard/print/?u=rahul123) | True-to-size 89 × 51 mm, ready for the printer |
| [QR generator](https://clickalex.github.io/GrinCard/qr-generator/) | One code, or an A4 sheet of them for stickers and table tents |

Every one of those pages is in this repository and works offline once cloned.

---

## What you get

**The card** — 89 × 51 mm, the ISO/IEC 7810 ID-1 size that every card printer and print
shop already understands. Front: photo (or initials), name, role, tagline. Back: a QR code
of at least 20 mm with a proper quiet zone, plus your name and URL in text so the card still
works if the code is damaged.

**Vector print output** — the download is a real PDF with vector paths and selectable text,
written at exactly 89 × 51 mm. Not a screenshot of a webpage. Print it at 100% and it is
correct to the millimetre; ask a print shop for 300 DPI and they get 300 DPI.

**A QR encoder with no dependencies** — `lib/qr.js` is a from-scratch Reed–Solomon QR
encoder (byte mode, versions 1–40, ECL L/M/Q/H, all eight masks, correct penalty scoring).
It is verified byte-for-byte against the reference `qrcode` npm package, and its output is
verified *again* by decoding the rendered PDF with `jsQR`. So the code that prints is the
code that scans.

**Clean permanent URLs** — `/c/<username>/`, generated from your JSON by
`tools/build-links.js`, with a `404.html` that boots the same renderer in place so the link
works even before the stubs exist. No `?u=` in your printed URL.

**Temporary links** — mint a link that unlocks one private item for ten minutes, an hour or
a day. When it expires, visitors fall back to the public view instead of hitting an error.

**Followers** — a request/approve flow for people who should see everything.

**A QR generator** — paste a list of URLs, get an A4 sheet of QR codes with labels. Useful
for stickers, table tents, event badges, or a wall of links in a shop.

**Contributed card templates** — a template is one self-registering file in
`card-templates/community/`, validated by `npm run validate` and rendered in the gallery beside
the built-ins. No core file changes, so designs do not have to be reconciled against each other.
See [docs/TEMPLATES.md](docs/TEMPLATES.md).

**No paywalls in the core** — the tier limits (5 public links, 1 active temporary link) are
product limits defined in one place, `lib/access.js`, and a self-hoster can change them with
a one-line edit. Nothing is behind a licence check, and no template is gated. See
[PLANNING.md](PLANNING.md) for what "paid" is meant to be: cosmetic templates and hosting,
never the ability to share your own links.

---

## How it is put together

```
index.html                     the site root: YOUR cards, URLs and QR codes
404.html                       boots the profile renderer for any /c/<username>/ path
profile/                       the public profile page — the thing a QR opens
  index.html                   host for ?u= deep links and the owner preview
  profile.js                   the renderer (one, shared by every host)
  boot.js                      resolves the username and builds the chrome at any depth
c/                             generated /c/<username>/ stubs + a directory page
profile-data/                  YOUR profiles: one JSON file per person (+ tokens.json)
  yourname.json                the starter profile to rename and edit
examples/                      fixture profiles + tokens, used by the gallery and the tests
templates/                     every template rendered live, both sides, QR stats
print/                         true-mm print sheet with optional bleed
card-builder/                  3-step card designer
dashboard/                     owner console: links, tokens, followers, exports
qr-generator/                  standalone QR + A4 print sheets
lib/
  qr.js                        QR encoder (global QRCode)
  card.js                      display list -> SVG (global Card)
  pdf.js                       display list -> vector PDF (global PdfCard)
  pdfdoc.js                    generic PDF writer for sheets (global SimplePdf)
  access.js                    tier rules, tokens, followers (global AccessRules)
  store.js                     data + site-root discovery (global Store)
  export.js                    SVG/PNG/PDF downloads (global Exporter)
card-templates/
  card-templates.js            the registry (global CardTemplates)
  community/                   contributed templates, one file each + index.json
tools/
  build-links.js               profile-data/ -> manifests + /c/<username>/ stubs
  build-templates.js           validate contributions, keep the manifest in sync
  check-links.js               every internal link resolves, in pages and in docs
  install-workflows.js         copy the workflows into .github/workflows/
  github-workflows/            ci.yml (tests, links, generated files) + pages.yml (deploy)
tests/                         node --test: encoder, card, rules, generator, DOM, tools
docs/                          ARCHITECTURE, API, PRINTING, CUSTOMIZATION, TEMPLATES
```

The workflows live under `tools/` rather than `.github/workflows/` because GitHub refuses to let
an app token without the `workflows` permission create files there — the push is rejected, not
warned about. `npm run workflows:install` puts them where GitHub looks, and `ci.yml` then verifies
the two copies agree on every run. On your own fork you have the permission; see
[tools/github-workflows/README.md](tools/github-workflows/README.md).

The important decision is in `lib/card.js`: a card is built **once** into a display list of
millimetre-based drawing commands, and both the on-screen SVG preview and the print PDF are
rendered from that same list. Screen and paper cannot drift apart, because they are literally
the same instructions. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The second important decision is that **nothing knows where it is deployed**. `Store.siteRoot()`
reads the URL of its own script tag, and every page expresses links relative to that. So the
same files work from a repository subdirectory, a custom domain, or a directory two levels
deep, with no configuration — which is what makes this safe to fork.

---

## Documentation

| Document | Read it when… |
| --- | --- |
| [SETUP.md](SETUP.md) | you are deploying your own fork |
| [docs/TEMPLATES.md](docs/TEMPLATES.md) | you want to write a card template |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | you want to understand the tiers, the data flow, and what V1 does *not* protect |
| [docs/API.md](docs/API.md) | you are writing code against `lib/` |
| [docs/PRINTING.md](docs/PRINTING.md) | you are about to send a file to a printer |
| [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | you want new colours, different limits, or your own data directory |
| [CONTRIBUTING.md](CONTRIBUTING.md) | you want to send a pull request |
| [PLANNING.md](PLANNING.md) | you want to know what is next and why |

---

## Contributing

Two kinds of contribution, deliberately different in effort:

**A template** — one file, no core changes, validated by the same rules the tools enforce. This
is the contribution the project is built to accept, because designs are a matter of taste and
taste does not need a maintainer's approval to exist. Copy
`card-templates/community/sunset.js`, edit it, run `npm run build:templates`, open a pull
request. See [docs/TEMPLATES.md](docs/TEMPLATES.md).

**A change to the core** — the encoder, the access rules, the card geometry, the tests. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first; the QR and PDF code is verified against independent
implementations and the bar is "does not change output that is already proven correct".

---

## What V1 does and does not do

**Does:** everything above, with zero dependencies, in the browser, from static files.

**Does not:** keep a private link actually private.

That is worth stating plainly. In V1 the profile JSON is fetched by the visitor's browser, so
a `followers_only` URL is present in the downloaded file even though the page does not render
it. The tier logic is real and the user experience is exactly what the final product should
feel like, but the *enforcement* is client-side, which means it is a demonstration, not a
guarantee.

Server-side enforcement — where the private URL never reaches an unauthorised device — is the
first job of V2, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the endpoint that
will do it. The client code is written so that switching to it is a change of data source, not
a rewrite: `AccessRules.resolveAccess()` already takes a resolved access decision and does not
care who made it.

Until then: **do not put anything in a `followers_only` link that would hurt you if it were
public.** Use the private tier for a price list, not for a password.

---

## Tests

```bash
npm test          # 126+ tests across five suites
npm run test:core # just the tier/token/follower rules — needs nothing installed
npm run validate  # generated files match the repository
npm run build     # regenerate links, manifests and the template index
```

| Suite | What it proves |
| --- | --- |
| `tests/access.test.js` | Tiers, tokens, followers, validation, limits |
| `tests/qr.test.js` | Our matrices are byte-identical to the reference encoder's |
| `tests/card.test.js` | Display list, SVG, PDF — and a QR decoded back out of the rendered PDF |
| `tests/generator.test.js` | Batch layout, quiet zones, sheets, the generic PDF writer |
| `tests/dom.test.js` | Every page, executed in jsdom with real scripts and real events |

`npm test` works on a fresh clone: the suites that compare our output against independent
implementations (`qrcode`, `jsQR`, `pdfjs-dist`, `@napi-rs/canvas`, `jsdom`) **skip with an
install hint** when those dev-only oracles are missing, and everything that needs only Node
still runs. Install them to get the full suite; see
[CONTRIBUTING.md](CONTRIBUTING.md#the-dev-only-oracles). They are never project dependencies:
nothing in `lib/` or the pages imports them, and the published site has no dependencies at all.

Two notes, because they surprise people:

- Run the files explicitly, not the directory. `node --test tests/` trips over module resolution
  in some Node versions, which is why `npm test` lists all five.
- Keep the oracles **outside** the repository (`/tmp/oracle` by default, or set
  `QR_ORACLE_DIR`). A `node_modules/` in a project whose premise is having none is exactly the
  sort of thing that should not creep in by accident.

---

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, sell cards printed with it, run it as a
service, and put your own templates in it. Attribution is appreciated and never required.
