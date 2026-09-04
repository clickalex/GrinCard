# QR Link Card

**One printed card. One permanent QR code. Three different things it can show.**

A business card whose back is a QR code that points at a URL *you* own. The URL never
changes — you print it once — but what a visitor sees depends on how they arrived:

| Who is looking | What they see | How |
| --- | --- | --- |
| A stranger who scans your card | Your public links only (5 max on the free tier) | `/c/rahul123` |
| Someone you handed a link to | Public links **+ one** private link you chose | `/c/rahul123?t=temp_abc123` |
| A follower you approved | Everything, including all private links | signed in, or `?viewer=…` in this demo |

That is the whole idea: the *card* is permanent, the *content* behind it is not.

Everything here is free and open source (MIT), runs as plain static files, and needs no
build step, no server and no account. Drop it on GitHub Pages, Netlify, an S3 bucket or
`python3 -m http.server` and it works.

---

## Try it right now

| Page | What it shows |
| --- | --- |
| [Live demo profile](https://clickalex.github.io/GrinCard/demo/profile.html?u=rahul123) | The public view — what a stranger's phone opens |
| [Temporary link](https://clickalex.github.io/GrinCard/demo/profile.html?u=rahul123&t=temp_demo_live) | One private link unlocked, with an expiry countdown |
| [Expired temporary link](https://clickalex.github.io/GrinCard/demo/profile.html?u=rahul123&t=temp_demo_expired) | The graceful fallback — no error page, just the public view |
| [Approved follower](https://clickalex.github.io/GrinCard/demo/profile.html?u=rahul123&viewer=user_priya) | Every link visible |
| [Card builder](https://clickalex.github.io/GrinCard/card-builder/) | Design a card in three steps, download the print files |
| [Dashboard](https://clickalex.github.io/GrinCard/dashboard/?u=rahul123) | Edit links, mint temporary links, approve followers |
| [Card preview](https://clickalex.github.io/GrinCard/demo/card-preview.html) | All three templates, both sides, with QR metadata |
| [Print sheet](https://clickalex.github.io/GrinCard/demo/print-sheet.html?u=rahul123) | True-to-size 89 × 51 mm, ready for the printer |
| [QR generator](https://clickalex.github.io/GrinCard/qr-generator/) | One code, or an A4 sheet of them for stickers and table tents |

Every one of those pages is in this repo and works offline once cloned.

---

## Quick start

```bash
git clone https://github.com/clickalex/GrinCard.git
cd GrinCard
python3 -m http.server 8080        # or: npx serve .
```

Open <http://localhost:8080/> — that is the whole installation. There is nothing to
install, compile or configure.

To publish it, see **[SETUP.md](SETUP.md)** (GitHub Pages, Netlify, custom domain, and how
to make `/c/username` work instead of `/demo/profile.html?u=username`).

To make it *yours*, either:

1. Open **[card-builder/](card-builder/index.html)**, fill in your details, download the
   card, then hit **Download profile JSON** and save it as
   `profile-data/yourname.json`; or
2. Copy `profile-data/demo-template.json` to `profile-data/yourname.json` and edit it in
   any text editor.

Both routes produce the same file. Commit it, push, and your card is live.

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

**Temporary links** — mint a link that unlocks one private item for ten minutes, an hour or
a day. When it expires, visitors fall back to the public view instead of hitting an error.

**Followers** — a request/approve flow for people who should see everything.

**A QR generator** — paste a list of URLs, get an A4 sheet of QR codes with labels. Useful
for stickers, table tents, event badges, or a wall of links in a shop.

**No paywalls in the core** — the tier limits (5 public links, 1 active temporary link) are
product limits defined in one place, `lib/access.js`, and a self-hoster can change them with
a one-line edit. Nothing is behind a licence check. See [PLANNING.md](PLANNING.md) for what
"paid" is meant to be: cosmetic templates and hosting, never the ability to share your own
links.

---

## How it is put together

```
index.html                     landing page (also a working QR retarget demo)
card-builder/                  3-step card designer
dashboard/                     owner console: links, tokens, followers, exports
qr-generator/                  standalone QR + A4 print sheets
demo/
  profile.html                 the public profile page — the thing a QR opens
  demo-profile.html            spec-named alias that redirects to profile.html
  card-preview.html            every template, both sides, live QR stats
  print-sheet.html             true-mm print sheet with optional bleed
  assets/                      profile.js, styles.css, print-sheet.js, …
profile-data/                  one JSON file per person + tokens.json
lib/
  qr.js                        QR encoder (global QRCode)
  card.js                      display list -> SVG (global Card)
  pdf.js                       display list -> vector PDF (global PdfCard)
  pdfdoc.js                    generic PDF writer for sheets (global SimplePdf)
  access.js                    tier rules, tokens, followers (global AccessRules)
  store.js                     JSON files + localStorage merge (global Store)
  export.js                    SVG/PNG/PDF downloads (global Exporter)
card-templates/                the template registry (global CardTemplates)
tests/                         node --test: encoder, card, rules, generator, DOM
docs/                          ARCHITECTURE, API, PRINTING, CUSTOMIZATION
```

The important decision is in `lib/card.js`: a card is built **once** into a display list of
millimetre-based drawing commands, and both the on-screen SVG preview and the print PDF are
rendered from that same list. Screen and paper cannot drift apart, because they are literally
the same instructions. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Documentation

| Document | Read it when… |
| --- | --- |
| [SETUP.md](SETUP.md) | you want this running on your own domain |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | you want to understand the tiers, the data flow, and what V1 does *not* protect |
| [docs/API.md](docs/API.md) | you are writing code against `lib/` |
| [docs/PRINTING.md](docs/PRINTING.md) | you are about to send a file to a printer |
| [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) | you want a new template, new colours, or different limits |
| [CONTRIBUTING.md](CONTRIBUTING.md) | you want to send a pull request |
| [PLANNING.md](PLANNING.md) | you want to know what is next and why |

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
first job of V2, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the endpoint
that will do it. The client code is written so that switching to it is a change of data
source, not a rewrite: `AccessRules.resolveAccess()` already takes a resolved access
decision and does not care who made it.

Until then: **do not put anything in a `followers_only` link that would hurt you if it were
public.** Use the private tier for a price list, not for a password.

---

## Tests

```bash
npm test          # 126 tests across five suites
npm run test:core # just the tier/token/follower rules — needs nothing installed
```

| Suite | Tests | What it proves |
| --- | --- | --- |
| `tests/access.test.js` | 25 | Tiers, tokens, followers, validation, limits |
| `tests/qr.test.js` | 13 | Our matrices are byte-identical to the reference encoder's |
| `tests/card.test.js` | 22 | Display list, SVG, PDF — and a QR decoded back out of the rendered PDF |
| `tests/generator.test.js` | 25 | Batch layout, quiet zones, sheets, the generic PDF writer |
| `tests/dom.test.js` | 41 | Every page, executed in jsdom with real scripts and real events |

`npm test` works on a fresh clone: the suites that compare our output against independent
implementations (`qrcode`, `jsQR`, `pdfjs-dist`, `@napi-rs/canvas`, `jsdom`) **skip with an
install hint** when those dev-only oracles are missing — you get 58 passing and 68 skipped, and
the 58 include every check that needs nothing but Node. Install them to get all 126; see
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
service. Attribution is appreciated and never required.
