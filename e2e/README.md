# End-to-end tests (Playwright)

These drive the **real app in a real browser**, the way a shooter would. They
complement the unit tests in `tests/` (which cover the pure logic in `src/lib`)
by proving the UI is actually wired up: navigation, the one-tap demo loader,
adding a gun, logging a session, the retire/return lifecycle, and every screen
rendering without crashing. Every spec runs twice — once on a **desktop**
layout and once on a **phone** layout.

## First-time setup (run once)

```bash
npm install                      # pulls in @playwright/test
npx playwright install chromium  # downloads the browser (a few hundred MB)
```

## Running

```bash
npm run e2e          # run everything, headless
npm run e2e:ui       # watch them run in Playwright's UI mode
npm run e2e:report   # open the HTML report after a run
```

Playwright starts the Vite dev server automatically, so you don't need a
separate `npm run dev` running.

## How tests get data

Most tests tap the in-app **"See it with sample data"** button (the same path a
tester uses) to seed a full dataset from `public/demo-dataset.bin`. Each test
runs in a fresh browser context, so IndexedDB starts empty every time and tests
never bleed into one another.

## Files

- `helpers.ts` — `seedDemo()` plus viewport-aware navigation helpers.
- `smoke.spec.ts` — boots to setup; demo loads into a populated Home.
- `navigation.spec.ts` — every tab and every Data & Gear section opens.
- `content.spec.ts` — demo data flows through Compete, Costs, Reports, Progress.
- `guns.spec.ts` — Guns list, gun detail, adding a gun.
- `gun-lifecycle.spec.ts` — retire a gun, then return it to active.
- `sessions.spec.ts` — Log list + calendar toggle; logging a live-fire session.
- `setup.spec.ts` — "Start fresh"; loading sample data over existing data warns first.

CI runs the whole suite on every push and pull request (`.github/workflows/e2e.yml`).
