# FirearmLog

Training, competition, and maintenance log for shooters. Local-first PWA — all data
stays on your own devices. Built with Vite + TypeScript + React.

**This folder is the GitHub repository root.** Michael's real data files are blocked
from ever being committed (see `.gitignore`).

## How publishing works

Every push to `main` triggers `.github/workflows/deploy.yml`, which installs
dependencies, **runs all tests (a failing test blocks publishing)**, builds the app,
and deploys it to GitHub Pages.

## Where things live

- This folder (`Claude Projects/FirearmLog/FirearmLog`) is the local repository that
  GitHub Desktop watches. The GitHub copy is `MJMinik/FirearmLog`.
- One-time Pages setup: on github.com, repo **Settings -> Pages** -> under
  "Build and deployment", set **Source: GitHub Actions**.
- The live app: `https://mjminik.github.io/FirearmLog/` (follows the repo name).

## Every update after that

Claude edits the files. Michael opens GitHub Desktop, types a one-line summary,
clicks **Commit to main**, then **Push origin**. Two minutes later the new build is live.

## Developer commands (run by the GitHub robot, not by Michael)

- `npm install` — get dependencies
- `npm test` — run the automated tests (plain Node, no dependencies needed)
- `npm run build` — type-check and build the production app
- `npm run verify-real -- ../pistol-tracker-sync.json` — local-only check of the
  importer against the real data file (the file never leaves this computer)
