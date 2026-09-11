# GitHub Actions workflows

The canonical copies of this project's two workflows live here, and are installed into
`.github/workflows/` by a script — because that is the only way they could be committed at all.

```bash
node tools/install-workflows.js          # copy them into .github/workflows/
node tools/install-workflows.js --check  # CI: are they installed and in sync?
node tools/install-workflows.js --force  # overwrite whatever is there
```

Or `npm run workflows:install`. `ci.yml` runs the `--check` form on every push, so editing a
canonical copy and forgetting to re-install it fails CI rather than quietly running the old one.

## Why these exact file names

`--check` compares the two directories **by filename**, so a canonical copy only counts as
installed when it lands under the same name. `pages-deploy.yml` matches the name already installed
upstream; the shorter `pages.yml` this folder used to carry was never installed, and cannot be by
the token that maintains this repository (see the rejection below). If someone with the `workflows`
permission prefers `pages.yml`, rename it under `.github/workflows/` and rename the copy here in
the same commit. Nothing else depends on the name: Pages uses `build_type: workflow`, which picks
the workflow holding the `deploy-pages` job rather than a path.

## Why not just commit them to `.github/workflows/`

GitHub runs workflows only from `.github/workflows/`. But a GitHub App installation token cannot
create or update a file there without the `workflows` permission, and the token used to build this
repository does not have it. The push was rejected outright:

```
! [remote rejected] arena/01a06acb-grincard -> arena/01a06acb-grincard
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/ci.yml` without `workflows` permission)
```

Everything else in the repository pushed fine. Rather than ship the project with no CI at all —
which would mean community templates are never validated and Pages deploys are manual — the
workflows are committed to a path a token is allowed to write, and installing them is one command.

**If you have the `workflows` permission** (you probably do, on your own fork), move them into
place and commit:

```bash
node tools/install-workflows.js --force
git add .github/workflows && git commit -m "Enable CI and Pages workflows"
```

After that this folder is redundant and can be deleted. It exists to get the workflows into
`.github/workflows/`, not to be their permanent home.

## What the two workflows do

**`ci.yml`** — on every push and pull request:

| Step | Command | Catches |
| --- | --- | --- |
| Generated files are current | `npm run validate` | a profile renamed without rebuilding, so `/c/<old>/` still exists |
| No dead links | `node tools/check-links.js` | a page or document pointing at a file that moved |
| Tests | `npm test` | everything else; skips the round-trip suites when the dev-only oracles are absent, and never fails for that |
| Workflows installed | `node tools/install-workflows.js --check` | the drift this folder could otherwise develop |
| Clean tree | `git diff --exit-code` | a build step that is not idempotent |

**`pages-deploy.yml`** — on a push to the default branch: runs the build so manifests and `/c/<username>/`
stubs are regenerated from whatever is in `profile-data/`, strips the dev-only directories
(`tests`, `tools`, `.github`, `node_modules`, `package.json`, …) so they are not published, then
deploys to GitHub Pages.

## Two rules these workflows enforce that matter for a fork

- **`npm run validate` is not optional.** The permanent URL a card prints is generated from the
  profile filename. If someone renames `profile-data/riley.json` and forgets to rebuild, the old
  `/c/riley/` stub is still on disk and the new URL does not exist — and a printed card cannot be
  updated. The build removes stubs for profiles that no longer exist.
- **A contributed template is validated before it can merge.** `tools/build-templates.js --check`
  runs the same rules as `CardTemplates.validateTemplate()`, including that `back.qrTile` is light.
  A dark tile inverts the QR symbol, which fails to scan on a large fraction of phone cameras —
  that is a broken card, not an ugly one, and it is caught in CI rather than at a print shop.
