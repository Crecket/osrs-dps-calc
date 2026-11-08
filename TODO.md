# TODO

What's left from the November 2026 audit, roughly in priority order within each section. Effort: S is under a day, M is a few days, L is a larger refactor.

## First: measure

Compare a real raid run in the browser, on a cold cache, against the previous deploy. Raid rating now skips kill times and sends compact setups, but the planner's share of a full run was never profiled, so the overall gain is unknown. Profile the planner while doing this, because it decides how much of the speed section below is worth doing.

## Features

- **Purchase order (M):** log the moves `climb` accepts in `src/raid/lib/upgrade.ts` and show them as "buy this next: X seconds saved for Y gp". Probably the most useful feature for players, and most of the logic exists.
- **RuneLite Inventory Setups export (S-M):** `src/raid/lib/inventorySetups.ts` only imports. Check the output against the plugin itself. Add a copy button too, since bulk, best and raid don't use the clipboard anywhere.
- **Raid to bulk (S):** an "add to bulk preset" action on raid results, as the Best page has.
- **Budget and cost on the Best page (M):** budget and owned inputs and a cost column, reusing raid's prices and `tierExclusions`. Equal-DPS ties in `TopResults` then go to the cheapest setup, not the first one found.
- **Budget curve (M):** a chart of raid time against budget, using the fact that searches are already cached per price tier.
- **Bulk table (S each):** a "% behind best" column, a cost column, and the slot filter from `IDEAS.md` (filters already have per-slot `overrides`).

## Accuracy

- **Steadier prices (M):** `parsePrices` in `src/raid/lib/prices.ts` uses the latest instant-buy price, so one odd trade on a thin item can move it between price tiers and redo searches. Use the wiki's 5-minute or 1-hour averages.
- **A failed price refresh says nothing (S):** `fetchPrices` falls back to the old snapshot, so the button just shows the old date again. Tell the user the refresh failed.

## Speed

- **Batch rating calls (M):** `upgrade.ts:316, 422, 486, 680, 733, 791, 827` rate one setup per pool run, per unit. Collect the calls of one tick into one run, which needs payloads that can mix monsters since each unit has its own. Also share ratings already in flight, which `dpsRater` only dedupes within one batch today.
- **Skip kit combinations that can't win (S-M):** in `planKits` (`src/raid/lib/kits.ts:351`), skip a tuple when its best-case time ignoring the budget can't beat `bestPlan`. Check the bound against `better`, which ranks uncovered units first. `evaluate` could also be incremental.
- **One worker script and pool (M):** raid alternates between the two pools, and `WorkerLimit.take` retires the other pool's idle workers, so new ones parse their chunks again. One pool stops that and saves memory.
- **Reuse searches across budgets (M):** a cached search over a larger item pool still holds if its results avoid the newly excluded items (approximate for the runners-up), so small budget changes needn't redo searches. Snapping tier caps to buckets may help too.
- **Move the planner into a worker (L):** `withWeapons` only yields between kit combinations, and `upgradeLoadout` does heavy work on the main thread. `basePlayer` must first be separated from `@/state`. This would also let Stop interrupt planning at any point, not only at its next rating or yield.
- **Lazy greedy in `climb` (M):** re-rate only the top candidates. This can miss max-hit breakpoints, so only try it if profiling says the time is here.
- **Trim descent jobs (M):** there are 132-427 jobs per style. Skip those far behind on baseline DPS, though this could miss a setup.
- **Smaller items (S each):**
  - `memo` does nothing in exhaustive mode (`src/best/lib/search.ts:342`), since every combination is unique.
  - `computeRow` scales the monster every time, while `evalDps` caches it.
  - `TaskPool.dispatch` copies the runs for each idle worker.
  - `BulkStore.save` and `RaidStore.save` write the full state on every change. Debounce them and flush on `pagehide`.
  - Every `SearchCache` flush rewrites the whole cache, up to 300 searches and 30000 ratings.
  - The price cache is about 1.2 MB in localStorage, parsed synchronously on load. Move it to IndexedDB.
- **Retry a crashed chunk once (S):** `TaskPool.onWorkerError` fails the whole run, so one out-of-memory worker ends a raid search.

## UX

- **Earlier results (M):** show the descent results on the Best page while exhaustive search runs. Results only appear at the end today.
- **Keep Best results across reloads (S-M):** `ResultCache` is memory-only, while Raid keeps its results.
- **Time remaining (S):** Raid now shows elapsed time. An estimate needs search timings, and Best has neither.
- **Collapse raid inputs after a run (S):** the panels can now be collapsed by hand. Decide whether a run should also collapse them.
- **Right-click actions (M):** excluding or marking items has no touch or keyboard route (14 matching lines across components). Add a visible menu button.
- **Dialogs (M):** replace `window.prompt` and `confirm` in `PresetBar.tsx` and `SetupList.tsx:125` with inline dialogs, and give "Delete all setups" an undo.
- **Tooltip-only information (S-M):** make it reachable without hovering.

## Checked, not worth doing

- **Smarter reduction of gear combinations (Pareto or Minkowski sums):** combinations are at most about 2,200 at 0.03-0.08 ms each, always under the exhaustive cap.
- **Optimising `getHtk`:** kill times are now only computed for setups that are shown. It's upstream code and golden tests pin its exact output.
