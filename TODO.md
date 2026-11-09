# TODO

What's left from the November 2026 audit, roughly in priority order within each section. Effort: S is under a day, M is a few days, L is a larger refactor. Items are checked off as they're pushed.

## How to work on this

To pick this up later, tell Claude: "Work through TODO.md, following its instructions." Work continues until told to stop.

**Process**

- Take unchecked items in order within a section, skipping anything marked as waiting on a question.
- Give agents running at the same time items that don't touch the same files.
- Commit and push each item to `bulk-mode` once it's finished and tested, then check it off here. Pushing deploys.
- Write findings and questions in the sections below and keep going. If a decision is really the user's, take the conservative option and note it.
- If an item turns out wrong or not worth doing, say so with evidence and move it to "Checked, not worth doing".

**Rules**

- Raid and best runs start only from the button, even cheap cached re-plans. Changes mark results stale.
- No full raid runs in jest, only small checks. Real runs are tested in the browser, so note what still needs one.
- Scratch and debug files go in the git-ignored `temp/`, never `src/`.
- Untradeable items aren't free: price them from their GE parts (`src/raid/lib/prices.ts`).
- Avoid changing upstream engine files in `src/lib`. Only rewrite `src/tests/perf/golden.json` when an output is meant to change, and check that nothing else moved.
- Commit messages are one brief line, with no body and no attribution. Never hard-wrap prose.

**Before each push** (Node 18: `nvm use 18`)

- `npx tsc --noEmit -p .`
- `npx eslint` on the changed files
- `npx jest --coverage=false --testPathIgnorePatterns '/node_modules/' '/.claude/' '/temp/'` (without this, jest also runs the copies in leftover agent worktrees)
- `node .yarn/releases/yarn-4.9.2.cjs build-cf`, with lint on, because the deploy lints

**Agents in worktrees**

- Symlink `node_modules` from the main checkout, and work from the latest `origin/bulk-mode`.
- `git fetch`, `git rebase` and `source nvm` have been refused for agents. If they still are, the agent should report it rather than work around it, and the main session has to bring its branch up to date.
- ESLint fails inside a worktree on a plugin conflict, so run the lint and the final build from the main checkout.

## Questions for you

- **Bork model:** how long are the walking and stun windows in seconds? Should the planner assume you aren't tanking, or should that be a setting (suggested: a setting, defaulting to non-tank)? What does the tank use while walking? The Bork item below waits on these.

## Findings

- **Cached searches were reset once:** the new cache storage format drops existing cached searches, so the next raid run redoes them.
- **Save debounce trade-off:** a tab crash can lose up to 300 ms of edits, or 3 s of continuous typing. Editing in a bulk tab and adding a setup from a best tab within 300 ms can overwrite one of the two. Also flushing on `visibilitychange` would close both, and hasn't been done.
- **Scaled monster cache is DPS-only:** using it on all rows changes the Tonalztics spec, because it scales twice (Great Olm at party size 8: 16.3336 vs 16.3219 expected damage). The saving is small anyway, about 0.2-1.9 µs of a 13 µs row.
- **Golden gap:** the golden tests didn't catch that double scaling. One new test pins this case, but the fixture doesn't cover the Tonalztics spec with party scaling.
- **Still needs a browser:** moving an existing localStorage price snapshot to IndexedDB, whether a `pagehide` save finishes when a tab really closes, how the failed refresh message looks, and a real out-of-memory worker crash and retry.

## Measure

- [ ] Compare a real raid run in the browser, on a cold cache, against the previous deploy, and profile the planner while doing it. Raid rating now skips kill times and sends compact setups, but the planner's share of a full run was never profiled, so the overall gain is unknown. This needs a person with a browser, and it decides how much of the speed section is worth doing.

## Model

- [ ] **Bork as time windows (M):** model the fight as repeating walking and stun windows, with kill time from damage per cycle, instead of fixed 25/75 health shares. Each player's walking style depends on their role. Waits on the questions above.

## Features

- [ ] **Purchase order (M):** log the moves `climb` accepts in `src/raid/lib/upgrade.ts` and show them as "buy this next: X seconds saved for Y gp". Probably the most useful feature for players, and most of the logic exists.
- [ ] **RuneLite Inventory Setups export (S-M):** `src/raid/lib/inventorySetups.ts` only imports. Check the output against the plugin itself.
- [ ] **Copy buttons (S):** bulk, best and raid don't use the clipboard anywhere.
- [ ] **Raid to bulk (S):** an "add to bulk preset" action on raid results, as the Best page has.
- [ ] **Budget and cost on the Best page (M):** budget and owned inputs and a cost column, reusing raid's prices and `tierExclusions`. Equal-DPS ties in `TopResults` then go to the cheapest setup, not the first one found.
- [ ] **Budget curve (M):** a chart of raid time against budget, using the fact that searches are already cached per price tier.
- [ ] **Bulk: "% behind best" column (S)**
- [ ] **Bulk: cost column (S)**
- [ ] **Bulk: slot filter from `IDEAS.md` (S):** filters already have per-slot `overrides`.

## Accuracy

- [ ] **Steadier prices (M):** `parsePrices` in `src/raid/lib/prices.ts` uses the latest instant-buy price, so one odd trade on a thin item can move it between price tiers and redo searches. Use the wiki's 5-minute or 1-hour averages.
- [x] **A failed price refresh says nothing (S):** `fetchPrices` falls back to the old snapshot, so the button just shows the old date again. Tell the user the refresh failed.

## Speed

- [ ] **Batch rating calls (M):** `upgrade.ts:316, 422, 486, 680, 733, 791, 827` rate one setup per pool run, per unit. Collect the calls of one tick into one run, which needs payloads that can mix monsters since each unit has its own. Also share ratings already in flight, which `dpsRater` only dedupes within one batch today.
- [ ] **Skip kit combinations that can't win (S-M):** in `planKits` (`src/raid/lib/kits.ts:351`), skip a tuple when its best-case time ignoring the budget can't beat `bestPlan`. Check the bound against `better`, which ranks uncovered units first. `evaluate` could also be incremental.
- [ ] **One worker script and pool (M):** raid alternates between the two pools, and `WorkerLimit.take` retires the other pool's idle workers, so new ones parse their chunks again. One pool stops that and saves memory.
- [ ] **Reuse searches across budgets (M):** a cached search over a larger item pool still holds if its results avoid the newly excluded items (approximate for the runners-up), so small budget changes needn't redo searches. Snapping tier caps to buckets may help too.
- [ ] **Move the planner into a worker (L):** `withWeapons` only yields between kit combinations, and `upgradeLoadout` does heavy work on the main thread. `basePlayer` must first be separated from `@/state`. This would also let Stop interrupt planning at any point, not only at its next rating or yield.
- [ ] **Lazy greedy in `climb` (M):** re-rate only the top candidates. This can miss max-hit breakpoints, so only do it if profiling says the time is here.
- [ ] **Trim descent jobs (M):** there are 132-427 jobs per style. Skip those far behind on baseline DPS, though this could miss a setup.
- [x] **Remove `memo` in exhaustive mode (S):** it does nothing there (`src/best/lib/search.ts:342`), since every combination is unique.
- [x] **Cache the scaled monster in `computeRow` (S):** it scales every time, while `evalDps` caches it. Done for DPS-only rows only: see Findings.
- [x] **`TaskPool.dispatch` copies (S):** it copies the runs for each idle worker.
- [x] **Debounce store saves (S):** `BulkStore.save` and `RaidStore.save` write the full state on every change. Debounce them and flush on `pagehide`.
- [x] **Smaller `SearchCache` writes (S):** every flush rewrites the whole cache, up to 300 searches and 30000 ratings.
- [x] **Price cache in IndexedDB (S):** about 1.2 MB in localStorage, parsed synchronously on load.
- [x] **Retry a crashed chunk once (S):** `TaskPool.onWorkerError` fails the whole run, so one out-of-memory worker ends a raid search.

## UX

- [ ] **Earlier results (M):** show the descent results on the Best page while exhaustive search runs. Results only appear at the end today.
- [ ] **Keep Best results across reloads (S-M):** `ResultCache` is memory-only, while Raid keeps its results.
- [ ] **Time remaining (S):** Raid now shows elapsed time. An estimate needs search timings, and Best has neither.
- [ ] **Collapse raid inputs after a run (S):** the panels can now be collapsed by hand. Decide whether a run should also collapse them.
- [ ] **Right-click actions (M):** excluding or marking items has no touch or keyboard route (14 matching lines across components). Add a visible menu button.
- [ ] **Dialogs (M):** replace `window.prompt` and `confirm` in `PresetBar.tsx` and `SetupList.tsx:125` with inline dialogs, and give "Delete all setups" an undo.
- [ ] **Tooltip-only information (S-M):** make it reachable without hovering.

## Checked, not worth doing

- **Smarter reduction of gear combinations (Pareto or Minkowski sums):** combinations are at most about 2,200 at 0.03-0.08 ms each, always under the exhaustive cap.
- **Optimising `getHtk`:** kill times are now only computed for setups that are shown. It's upstream code and golden tests pin its exact output.
