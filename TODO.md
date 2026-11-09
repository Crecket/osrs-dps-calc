# TODO

What's left from the November 2026 audit, roughly in priority order within each section. Effort: S is under a day, M is a few days, L is a larger refactor. Items are checked off as they're pushed.

## How to work on this

To pick this up later, tell Claude: "Work through TODO.md, following its instructions." Work continues until told to stop.

**Process**

- Work directly in the main checkout on `bulk-mode`, with no worktrees.
- Take unchecked items in order within a section, skipping anything marked as waiting on a question.
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
- `npx jest --coverage=false`
- `node .yarn/releases/yarn-4.9.2.cjs build-cf`, with lint on, because the deploy lints

## Questions for you

- **Bulk costs:** they read raid's saved price snapshot however old it is, because refreshing would make raid redo its cached searches. Is that fine, or should bulk have its own fresher prices?
- **Bulk prices missing:** the cost column stays with dashes so the table doesn't jump. Should it hide completely after a failure?
- **Bulk "Leave out slots":** leaving out ammo strips it from ranged setups, so their DPS reflects having none. Should ammo be disabled like the weapon slot?
- **Deleting a preset:** it has a confirm dialog but no undo. Should it get one too?
- **CSV export:** it doesn't include the Behind or Cost columns. Should it?
- **.claude/ in git:** it shows up as untracked. Should it go in `.gitignore`?

## Findings

- **Tooltips open on tap and focus:** on the bulk, best and raid pages, set in one place (`PageTooltip`). The upstream calculator page is unchanged. Keyboard focus only reaches elements that are focusable, so tooltips on plain cells remain tap and hover only. This needs checking in a browser, especially tapping a button that has a tooltip.
- **Speed items have no profile:** batching, one worker pool, reusing searches, the planner worker, lazy greedy and trimming jobs are risky worker and search changes, and there won't be a browser profile to say where raid time goes. Take them last, one at a time, only where results can't change or the test shows they don't.
- **Prices now use 1-hour averages:** this only applies after pressing refresh, since saved snapshots keep their prices so cached searches stay valid. The first refresh may move some items between price tiers and redo those searches.
- **Best: clicking an item now excludes it:** this gives touch and keyboard a route, but a misclick excludes too. It shows a toast and a removable chip, and nothing runs. Raid's item panel gained Exclude and Mark owned instead. Raid's spec cells remain right-click only.
- **Time estimates are partial on purpose:** Best estimates only the exhaustive phase, and Raid only its searches ("about 1:20 of searches left"). Earlier Best phases don't predict later ones and Raid planning has no measure of progress, so those show elapsed time only.
- **Best results now persist per build:** like Raid, a new deploy drops the saved Best result.
- **Inventory Setups export needs one real import:** its shape matches a real export in the fixtures, but it hasn't been imported into the plugin itself. It leaves out the rune pouch's contents, and reserved cells stay empty because they stand for any boost potion.
- **Copy buttons:** added on raid (Inventory Setups and item list) and bulk (results as CSV). Best has none, since its setups already go to bulk.
- **Purchase order covers the upgrade steps only:** it lists what the climb and boot steps bought and kept. Weapons added by the weapon step, kits, and anything from the starting setup are in the cost breakdown but not in the order. Each saving is from when the item was bought, so they don't add up exactly.
- **Possible flaky test:** `runRaid › re-plans with fewer items when switches overflow the inventory` failed once in a heavily loaded run and passed in two clean ones.
- **Git limits:** `git fetch`, `git rebase` and `git reset` are on the deny list, so `git merge` is how branches get combined.
- **Bulk table width and dialogs need a browser:** the two new columns, the slot popover, the dialogs in both themes, the undo toast and Enter to submit haven't been seen in a real browser.
- **Cached searches were reset once:** the new cache storage format drops existing cached searches, so the next raid run redoes them.
- **Save debounce trade-off:** a tab crash can lose up to 300 ms of edits, or 3 s of continuous typing. Editing in a bulk tab and adding a setup from a best tab within 300 ms can overwrite one of the two. Also flushing on `visibilitychange` would close both, and hasn't been done.
- **Scaled monster cache is DPS-only:** using it on all rows changes the Tonalztics spec, because it scales twice (Great Olm at party size 8: 16.3336 vs 16.3219 expected damage). The saving is small anyway, about 0.2-1.9 µs of a 13 µs row.
- **Golden gap:** the golden tests didn't catch that double scaling. One new test pins this case, but the fixture doesn't cover the Tonalztics spec with party scaling.
- **Still needs a browser:** moving an existing localStorage price snapshot to IndexedDB, whether a `pagehide` save finishes when a tab really closes, how the failed refresh message looks, and a real out-of-memory worker crash and retry.

- **Equal-DPS ties go to the cheaper gear on the Best page only:** search payloads carry the priced items and `TopResults` keeps the cheaper of two setups with the same DPS (the Salve (e) and (ei) tie for melee is the test). Raid searches don't pass prices, so their cached searches and the golden tests are unchanged. A saved Best result isn't redone after a price refresh, the same as the max item price.
- **Best page total budget:** a "Most a setup may cost" field next to the item limit, with the weapon, its ammo or dart included, at the raid page's prices. Weapons that cost more than the budget are left out. The exhaustive search finds the exact best setup by combining slots on attack, strength and cost. Against brute force with real prices (whip, blowpipe, rapier at 5m-3b), it matched every result brute force could finish, beat the cases where brute force had to give up, and took 16-81 ms per weapon, where brute force took up to 70 s. Runners-up within a budget may miss some setups, and the descent phase that picks the top weapons is approximate under a budget. It needs a browser check.

## Features

- [x] **Purchase order (M):** log the moves `climb` accepts in `src/raid/lib/upgrade.ts` and show them as "buy this next: X seconds saved for Y gp". Probably the most useful feature for players, and most of the logic exists.
- [x] **RuneLite Inventory Setups export (S-M):** `src/raid/lib/inventorySetups.ts` only imports. Check the output against the plugin itself.
- [x] **Copy buttons (S):** bulk, best and raid don't use the clipboard anywhere.
- [x] **Raid to bulk (S):** an "add to bulk preset" action on raid results, as the Best page has.
- [x] **Cost column and max item price on the Best page (M):** a cost column, reusing raid's prices, and a "most an item may cost" input.
- [x] **Cheapest of equal-DPS setups (M):** ties in `TopResults` go to the first setup found. Choosing the cheapest needs prices in the search workers.
- [x] **A total budget on the Best page (L):** the search only filters item by item, so a total for the whole setup needs the search itself to change.
- [x] **Bulk: "% behind best" column (S)**
- [x] **Bulk: cost column (S)**
- [x] **Bulk: slot filter from `IDEAS.md` (S):** filters already have per-slot `overrides`.

## Accuracy

- [x] **Steadier prices (M):** `parsePrices` in `src/raid/lib/prices.ts` uses the latest instant-buy price, so one odd trade on a thin item can move it between price tiers and redo searches. Use the wiki's 5-minute or 1-hour averages.
- [x] **A failed price refresh says nothing (S):** `fetchPrices` falls back to the old snapshot, so the button just shows the old date again. Tell the user the refresh failed.

## Speed

- [ ] **Batch rating calls (M):** `upgrade.ts:316, 422, 486, 680, 733, 791, 827` rate one setup per pool run, per unit. Collect the calls of one tick into one run, which needs payloads that can mix monsters since each unit has its own. Also share ratings already in flight, which `dpsRater` only dedupes within one batch today.
- [x] **Skip kit combinations that can't win (S-M):** in `planKits` (`src/raid/lib/kits.ts:351`), skip a tuple when its best-case time ignoring the budget can't beat `bestPlan`. Check the bound against `better`, which ranks uncovered units first. `evaluate` could also be incremental.
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

- [x] **Earlier results (M):** show the descent results on the Best page while exhaustive search runs. Results only appear at the end today.
- [x] **Keep Best results across reloads (S-M):** `ResultCache` is memory-only, while Raid keeps its results.
- [x] **Time remaining (S):** Raid now shows elapsed time. An estimate needs search timings, and Best has neither.
- [x] **Right-click actions (M):** excluding or marking items has no touch or keyboard route (14 matching lines across components). Add a visible menu button.
- [x] **Dialogs (M):** replace `window.prompt` and `confirm` in `PresetBar.tsx` and `SetupList.tsx:125` with inline dialogs, and give "Delete all setups" an undo.
- [x] **Tooltip-only information (S-M):** make it reachable without hovering.

## Checked, not worth doing

- **Smarter reduction of gear combinations (Pareto or Minkowski sums):** combinations are at most about 2,200 at 0.03-0.08 ms each, always under the exhaustive cap.
- **Optimising `getHtk`:** kill times are now only computed for setups that are shown. It's upstream code and golden tests pin its exact output.
- **Budget curve (a chart of raid time against budget):** dropped, you didn't want it.
- **Owned items on the Best page:** dropped, you didn't want it.
- **Bork as time windows:** dropped for now. Bork keeps the fixed 25% walking and 75% stunned health shares, with the stunned-armour fix.
- **Collapse raid inputs after a run:** dropped, the panels stay manual.
- **Profiling a real raid run:** dropped, nobody will run it.
