# Setup

Three ways to run this, from "thirty seconds" to "my own domain with clean `/c/username`
URLs". Pick the one you need; they all use the same files.

---

## 1. On your own computer (30 seconds)

You need nothing but a static file server. Any of these work:

```bash
cd GrinCard
python3 -m http.server 8080        # Python 3
npx serve .                        # Node
php -S localhost:8080              # PHP
```

Then open <http://localhost:8080/>.

> **Do not open `index.html` by double-clicking it.** The `file://` protocol blocks
> `fetch()` between files in most browsers, so the pages would load but show no data. A
> local server takes one command and removes the whole class of problem.

---

## 2. On GitHub Pages (5 minutes)

This is the intended deployment. It is free, it gives you HTTPS, and the URLs it produces
work with the QR codes you print.

### Option A — publish from the repository root

1. Fork or clone this repository, then push it to **your** GitHub account.
2. In your repository: **Settings → Pages**.
3. Under **Build and deployment**, set *Source* to **Deploy from a branch**.
4. Set *Branch* to `main` and the folder to `/ (root)`. Save.
5. Wait about a minute. Your site is at
   `https://<your-username>.github.io/<repo-name>/`.

Publishing from the root matters: `index.html`, `profile-data/`, `lib/` and the rest all
reference each other with **relative** paths, so the site works at any depth — a user page,
a project page, or a custom domain — with no configuration.

### Option B — publish from `/demo` (the original spec's suggestion)

The spec for this project suggested publishing `/demo` as the site root. That works too, but
then the demo pages lose access to `../lib/` and `../profile-data/`, because GitHub Pages
will only serve what is inside the published folder. If you want Option B, copy `lib/`,
`card-templates/` and `profile-data/` into `demo/` first and adjust the relative paths.

**Option A is simpler and is what the rest of this document assumes.**

### Turning the demo data into your data

1. Open `https://<you>.github.io/<repo>/card-builder/`.
2. Fill in your name, role, links and photo, pick a template.
3. Download the card files you want (PDF for the printer, PNG for chat apps).
4. Click **Download profile JSON**. You get `yourname.json`.
5. Put that file in `profile-data/` in your repository, commit and push.
6. Your card's QR should point at
   `https://<you>.github.io/<repo>/demo/profile.html?u=yourname`.

The card builder fills that URL in for you automatically — the value in the **Profile URL**
field on step 3 is exactly what your printed QR should encode. Check it before you print.

---

## 3. Clean `/c/username` URLs (recommended for real cards)

`/demo/profile.html?u=rahul123` works, but `/c/rahul123` is shorter, easier to say out loud,
and survives a redesign of this repository. Both are the same page; the short form is just a
rewrite.

### GitHub Pages

GitHub Pages cannot rewrite URLs, so use a redirect file per username. Create
`c/rahul123/index.html`:

```html
<!DOCTYPE html>
<meta charset="utf-8">
<title>Rahul Kumar — QR Link Card</title>
<link rel="canonical" href="https://you.github.io/GrinCard/demo/profile.html?u=rahul123">
<meta http-equiv="refresh" content="0; url=../../demo/profile.html?u=rahul123">
<script>location.replace('../../demo/profile.html?u=rahul123' + location.search);</script>
<p>Loading <a href="../../demo/profile.html?u=rahul123">rahul123</a>…</p>
```

`location.replace` is used rather than `location.href` so the redirect does not pollute the
visitor's back button. The `<meta http-equiv="refresh">` covers the (rare) no-JavaScript case.

Then set `profile_url` in `profile-data/rahul123.json` to
`https://you.github.io/GrinCard/c/rahul123/` so the dashboard and builder generate QR codes
for the short URL.

### Netlify

Add a `_redirects` file at the site root:

```
/c/:username   /demo/profile.html?u=:username   200
/dashboard/:username  /dashboard/index.html?u=:username  200
```

The `200` makes it a rewrite rather than a redirect, so the visitor keeps seeing
`/c/rahul123` in the address bar.

### Nginx

```nginx
location ~ ^/c/([a-z0-9_.-]+)/?$ {
    rewrite ^ /demo/profile.html?u=$1 last;
}
```

### Apache (`.htaccess`)

```apache
RewriteEngine On
RewriteRule ^c/([A-Za-z0-9_.-]+)/?$ demo/profile.html?u=$1 [L,QSA]
```

---

## Adding more people

One JSON file per person in `profile-data/`. The filename must match the `username` field
inside it — that is how the page finds you.

```bash
cp profile-data/demo-template.json profile-data/priya.json
$EDITOR profile-data/priya.json
```

The dashboard does this in the browser instead (it writes to `localStorage` and lets you
export the JSON), which is useful for trying things out, but for a published site the file in
the repository is what visitors actually see. See
[docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for every field, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-v1-trust-model) for what `localStorage` is
and is not for.

---

## Custom domain and HTTPS

Point a `CNAME` at `<you>.github.io` and enable **Enforce HTTPS** in the Pages settings. Then:

1. Update `profile_url` in each profile JSON to the new domain.
2. Re-download and **re-print** the cards, or accept that existing cards still point at the
   old URL (which keeps working, so there is no rush).

This is the one thing about a printed QR code that you cannot undo later, so get the domain
right before the first print run. The URL on a card is permanent by design — that is the whole
point of the product.

---

## Verifying a deployment

Run through this list once after deploying. It takes two minutes and catches everything that
goes wrong in practice.

1. `https://<you>.github.io/<repo>/` loads the landing page **and** the showcase cards at the
   bottom render. If they do not, `profile-data/*.json` is not being served — check that the
   files are on the branch you published.
2. `demo/profile.html?u=<yourname>` shows your links and your photo.
3. `demo/profile.html?u=<yourname>&t=<a token you minted>` shows the extra private link.
4. `demo/print-sheet.html?u=<yourname>` → print a page → hold a ruler against the card frame.
   It should measure 89 × 51 mm. If it does not, your browser applied a scaling factor;
   set it to 100% / "Actual size". See [docs/PRINTING.md](docs/PRINTING.md).
5. Scan the printed card with a phone camera. It should open your profile, not a search
   engine. If it opens a search engine, the `profile_url` field was empty or relative when
   you generated the QR.
6. Open the profile in a **private browsing window** with no query parameters. You should see
   only your public links. This is the check that matters most, and it is the one people skip.

---

## Running the tests

Optional, but worth doing if you changed anything in `lib/`:

```bash
npm test
```

On a fresh clone this passes 58 tests and skips 68 — the skipped ones compare our output against
independent implementations (`qrcode`, `jsQR`, `pdfjs-dist`, `@napi-rs/canvas`, `jsdom`) which are
**not** dependencies of the project and are not needed to run the site. Install them to run all
126; [CONTRIBUTING.md](CONTRIBUTING.md#the-dev-only-oracles) has the commands.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pages load but show "Profile not found" | `profile-data/<username>.json` is missing, or the filename does not match the `username` field | Check the spelling; the lookup is case-sensitive |
| Everything loads locally but not on GitHub Pages | You opened the files over `file://` locally and pushed a path that only worked there | All internal links must be relative (`../lib/qr.js`), never absolute (`/lib/qr.js`) |
| Photos show on screen but vanish from the downloaded PDF | The photo is on another origin and the browser blocked reading its pixels | Host the photo in the repo, or paste a data URL / upload it in the dashboard |
| The QR scans but opens the wrong site | `profile_url` still points at the demo domain | Set `profile_url` in your JSON, then regenerate and re-download the card |
| Printing comes out 90% or 110% size | The print dialog's "Fit to page" / "Shrink to printable area" | Choose **100%** / **Actual size** and disable fit-to-page |
| A temporary link stopped working | It expired, or its use count ran out | That is correct behaviour — mint a new one in the dashboard |
| `node --test tests/` fails with `MODULE_NOT_FOUND` | The directory form resolves differently in some Node versions | Pass the test files explicitly |
