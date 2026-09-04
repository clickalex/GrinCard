# Planning

What this project is trying to be, what was built, what comes next, and why the line between V1
and V2 is drawn where it is.

This document is the closest thing the repo has to a specification: the original design brief
lived in an issue thread, and other documents link here for the intent behind a decision.

---

## The product in one paragraph

A business card with a QR code on the back. The QR encodes a URL that never changes, because a
printed card cannot be updated. What that URL *shows* depends on who is looking: a stranger sees
your public links; someone you sent a time-limited link sees your public links plus one private
item; a follower you approved sees everything. The card is the permanent artefact, the content
behind it is live, and access is a property of the request rather than of the card.

**Design principles** (from the original brief, and the reason most decisions here look the way
they do):

1. **Privacy by default.** A visitor who does nothing sees the minimum. Private things are
   private until someone deliberately widens access, and widening always has a reason — a token,
   an approval.
2. **Free core.** The ability to share your own links is never a paid feature. Paid means
   cosmetics and convenience: extra templates, a custom domain, hosting, analytics.
3. **Physical equals digital.** The card and the page it opens must feel like the same object.
   One palette, one identity, in one place in the code.
4. **Print first.** 89 × 51 mm, 300 DPI, QR of at least 20 mm, 3 mm safe margins. If it does not
   survive a print shop, it does not work.
5. **Self-hostable and open.** MIT, static files, no vendor. If this project disappears tomorrow,
   every card already printed must keep working for whoever forked it.

---

## The three tiers

| | Public | Temporary | Permanent |
| --- | --- | --- | --- |
| URL | `/c/username` | `/c/username?t=temp_abc123` | `/c/username` + an approved session |
| Sees | `visibility: public` links | public **+ one** chosen private link | everything |
| Lifetime | forever | minutes to days, then downgrades | as long as the approval stands |
| Free limit | 5 public links | 1 active token | — |
| Printed on a card? | **yes** — this is the QR | **never** — it expires | yes, same QR as public |

The third row of the last line is the subtle part and the reason the design works: temporary and
permanent access share one URL. The card encodes `/c/username` and nothing else. A token is
something you *send*, not something you print, and an approval is something you *grant*. One
artefact, three outcomes, no reprinting.

Failure always downgrades rather than errors. An expired token shows the public view with a short
explanation. Nobody who scans your card should see a 404 because of a clock.

---

## V1 — what was actually built

The brief asked for a five-day MVP. What shipped is that MVP plus the parts that could not be
deferred without making the rest untestable.

| Day | Planned | Built | Notes |
| --- | --- | --- | --- |
| 1 | HTML profile page reading JSON from `/profile-data/` with visibility flags | `demo/profile.html` + `demo/assets/profile.js` + `lib/store.js` + `lib/access.js` | All four visitor scenarios, tier banner, 404 and fetch-error states, monogram fallback |
| 2 | Card builder with 2 CSS templates + `html2canvas` PNG download | `card-builder/` with **3** templates; PNG **and** vector PDF **and** SVG | `html2canvas` replaced — see [the deviation](#the-one-big-deviation) |
| 3 | `qrcode.js` QR on the card back | `lib/qr.js` — a from-scratch encoder | No CDN dependency; verified against the reference package and against jsQR |
| 4 | Temporary-link demo via `?t=` + a JSON token file + timestamp expiry | `lib/access.js` tokens + the dashboard's mint/revoke UI + `profile-data/tokens.json` | Includes use-count limits and the "expired" downgrade path |
| 5 | Docs (`README`, setup, example `rahul123.json`) + GitHub Pages from `/demo` | This set of seven documents, two example profiles, Pages from the **repo root** | Root publishing keeps `../lib/` reachable — see [SETUP.md](SETUP.md) |

### Beyond the five days

These were not in the plan and are here because each one removed a way to be wrong:

- **`dashboard/`** — the owner console: edit profile and links, pick a template and error-correction
  level, mint and revoke temporary links, approve or reject followers, simulate being a visitor,
  export everything. Without it, changing a demo meant hand-editing JSON, which meant the access
  rules were never exercised by a real workflow.
- **`demo/print-sheet.html`** — both sides at true millimetre size with an 89 mm calibration ruler
  and print CSS. This is how "print first" gets checked rather than claimed.
- **`demo/card-preview.html`** — every template × both sides × both demo profiles, plus a
  deliberate long-text stress row per template, plus a QR panel reporting version, module count,
  mm-per-module and quiet zone. Overflow bugs become visible before a print run.
- **`qr-generator/`** — one code, or a pasted list laid out on A4/Letter/A5/A6 as a multi-page
  vector PDF with labels. Listed in the original file structure and worth building because
  stickers, table tents and event badges are the same problem with different paper.
- **`lib/pdfdoc.js`** — the general-purpose PDF writer under the generator, so a sheet of A4 does
  not have to pretend to be a business card.
- **`tests/`** — 126 tests across five suites, including two end-to-end round trips that render
  our own PDF with `pdfjs-dist` and decode the pixels with `jsQR`.
- **`index.html`** — a landing page whose hero QR is clickable: type a URL and it re-encodes live,
  which demonstrates the core idea faster than any paragraph.

### The one big deviation

The brief specified `html2canvas` + PNG download. The build writes real vector PDFs instead, and
keeps PNG as an extra.

`html2canvas` rasterises your DOM at screen resolution. That means a card downloaded on a 1×
display prints soft, the QR modules get anti-aliased (which costs scan reliability — the one thing
a QR card must not do), the file is hundreds of KB instead of a few KB, the physical size is
whatever the CSS happened to be that day, and it adds a CDN dependency to a project whose
principle 5 is "works offline, forever".

So `lib/card.js` builds a **display list** — drawing commands in millimetres, y downwards — and
both `toSVG` (preview) and `lib/pdf.js` (print) render from that same list. One layout, two
outputs. The side effect is the real prize: "the preview is wrong" and "the PDF is wrong" become
the same bug with the same fix, instead of two programs that slowly drift apart until a print run
proves it.

Cost: about 700 lines of PDF writer, including JPEG/PNG embedding, gradients, circular clipping
and bleed. It is the most intricate code in the repo and it is the part with the most tests.

The other deviation is smaller: `qrcode.js` from a CDN became `lib/qr.js`, a from-scratch
Reed–Solomon encoder. Same reasoning, plus the fact that a CDN URL change would silently break
preview generation for every fork of this project. It is verified byte-for-byte against the
reference `qrcode` npm package across versions and error-correction levels, so "no dependencies"
does not mean "unverified".

### What V1 does not do

Stated plainly, because it is the most important caveat in the project:

> **V1 proves the user experience. It does not enforce privacy.**

The profile JSON is fetched by the visitor's browser and contains every link, including the
`followers_only` ones, because a static file cannot filter itself per-visitor. The tier logic then
decides what to *render*. A visitor who opens devtools can read what was not rendered.

That is acceptable for a price list or a portfolio draft. It is not acceptable for anything that
would hurt you if it were public, and the UI says so out loud — the profile page's scenario
switcher carries the line *"this is a demo, not real access control"*, linking to
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#8-the-v1-trust-model--read-this-before-trusting-a-private-link).

Three smaller gaps, all deliberate:

- **`max_uses` cannot be enforced.** The field exists in the token schema and `evaluateToken()`
  honours it, but a static file cannot increment a counter. It is there so V2 needs no schema
  migration.
- **Followers are simulated.** `?viewer=user_priya` stands in for a session, because there is no
  authentication to have a session with.
- **Bleed does not extend artwork.** With bleed on, the extra 3 mm is filled with the background
  colour, but an element that touches the trim edge stops at the edge rather than running past it.
  For the shipped templates (full-bleed flat/gradient backgrounds, centred content) the result is
  correct and indistinguishable. A template with a photo running off the edge would need its
  display list extended. Tracked below as V1.5.

---

## V1.5 — hardening the static build

Small, self-contained, no server. Roughly in priority order:

1. **Extend artwork into the bleed.** Add an optional `bleed` hint to display-list items so a
   background or photo can run past the trim box, and have `toSVG` and `pdf.js` both honour it.
   Removes the last "your card might have a white hairline" caveat.
2. **Photo pipeline improvements.** WebP/AVIF input, EXIF orientation (a phone portrait currently
   comes out sideways in some browsers), and a crop control in the builder — the round mask hides
   exactly the part of a face you wanted to keep.
3. **A template editor.** The three shipped templates are data in a registry; let someone edit a
   copy in the browser and export it as JSON, the way profiles already work. Cosmetic-tier work,
   and the natural first paid feature.
4. **i18n.** All UI strings are inline English. Extract them, ship `en` and `hi`, and let a profile
   declare a language — the card renderer already measures text, so it can handle a longer German
   word without a redesign.
5. **CJK/Devanagari in the PDF.** The standard 14 fonts are WinAnsi-only, so a name in Chinese or
   Hindi currently gets substituted with a warning. Real support means embedding a subsetted
   TrueType font — a meaningful chunk of work in `lib/pdf.js`, and the difference between "works
   for most of the world" and "works for the world".
6. **A11y pass with real assistive tech.** The pages have landmarks, labels, `aria-live` on
   previews and keyboard-reachable controls, and `dom.test.js` asserts the structural parts. What
   is missing is someone actually using a screen reader through the builder flow and telling us
   what is wrong.
7. **`/c/username` shipped as generated files.** A tiny script that reads `profile-data/*.json`
   and writes `c/<username>/index.html` redirect stubs, so GitHub Pages users get short URLs
   without hand-maintaining one file per person.

---

## V2 — a backend, so private means private

The single goal: **the private URL never reaches a device that may not see it.**

### The endpoint

```
GET /api/profile/:username
    ?t=<token>            optional
    Cookie: session       optional

200 → { username, display_name, designation, tagline, photo_url, theme,
        links: [ …only the ones this requester may see… ],
        tier: "public" | "temporary" | "follower",
        hidden_count: 2,
        notices: [ … ] }

404 → no such profile
```

The server runs the **same** `resolveAccess()` that the browser runs today, then serialises the
filtered result. That is the whole trick, and it is why `lib/access.js` has no DOM dependencies:
it lifts into a Node handler, a Cloudflare Worker or a Deno Deploy function unchanged.

The client change is one line:

```js
// V1
Store.loadProfile(username).then(render)
// V2
fetch('/api/profile/' + username + qs).then(r => r.json()).then(render)
```

`Store` already returns a promise of a profile object and already knows how to merge a local
override, so V2 is a change of data source, not a rewrite. The pages do not change at all.

### Storage

Two tables and a profile store. Deliberately boring:

```sql
profiles(username TEXT PRIMARY KEY, data JSONB, updated_at TIMESTAMPTZ)

tokens(id TEXT PRIMARY KEY, profile_username TEXT REFERENCES profiles,
       target_link_id TEXT NOT NULL,
       created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NULL,
       max_uses INT NOT NULL DEFAULT 1, current_uses INT NOT NULL DEFAULT 0,
       revoked_at TIMESTAMPTZ NULL)

followers(id TEXT PRIMARY KEY, profile_username TEXT REFERENCES profiles,
          follower_id TEXT NOT NULL, email TEXT, name TEXT,
          status TEXT NOT NULL DEFAULT 'pending',   -- pending|approved|rejected|removed
          requested_at TIMESTAMPTZ, approved_at TIMESTAMPTZ NULL,
          UNIQUE (profile_username, follower_id))
```

The schema is the JSON files, normalised. `profile-data/tokens.json` maps onto `tokens` and
`followers` one-for-one, so migrating a V1 self-hoster is a script, not a project.

Index on `(profile_username, status)` for followers and `(profile_username, expires_at)` for
tokens — those are the only two queries that matter.

### Counting uses

`max_uses` finally works, and it needs to be atomic:

```sql
UPDATE tokens SET current_uses = current_uses + 1
 WHERE id = $1 AND revoked_at IS NULL
   AND (expires_at IS NULL OR expires_at > now())
   AND (max_uses = 0 OR current_uses < max_uses)
RETURNING target_link_id;
```

Zero rows means the token is no good, and the *reason* needs a second read to distinguish
expired from exhausted — which matters, because the two produce different messages. Note that
counting a use means a link opened twice by one person (a browser prefetch, a link preview bot)
burns their access. Either exclude obvious bots or default `max_uses` to 0 (unlimited) and treat
counting as an opt-in extra.

### Auth

- Owners: email + password with a verified address, or an OAuth provider. Sessions in an
  `HttpOnly; Secure; SameSite=Lax` cookie. Nothing in `localStorage` — that is what V1 does, and
  V1 is a demo.
- Followers: they need an identity for an approval to mean anything. The lightest version that
  works is a magic-link email: "Priya wants to see your private links. Approve?" and on approval,
  Priya gets a session that resolves to `follower` tier for that profile.
- `/auth/login`, `/dashboard/:username` as specified in the brief.

### Rate limiting and abuse

Required the moment token checking is server-side, because a token in a URL is guessable space and
an endpoint is enumerable:

- Per-IP limits on `/api/profile/*` and on token evaluation.
- **Do not** distinguish "no such profile" from "no such token" in a way that lets someone
  enumerate users. V1's client already fails silently on `not_found` / `wrong_profile` /
  `malformed`; keep that behaviour server-side, where it actually means something.
- Cache public profiles aggressively (they change rarely, and a card that gets shared on social
  media produces a burst).

### Analytics

Optional, off by default, no third-party script: scans per card, per token, per day. The
interesting number is not total scans, it is *temporary-link conversions* — how often a token
recipient came back and asked to be a follower. That is the metric that tells someone whether the
three-tier idea works for them.

---

## V3 — reach

Ordered by how much they help a real person versus how much work they are:

1. **Hosted service.** The obvious one. Free tier as specified (5 public links, 1 active token),
   paid tier for cosmetics and a custom domain. The self-hostable repo stays free forever — that
   is principle 5, and it is also what makes the hosted version trustworthy.
2. **Editor at a URL.** `new.example.com` that produces a profile JSON and a card PDF without
   cloning anything. Most people who want a card do not want a repository.
3. **Link-in-bio parity.** Reordering by drag-and-drop, scheduled links, a "featured" link, and
   per-link icons. All cosmetic, all in the profile schema, none of it needs a backend.
4. **Wallet passes.** Apple Wallet / Google Wallet renders of the same card. A QR card that is
   also in your phone's wallet is strictly more useful, and the data already exists.
5. **NFC.** The same URL behind an NFC tag in a plastic card. The URL is the interface, which is
   exactly why the design centred on one: the card, the NFC tag and the wallet pass are three
   delivery mechanisms for one identity.
6. **Multi-profile.** One person, several identities (work, side project, anonymous). The username
   is already the key everywhere, so this is mostly a dashboard concern.
7. **Print-shop integrations.** Send the bleed PDF straight to a fulfilment API and get cards in
   the post. This is where a hosted service earns its keep, and it is the natural paid feature:
   convenience, not capability.

---

## Monetisation

The rule, restated because everything else follows from it:

> **Paid features are cosmetic or convenient. Never capability.**

| Free, forever | Paid |
| --- | --- |
| Unlimited profiles, self-hosted | Hosted profiles with a custom domain |
| 5 public links per profile (hosted) | More public links |
| 1 active temporary link (hosted) | More concurrent tokens, longer durations |
| All three templates | Additional template packs, a template editor |
| Full print output: PDF, SVG, PNG, sheets | Print fulfilment — cards in the post |
| The entire source, MIT | Analytics, priority support |
| Follower approvals | Team accounts, multiple owners |

What is never paid: the ability to share your own links, the ability to see who you have
approved, the ability to export your own data, or the ability to run the software yourself. A
product that charges someone to share their own phone number is not a product worth defending.

The self-hosted version has no limits at all, because `LIMITS` is one object in `lib/access.js`
and anyone can edit it. That is not an oversight or a leak in the business model — it is the
point. The hosted service sells not having to run it.

---

## Open questions

Things this project does not yet have an answer to, recorded so they are decisions rather than
surprises:

1. **What is a follower, really?** An email address? An account? A device? The demo uses a string
   id, which is enough to prove the flow and not enough to be secure. The answer determines how
   heavy V2's auth is.
2. **Should token use-counting exist at all?** It is in the schema, and it is the feature most
   likely to annoy a legitimate recipient (a link preview bot burns their access). Maybe the
   honest answer is expiry-only, with use counting as a power-user toggle.
3. **Does `/c/username` need to be a redirect?** A redirect costs one round trip on a mobile
   network at the exact moment someone is standing in front of you waiting for your card to work.
   A rewrite (Netlify, Nginx) is better; a redirect stub (GitHub Pages) is what is available
   everywhere. Worth measuring before optimising.
4. **Photo storage.** Data URLs in the profile JSON are self-contained and slow: a 600 px JPEG is
   ~60 KB inline, fetched with the profile on every visit. V2 should serve the photo from a URL
   with a cache header, and keep the data URL as the self-hosting fallback.
5. **How much should the card explain itself?** The back currently prints *"Scan for public links
   · Ask for private access"*, which teaches the model in six words and takes 4 mm. Some people
   will find that cluttered. It is a template field, so it can be turned off — but the default
   matters more than the option.
6. **What happens to a printed card when the owner stops paying?** The URL must keep resolving to
   *something* honest. A tombstone ("this card's owner moved on") is better than a 404, and a
   self-hosted fork is better than both. Principle 5 says the answer has to be "the card keeps
   working", which is an argument for the export-everything button being prominent forever.

---

## Contributing to the plan

If you want to build something from this list, open an issue first for anything in V2 or V3 —
those have design consequences that are cheaper to argue about in text than in code. V1.5 items
are self-contained; pick one up and send a PR. See [CONTRIBUTING.md](CONTRIBUTING.md).
