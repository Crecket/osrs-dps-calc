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
| **Next step** | Commit (see Git; still blocked for Claude, run it yourself), then deploy with `npx wrangler login` and `yarn deploy-cf`. Optional polish from the review is listed below. |

## Optional polish (deferred from the review)

- No Cancel button while a run is in progress.
- The full worker pool spawns even for tiny runs (could spawn `min(cores-1, chunks)`).
- Ties in the table are ordered by worker timing, not setup/monster order.
- Very large runs re-sort the whole table on every chunk (could throttle updates).
- A worker crash while finishing a cancelled run's chunk fails the current run; the progress bar can stay stuck after a failed run.
- Calculator-import errors (e.g. a monster removed upstream) aren't shown as a toast.
- A 2-handed weapon saved with a shield gives a false "item removed" warning.
- Duplicate warning text gives duplicate React keys in the warning banner.
- Going from /bulk back to the calculator re-shows the "Restored last browser session" toast.
- Inside `loadPreset`, a setup-migration error is reported as "monster no longer exists".

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

Nothing is committed yet. When ready:

```bash
git checkout -b bulk-mode
git remote rename origin upstream
git add -A && git commit -m "feat: bulk mode"
```

Pulling upstream Wiki changes later: `git fetch upstream && git merge upstream/main`, then run the tests. If bulk tests fail, the fix belongs in `src/bulk/lib/compute.ts` or `src/bulk/lib/presetIO.ts`.

## Decisions made along the way

- Cloudflare settings are inline in the `build-cf` script, not in a `.env.cloudflare` file (Claude's permissions block writing `.env*` files).
- Share-link import and the preset store take injectable fetch/storage functions, so tests don't need module mocks.
- Worker pool chunks carry only the setups/monsters they need; a crashed worker fails the run with a message instead of hanging.
- Upstream files touched: `src/app/components/TopBar.tsx` (+2 lines), `package.json` (scripts, wrangler devDependency), `.gitignore`.
