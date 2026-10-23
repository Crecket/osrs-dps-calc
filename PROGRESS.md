# Bulk mode: progress

Pick-up notes for continuing this work later (by you or a fresh Claude session). Design: `docs/superpowers/specs/2026-10-23-bulk-mode-design.md`. Plan with ticked steps: `docs/superpowers/plans/2026-10-23-bulk-mode.md`.

## Status (2026-10-23)

| Task | State |
|---|---|
| 1. Baseline, branch, remotes | Deps installed, upstream tests green. **Branch, remote rename and commits not done** (git commands were blocked for Claude; see "Git" below). |
| 2. Calc adapter `src/bulk/lib/compute.ts` | Done, tested |
| 3. Preset import/export `src/bulk/lib/presetIO.ts` | Done, tested |
| 4. Preset store `src/bulk/state/BulkStore.ts` | Done, tested (fixed: presets weren't saving to IndexedDB) |
| 5. Worker pool `src/bulk/worker/` | Done, tested |
| 6. Table logic + UI | Done, tested (fixed: rows didn't show after adding setups) |
| 7. Bulk page `/bulk` + top bar link | Done. Browser-checked (headless Chromium against `wrangler dev`): 3 setups × 2 monsters ran in ~0.3s, sorting, spec mode and reload persistence work, no console errors. |
| 8. Cloudflare hosting | Done: `wrangler.jsonc`, `build-cf` / `preview-cf` / `deploy-cf` scripts (they use `npx wrangler@4`, so wrangler isn't a dependency and `yarn.lock` matches upstream), `BULK.md`; `npx wrangler@4 deploy --dry-run` passes. **Not deployed yet**: run `npx wrangler login` then `yarn deploy-cf`. |
| Final review | Done. Fixed, each with a test: a setup that can't hurt a monster ranked as the best TTK; missing-item warnings named the wrong setup; Spec mode said "no specs" before any run and hid error rows; renamed setups showed old names in results; one broken preset could block loading; a storage read error could wipe presets; the lockfile churn. Full suite: 378 passed, 4 skipped (upstream's); lint and `build-cf` clean. |
| Post-review smoke test | Done: rebuilt with `build-cf`, served with `wrangler dev`, headless Chromium: 2 setups × 2 monsters → 4 rows in ~250ms, Spec mode shows the "no supported special attack" message for spec-less loadouts, reload keeps setups and monsters, going back to the calculator works, 0 console errors. Full suite 378 passed / 4 skipped; lint has only 3 `no-alert` warnings (the intentional `prompt`/`confirm` in `PresetBar.tsx`). |
| **Next step** | Commit the redesign (command in the chat), then deploy with `npx wrangler login` and `yarn deploy-cf`. |

## Polish (done, committed in 277f65c3 on `bulk-mode`)

All ten review items are fixed, each with a test or a browser check: Cancel button; pool spawns `min(size, chunks)` workers; rows keep setup × monster order; progress throttled to 100ms; a crash on a cancelled run's chunk no longer fails the next run; stuck progress bar; calculator-import errors shown as toasts; no false "removed" warning for a 2H weapon saved with a shield; duplicate warnings deduped; a broken setup is dropped with its own warning (it used to throw out of `loadPreset`). The "Calculator" button is now a full page load, so upstream's start-up runs once (no "already set" warnings). Suite: 385 passed, 4 skipped.

## Bulk-first redesign (built 2026-10-23)

Spec `docs/superpowers/specs/2026-10-23-bulk-first-design.md`, plan `docs/superpowers/plans/2026-10-23-bulk-first.md`. The bulk tool is the homepage (`/`), the calculator is at `/calc`, `/bulk` redirects to `/`. One target monster per preset (searchable drop-down; old presets keep their first monster). Results run automatically. New presets start with 11 max setups (`src/bulk/lib/defaultSetups.ts`). Adding setups never adds duplicates. A banner offers calculator loadouts that aren't in the preset yet. Browser-checked end to end (landing, auto-run, reload, calculator round trip, banner, dedupe, `/bulk` redirect, 0 console warnings). Max obligator waits for the Obligator to reach upstream's item data.

## How to resume

```bash
cd ~/Projects/dps-bulk-tool
# tests and build use Node 18 (.nvmrc); wrangler needs Node 20+
nvm use 18
node .yarn/releases/yarn-4.9.2.cjs jest src/tests/bulk --coverage=false   # bulk tests
node .yarn/releases/yarn-4.9.2.cjs test                                   # everything
node .yarn/releases/yarn-4.9.2.cjs build-cf                               # static build into ./out
nvm use 24 && npx wrangler dev                                            # serve ./out locally
```

`yarn` isn't on the PATH (no corepack on Node 26); `node .yarn/releases/yarn-4.9.2.cjs <cmd>` is the same thing.

To continue with Claude: "Continue the bulk mode plan from PROGRESS.md." The detailed execution ledger is in `.superpowers/sdd/2026-10-23-bulk-mode/progress.md` (git-ignored).

## Git

Work is on branch `bulk-mode`; the wiki repo is the `upstream` remote. Claude can't run git commands here and hands them to the user to run.

Pulling upstream Wiki changes later: `git fetch upstream && git merge upstream/main`, then run the tests. If bulk tests fail, the fix belongs in `src/bulk/lib/compute.ts` or `src/bulk/lib/presetIO.ts`.

## Decisions made along the way

- Cloudflare settings are inline in the `build-cf` script, not in a `.env.cloudflare` file (Claude's permissions block writing `.env*` files).
- Share-link import and the preset store take injectable fetch/storage functions, so tests don't need module mocks.
- Worker pool chunks carry only the setups/monsters they need; a crashed worker fails the run with a message instead of hanging.
- Upstream files touched: `src/app/components/TopBar.tsx` (+2 lines), `package.json` (scripts, wrangler devDependency), `.gitignore`.
