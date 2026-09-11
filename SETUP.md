# Setup

Deploying your own copy takes about five minutes and needs nothing but a GitHub account.
There is no server to run, no database to provision, no dependency to install and no build
toolchain — the site is plain HTML, CSS and JavaScript, and the only "build" is a script that
writes the small files your printed URLs need.

0. **[The short version — entirely in your browser](#the-short-version--entirely-in-your-browser)**
1. [On your own computer](#1-on-your-own-computer-30-seconds)
2. [Make it yours](#2-make-it-yours)
3. [On GitHub Pages](#3-on-github-pages)
4. [How `/c/username/` works](#4-how-cusername-works)
5. [Other hosts](#5-other-hosts)
6. [Adding more people](#adding-more-people)
7. [Custom domain](#custom-domain-and-https)
8. [Verifying a deployment](#verifying-a-deployment)
9. [Troubleshooting](#troubleshooting)

---

## The short version — entirely in your browser

No terminal, no Node.js, nothing to install. Every step happens on github.com, and the only
files you ever touch are JSON. If you would rather work locally, skip to [§1](#1-on-your-own-computer-30-seconds).

**1. Create your own repository.**
On the [QR Link Card page](https://github.com/clickalex/GrinCard), click **Fork**. The dialog
lets you rename it — `my-card` is fine — and you can leave *Copy the default branch only*
ticked. Keep it **Public**: GitHub Pages needs a public repository on the free plan.

(If the repository is marked as a template, **Use this template → Create a new repository**
does the same thing and gives you a clean history with no "forked from" banner. Everything
below is identical either way.)

**2. Turn the starter profile into yours.**
In your new repository, open `profile-data/yourname.json` and click the **pencil** icon.
In the filename box at the top, change `yourname.json` to `<your-username>.json` — that name
becomes your printed URL. In the file itself:

- `"username"` — must match the new filename exactly.
- `display_name`, `designation`, `tagline` — the front of the card.
- `links[]` — each with `label`, `url` and `"visibility"`, which is `"public"` or
  `"followers_only"`. Public links show to anyone who scans the card; `followers_only` ones
  appear only for a temporary token or an approved follower.
- `card_settings.template_id` — the look of the card; see [templates/](templates/).
- Delete `"_starter": true` when you are done.

Click **Commit changes**.

**3. Put your card on your home page.**
Open `profile-data/index.json`, click the pencil, and replace `"yourname"` in the `profiles`
list with your username. One line. Commit.

A static site cannot list a directory, so this file is how your home page knows which cards
exist. If you skip this step nothing breaks — your link still works — the card just is not
listed on the home page. (Step 4's Actions route does this for you on every push.)

**4. Turn on GitHub Pages.**
**Settings → Pages → Build and deployment → Source**, then pick either:

- **Deploy from a branch** — choose branch `main`, folder `/ (root)`, **Save**. Nothing else to
  do; your site is live within a minute or two.
- **GitHub Actions** — first create the workflow: **Add file → Create new file**, name it
  `.github/workflows/pages-deploy.yml`, paste in the contents of
  [`tools/github-workflows/pages-deploy.yml`](tools/github-workflows/pages-deploy.yml), commit, then select
  **GitHub Actions** as the source. This pre-renders every `/c/<username>/` page and refreshes
  the cards list on each push, so you never touch `index.json` again.

The difference is worth knowing: with *Deploy from a branch* your `/c/<username>/` link is
served by the site's own fallback page. It renders perfectly — but the HTTP status is `404`,
so some chat apps will not build a rich link preview for it. The Actions route serves it as a
normal `200` page.

**5. Copy your link and print the card.**
Your site is at `https://<your-username>.github.io/<repo-name>/`, and your card is at
`https://<your-username>.github.io/<repo-name>/c/<your-username>/`.

You never type that URL: the home page derives it from wherever the site is actually being
served and shows it with a **Copy link** button and a QR code. Open **Print** for a
press-ready sheet. See [docs/PRINTING.md](docs/PRINTING.md) for the card specification.

**Prefer forms to JSON?** Open [`dashboard/`](dashboard/) on your deployed site: it has a
visual template picker, edits your links with a form, previews the card live, and its
**Copy** button gives you the finished JSON to paste back into
`profile-data/<your-username>.json` on GitHub. The dashboard's **Your shareable link** panel
shows the demo account's public URL immediately. Copy this repository, edit that JSON (rename
the file to you), enable Pages — the same `/c/<you>/` link then works on your copy.

That is the whole thing. Day-to-day, you edit one JSON file and commit.

---

## 1. On your own computer (30 seconds)

*Following the browser route above? You do not need this section.*

```bash
git clone https://github.com/YOU/GrinCard.git
cd GrinCard
npm run build          # writes your profile links (needs Node, nothing else)
npm start              # python3 -m http.server 8080
```

Open <http://localhost:8080/>. That is the whole installation.

`npm run build` and `npm start` are conveniences, not requirements. You can serve the folder
with anything (`npx serve .`, `php -S localhost:8080`, your editor's live server) and the site
works; the build only generates the files described in
[§4](#4-how-cusername-works), and `404.html` covers them if you never run it.

Do **not** open `index.html` by double-clicking it. Pages fetch JSON, and browsers block that
over `file://`. Serve it over http, even locally.

---

## 2. Make it yours

The fork ships with one starter profile so nothing is blank. Turn it into yours:

```bash
mv profile-data/yourname.json profile-data/rahul.json
```

Then edit `profile-data/rahul.json`:

- `"username"` **must match the new filename** — the URL is derived from it, and
  `tools/build-links.js` refuses to generate a mismatch.
- `display_name`, `designation`, `tagline` — the front of the card.
- `links[]` — each with `label`, `url` and `"visibility"`, which is either `"public"` or
  **`"followers_only"`**. Public links show to anyone; `followers_only` ones appear only for a
  valid temporary token or an owner-approved follower.

  The spelling matters and there is no third option. Any other word — `"private"`,
  `"followers-only"`, `"hidden"` — is treated as `followers_only` and stays hidden, because
  guessing wrong in the permissive direction would publish something you meant to hide on a card
  you cannot recall. `npm run validate` warns about it.
- `card_settings.template_id` — see [templates/](templates/) for what is available.
- Delete `"_starter": true` when you are done. It is only how the site knows to show you setup
  help instead of treating the profile as finished.

Regenerate and look:

```bash
npm run build
npm start
```

`http://localhost:8080/` now lists your card with its permanent URL, a copy button and a QR
code. **You never type that URL** — it is derived from where the site is being served, so it is
already correct for your fork, and it stays correct if you move to a custom domain.

Prefer a form? Open [`dashboard/`](dashboard/) or [`card-builder/`](card-builder/): they edit
the same data, preview live, and export the JSON file to commit.

---

## 3. On GitHub Pages

### Recommended — deploy with the included workflow

Two workflows ship with this repository: `pages-deploy.yml` regenerates your links on every push and
publishes the result, and `ci.yml` validates profiles, templates and internal links.

**They are not in `.github/workflows/` when you clone.** GitHub refuses to let an app token
without the `workflows` permission create files there, so the canonical copies live in
`tools/github-workflows/` and you install them once. On your own fork you have the permission:

```bash
npm run workflows:install
git add -f .github/workflows
git commit -m "Enable CI and Pages workflows"
git push
```

Then:

1. **Settings → Pages → Build and deployment → Source → GitHub Actions.**
   (The workflow tries to enable this for you on the first run, but the setting is yours to
   confirm.)
2. Push to `main`. Watch the **Deploy to GitHub Pages** run.
3. Your site is at `https://<you>.github.io/<repo>/`, and your card is at
   `https://<you>.github.io/<repo>/c/<username>/`.

See [tools/github-workflows/README.md](tools/github-workflows/README.md) for what each step
checks, and why the workflows live where they do.

The workflow runs `npm run build` before uploading, so the `/c/<username>/` stubs exist even
though they are gitignored, and development-only files (`tests/`, `tools/`) are removed from
what gets published.

### Zero-configuration — deploy from a branch

If you would rather not use Actions:

1. **Settings → Pages → Source → Deploy from a branch.**
2. *Branch* `main`, folder `/ (root)`. Save.
3. Wait a minute.

This works because `c/index.html` and `404.html` are committed. A visitor who follows
`/c/<username>/` gets `404.html`, which boots the same profile renderer in place — the URL stays
in the address bar, there is no redirect and no error page. The only difference from the
workflow path is that the per-username stubs are generated on demand by the fallback instead of
ahead of time.

Publishing from the repository root matters: every page references its neighbours with
**relative** paths, so the site works at any depth — a user page, a project page, or a custom
domain — with no configuration.

---

## 4. How `/c/username/` works

A QR code has to encode a URL that never changes, and a static host can only serve a URL that
is a real file. So `tools/build-links.js` turns your JSON into both:

```bash
npm run build
```

| Generated | Purpose |
| --- | --- |
| `profile-data/index.json` | The manifest the site root reads. A static site cannot list a directory, so this *is* the listing. **Committed.** |
| `c/index.html` | A directory page of every card. **Committed.** |
| `c/<username>/index.html` | A ~14-line stub per person that runs the shared renderer. **Gitignored** — derived, and a renamed profile should not leave a stale URL behind. |
| `card-templates/community/index.json` | The list of contributed templates. **Committed.** |

Each stub sets `data-username` and loads `profile/profile.js` + `profile/boot.js`, which work
out the climb back to the site root from the URL they were served from. There is one renderer
and no per-user code.

`404.html` is the net underneath all of it: for any path, it probes for the site root and boots
the same renderer, so `/c/<username>/` works before you have run anything, on hosts without
Actions, and for a profile you added but forgot to build.

**Add a profile and forget the build?** Your `/c/<username>/` link still works (via
`404.html`); only the index listing lags. `npm run validate` fails on a stale manifest, so you
find out before your visitors do.

---

## 5. Other hosts

Anything that serves static files works. If your host can rewrite URLs, use that instead of
generated stubs — it is one rule rather than one file per person, and there is nothing to
regenerate.

### Netlify

`netlify.toml`:

```toml
[[redirects]]
  from = "/c/:username"
  to   = "/profile/?u=:username"
  status = 200        # a rewrite, not a redirect: the URL stays in the address bar
```

Or a `_redirects` file:

```
/c/:username   /profile/?u=:username   200
```

### Nginx

```nginx
location ~ ^/c/([a-z0-9_.-]+)/?$ {
    rewrite ^ /profile/?u=$1 last;
}
```

### Apache (`.htaccess`)

```apache
RewriteEngine On
RewriteRule ^c/([A-Za-z0-9_.-]+)/?$ profile/?u=$1 [L,QSA]
```

### S3 / CloudFront, Firebase Hosting, Caddy, anything else

Either enable the equivalent rewrite, or just run `npm run build` and upload the generated
files. CloudFront additionally needs a custom 404 response pointing at `/404.html` with status
200 if you want the fallback path.

---

## Adding more people

One JSON file per person in `profile-data/`. The filename must match the `username` field
inside it — that is how the page finds you.

```bash
cp profile-data/rahul.json profile-data/priya.json
$EDITOR profile-data/priya.json
npm run build
```

Each person gets their own permanent URL, their own card and their own tokens. Nothing else
changes; the index page picks them up from the manifest.

The dashboard does this in the browser instead (it writes to `localStorage` and lets you export
the JSON), which is useful for trying things out, but for a published site the file in the
repository is what visitors actually see. See
[docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for every field, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-v1-trust-model) for what `localStorage` is and
is not for.

---

## Custom domain and HTTPS

Point a `CNAME` at `<you>.github.io` and enable **Enforce HTTPS** in the Pages settings.

Then do nothing else. Because every URL in this project is derived from where the site is being
served, your cards' URLs become `https://cards.example.com/c/<username>/` automatically the next
time you regenerate and print.

Two caveats, both about paper rather than software:

1. **Cards you already printed keep the old URL.** It keeps working (GitHub Pages still serves
   the `github.io` host), so there is no emergency — but decide your domain before the first
   print run, because a printed QR code is the one thing you cannot update later.
2. If you want the *old* URL to be what is printed forever, set an absolute
   `"profile_url"` in that profile's JSON. An explicit absolute URL always wins over the derived
   one; the dashboard exposes this under *Use a custom domain instead*.

---

## Verifying a deployment

Two minutes, and it catches everything that goes wrong in practice.

1. `https://<you>.github.io/<repo>/` lists your cards, each with a URL and a QR. If it says
   "No profiles yet", `profile-data/index.json` is missing or stale — run `npm run build`.
2. `c/<username>/` shows your links and your photo, and the address bar still says
   `c/<username>/`. (If you see a flash of "Looking up that link…", you are on the `404.html`
   path — that is fine, but the Actions deploy is faster.)
3. `profile/?u=<username>&t=<a token you minted>` shows the extra private link.
4. `print/?u=<username>` → print a page → hold a ruler against the card frame. It should measure
   89 × 51 mm. If it does not, your browser applied a scaling factor; set it to 100% /
   "Actual size". See [docs/PRINTING.md](docs/PRINTING.md).
5. Scan the printed card with a phone camera. It should open your profile, not a search engine.
   If it opens a search engine, the QR was generated from an empty or relative URL — regenerate
   from the dashboard or builder, where the URL is derived for you.
6. Open your profile in a **private browsing window** with no query parameters. You should see
   only your public links. This is the check that matters most, and the one people skip.
7. `npm run validate && node tools/check-links.js` — generated files are current and no page
   links to something that moved.

---

## Running the tests

Optional, but worth doing if you changed anything in `lib/`:

```bash
npm test
```

On a fresh clone this passes the tests that need nothing but Node and **skips** the ones that
compare our output against independent implementations (`qrcode`, `jsQR`, `pdfjs-dist`,
`@napi-rs/canvas`, `jsdom`). Those are dev-only oracles, not project dependencies. Install them
to run everything; [CONTRIBUTING.md](CONTRIBUTING.md#the-dev-only-oracles) has the commands.

Once you have installed the workflows (see [§3](#3-on-github-pages)), `ci.yml` runs the full set
on every push. Until then, `npm run validate && node tools/check-links.js && npm test` is exactly
what it would have run.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "No profiles yet" on the site root | `profile-data/index.json` missing or stale | `npm run build`, commit the manifest |
| `/c/<username>/` works locally but not on Pages | Branch deploy without the generated stubs | Enable the Actions workflow, or rely on `404.html` (check it is at the repo root) |
| "No profile here" on a page that should work | The filename does not match the `username` field | They must be identical; the lookup is case-sensitive |
| Your card's URL points at someone else's site | A `"profile_url"` copied from an example profile | Delete the field and let it derive, or set your own absolute URL |
| Everything loads locally but not on GitHub Pages | You tested over `file://` and pushed a path that only worked there | All internal links must be relative (`../lib/qr.js`), never absolute (`/lib/qr.js`) |
| A contributed template does not appear | Not listed in `card-templates/community/index.json` | `npm run build:templates` — see [docs/TEMPLATES.md](docs/TEMPLATES.md) |
| Photos show on screen but vanish from the downloaded PDF | The photo is on another origin and the browser blocked reading its pixels | Host the photo in the repo, or paste a data URL / upload it in the dashboard |
| The QR scans but opens the wrong site | The QR was generated from a stale or hand-typed URL | Regenerate from the builder/dashboard, where the URL is derived |
| Printing comes out 90% or 110% size | The print dialog's "Fit to page" | Choose **100%** / **Actual size** |
| A temporary link stopped working | It expired, or its use count ran out | Correct behaviour — mint a new one in the dashboard |
| `node --test tests/` fails with `MODULE_NOT_FOUND` | The directory form resolves differently in some Node versions | Pass the test files explicitly (`npm test` does) |
