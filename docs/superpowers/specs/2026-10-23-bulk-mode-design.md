# Bulk mode for the OSRS Wiki DPS calculator — design

Date: 2026-10-23
Repo: fork of `weirdgloop/osrs-dps-calc` at `89c3e25b` (Sep 2, 2026), in `~/Projects/dps-bulk-tool`.

## Intent

The Wiki calculator compares a handful of loadouts against one monster at a time. The user wants to check many setups quickly in bulk, using saved presets, and see them ranked in one table. This replaces manually flipping through loadouts on the Wiki calc or GearScape.

The fork must stay easy to update: when the Wiki pushes mechanics fixes or new items, `git merge upstream/main` should apply cleanly, and bulk mode should pick up the changes with no or minimal edits.

## Goals

- A new **Bulk** page that runs every setup in a preset against every monster in that preset and shows the results in one sortable table.
- **Default sort is DPS, descending.**
- **Gear laid out in a row**: each result row shows the setup's 11 equipment slots as item icons in a fixed order, so setups can be compared at a glance.
- **Spec mode**: a toggle that switches the table to special-attack metrics and hides any setup whose weapon has no supported spec.
- **Presets**: named, saved collections of setups and monsters that can be reloaded and run again.
- **Web worker pool**: calculations run off the main thread and in parallel, so large batches don't freeze the page.
- **Upstream-friendly**: additive code only, with a tiny, listed set of touches to upstream files.

## Non-goals (v1)

- A "find best gear" search (GearScape-style "Best Setup"). The worker pool should not preclude it later, but it is not built now.
- Editing gear inside the Bulk page. Setups are built in the normal calculator UI and sent to bulk mode (see Presets).
- NPC-vs-player (defensive) results, hit distribution charts, TTK distribution charts.
- Deploying the fork publicly.

## Anti-goals

- Forking or editing the calc engine (`src/lib/**`), the existing worker (`src/worker/**`), or `src/state.tsx` beyond the touches listed below. Any change that makes upstream merges conflict routinely is a failure even if bulk mode works.
- Bulk results that disagree with what the normal calculator shows for the same setup and monster.
- Breaking the existing calculator page or its saved state (`dps-calc-state`, `dps-calc-prefs` in localforage).

## Constraints and facts from the codebase

- Next.js 14 App Router, static export (`output: 'export'` in `next.config.js`), React 18, MobX, Tailwind, Jest. Path alias `@/` → `src/`.
- One `GlobalState` store is created in `src/app/components/ClientProviders.tsx` and wraps every route, so a new `/bulk` route can read the user's current calculator loadouts (`store.loadouts`) and monster directly.
- The engine is `PlayerVsNPCCalc` (`src/lib/PlayerVsNPCCalc.ts`). `src/worker/worker.ts` (`computePvMValues`) already shows exactly which methods produce each metric: `getDistribution().getMax()`, `getDisplayHitChance()`, `getDps()`, `getTtk()`, and `getSpecCalc()` → `getMax()`, `getExpectedDamage()`, `getDisplayHitChance()`, `getDps()`, `getSpecDps()`.
- `getSpecCalc()` returns `null` when the weapon's spec is unsupported or absent. That is the spec-mode filter. Partially implemented specs return a calc; flag them (the calc emits a `userIssues` entry) but don't hide them.
- The existing `CalcWorker` (`src/worker/CalcWorker.tsx`) is one worker with a 250 ms debounce per request type and drops stale responses. That is right for live editing and wrong for batches, so bulk mode gets its own pool rather than reusing or modifying it.
- Messages cross the worker boundary as JSON strings using `WORKER_JSON_REPLACER` / `WORKER_JSON_REVIVER` from `src/utils.ts` (handles `Map`/`Set`). Bulk mode uses the same.
- Before calculating, a `Player`'s bonuses must be derived from its gear for the target monster: `calculateEquipmentBonusesFromGear(player, monster)` and `calculateAttackSpeed(player, monster)` from `src/lib/Equipment.ts`. Some bonuses depend on the monster, so this runs per setup × monster pair (inside the worker).
- Saved data is re-resolved by item ID on load (`parseLoadoutsFromImportedData` in `src/state.tsx`), which is what keeps old share links working after item data updates. Presets use the same mechanism.

## Design

### Where the code lives

All new code goes under new paths:

- `src/bulk/` — everything bulk-specific: worker pool, worker entry, preset storage, adapter, table components.
- `src/app/bulk/page.tsx` — the `/bulk` route.
- `src/tests/bulk/` — Jest tests.
- `docs/superpowers/` — this design and the plan.

Touches to upstream files, the complete list:

1. `src/app/components/TopBar.tsx`: one link to `/bulk` (and back to the calculator from the bulk page's own header).
2. A "Send to bulk" button in the calculator's player area, in one small new component rendered from one line in an existing player component. If this proves awkward, the alternative is an "Import from calculator" button on the bulk page only, with zero edits to player components (builder's call; prefer the zero-edit option if it is equally usable).

### The adapter (single point of contact with the engine)

`src/bulk/adapter.ts` is the only bulk file that imports from `src/lib/**`, `src/state.tsx`, or `src/utils.ts`. It exposes:

- `computeRow(player, monster, opts) → BulkRow` — prepares the player for the monster (bonuses, attack speed), runs `PlayerVsNPCCalc`, and returns plain numbers: max hit, accuracy, DPS, TTK, plus spec max hit, spec accuracy, spec expected damage, spec DPS, and whether spec is supported/partial; plus `userIssues`.
- `serializePreset` / `parsePreset` — wraps upstream's import/re-resolve logic.
- `findMonster(id, version)` — wraps `getMonsters()`.

When upstream renames or reshapes something, this file is where it breaks and the only file to fix.

### Worker pool

- `src/bulk/worker/bulkWorker.ts`: a worker entry that receives a chunk of jobs (each job = setup index + monster index, sent with the full setup and monster objects for the batch once) and replies with `BulkRow`s. It calls only `adapter.computeRow`.
- `src/bulk/worker/BulkPool.ts`: spawns `max(1, navigator.hardwareConcurrency - 1)` workers lazily on first run, splits the job list into chunks, hands chunks to idle workers, and reports progress. No debouncing, nothing dropped.
- Running again while a run is in progress cancels the old run (results from the old run are ignored; workers can be terminated and respawned — builder's call).
- Workers are torn down when leaving the `/bulk` page.
- Job chunk size and exact message protocol are the builder's call.

### Presets

A preset is:

```
{
  id, name, createdAt, updatedAt,
  serializationVersion,          // upstream IMPORT_VERSION at save time
  setups: Player[],              // stored like ImportableData.loadouts; gear re-resolved by item ID on load
  monsters: { id, version, inputs? }[]  // inputs = optional monster-input overrides (e.g. phase, toa level)
}
```

- Stored in localforage under a new key, `dps-bulk-presets`. Never writes to upstream's keys.
- Export/import a preset as a JSON file.
- Ways to add setups to a preset: send/import the current calculator loadouts (all of them, or the selected one); import from a Wiki share link ID (the same `?id=` shortlink data the calculator already loads, via `fetchShortlinkData` in `src/utils.ts`).
- Ways to add monsters: search the monster list (reuse the generic `Combobox` from `src/app/components/generic/` over `getMonsters()`), or add the calculator's current monster.
- Setups are removable and renamable in the bulk page. Gear editing is not in the bulk page.
- On load, setups go through the same item-ID re-resolution as upstream imports. If an item no longer exists, it is dropped (upstream's behavior) and the row shows a warning.

### The table

Columns, left to right:

1. Rank.
2. Setup name.
3. Monster (name + version). With a single monster in the preset, the column still shows but can be narrow.
4. Gear row: 11 fixed-width icon cells in this order — head, cape, neck, ammo, weapon, shield, body, legs, hands, feet, ring. Empty slots render as a blank cell so columns line up across rows. Hovering an icon shows the item name (use the existing `react-tooltip` setup). Icons come from the same image source the calculator uses for equipment.
5. Metrics.

Normal mode metrics: Max hit, Accuracy, DPS, TTK (seconds). Default sort DPS descending.

Spec mode metrics: Spec max hit, Spec accuracy, Spec expected damage (per spec), Spec DPS. Rows whose `getSpecCalc()` is `null` are hidden. Partially supported specs show a warning icon. Default sort in spec mode: spec expected damage, descending (my call — see "Calls made").

- Every metric column is sortable by clicking its header; clicking again reverses.
- A monster filter above the table: "All monsters" or one monster. With "All", rows are ranked across monsters by the sort column; showing the best setup per monster is out of scope for v1.
- A row's warnings (from `userIssues`) show as an icon with tooltip.
- A progress indicator while the pool runs; rows can fill in as chunks complete.
- Optional "Export CSV" of the current view (builder may defer).

Visual style matches the existing calculator (Tailwind classes and dark theme already in the repo).

### Staying compatible with upstream

- Git remotes: rename the clone's `origin` to `upstream` (weirdgloop). The user can add their own fork as `origin` later.
- Update flow: `git fetch upstream && git merge upstream/main`, then `yarn test`. Documented in a short `BULK.md` at repo root (one new file; the upstream README stays untouched).
- Parity test (`src/tests/bulk/parity.test.ts`): for a handful of setups × monsters (including at least one spec weapon, one magic setup, one ranged setup, and one monster with special inputs), assert `adapter.computeRow` matches what `computePvMValues`-equivalent direct `PlayerVsNPCCalc` calls produce. After an upstream merge, this catches any drift between bulk and the normal calc.
- Preset compatibility test: a fixture preset saved with today's `IMPORT_VERSION` must still load after future merges (item IDs re-resolve; unknown items are dropped with a warning, not a crash).
- Bulk code reads upstream types (`Player`, `Monster`) but never adds fields to them.

### Monsters and their inputs

- Presets store the **full monster object** (including `inputs`) per entry, not just the ID. On load, a wiki monster (`id !== -1`) has its base stats re-resolved from `getMonsters()` by id + version (so upstream data fixes apply) while its saved `inputs` are kept, merged over `INITIAL_MONSTER_INPUTS` so new upstream input fields get defaults. A custom monster (`id === -1`) is kept exactly as stored and calculated with `disableMonsterScaling: true`, matching upstream.
- Inputs are per monster. "Add current monster" captures the calculator's monster with all its inputs (raid levels, party size, phase, current HP, defence reductions), so the workflow for raids and bosses is: set it up in the calculator, then add it.
- A monster added by search gets `INITIAL_MONSTER_INPUTS` plus the two defaults upstream sets in `MonsterContainer`'s effects: `phase = MONSTER_PHASES_BY_ID[id]?.[0]` and `monsterCurrentHp = scaleMonster(monster).skills.hp`. The adapter owns this so searched monsters match what the calculator shows.
- No monster-inputs editor in the bulk page in v1. Each monster chip shows a short summary of non-default inputs (e.g. "phase: Tank", "2× DWH") so it's clear what it was captured with.

### Setups use their saved settings

Each setup runs with its saved combat style, prayers, potions and buffs (including `onSlayerTask`) against every monster, exactly as the calculator would. No per-monster style optimization. This keeps parity with the normal calculator.

### Hosting on Cloudflare

- Target: `https://bulk-dps-calc.olm.pet`, served at the domain root (no base path).
- The app is already a static export (`next build` → `out/`). Host it as a **Cloudflare Worker with static assets** (`wrangler.jsonc` at repo root, `assets.directory = "./out"`, `not_found_handling` set so unknown paths serve the 404 page), with a custom-domain route for `bulk-dps-calc.olm.pet` on the `olm.pet` zone.
- New env file `.env.cloudflare` (`NEXT_PUBLIC_BASE_URL=https://bulk-dps-calc.olm.pet`, empty `NEXT_PUBLIC_BASE_PATH`, `NEXT_PUBLIC_SHORTLINK_URL=https://dps.osrs.wiki`) and scripts `build-cf` (`env-cmd -f .env.cloudflare next build`) and `deploy-cf` (`build-cf` then `wrangler deploy`). Upstream's env files stay untouched.
- Data and images keep loading from upstream's CDN (`tools.runescape.wiki`, `oldschool.runescape.wiki`), as the calculator already does. Share-link import calls upstream's shortlink API from the new origin; if that's blocked by CORS, share-link import fails with a clear message and the rest works.
- Deploying itself (`wrangler login`, first `wrangler deploy`) is run by the user; the repo is left ready for it.

## Calls made (mine, not the user's — check these)

- Monster inputs: per monster, captured from the calculator; no bulk-page inputs editor in v1.
- Custom monsters are kept whole in presets.
- Setups always use their saved style/prayers/buffs; no per-monster style search.
- Hosting: Cloudflare Worker with static assets rather than Cloudflare Pages (Cloudflare's current recommended path for static sites).

- Bulk is a separate `/bulk` page rather than a tab inside the main calculator page — it keeps upstream's `home.tsx` untouched.
- No gear editing in bulk mode in v1; setups come from the calculator or share links.
- Spec mode default sort = spec expected damage per spec (the usual "how hard does it hit" comparison). Spec DPS is one click away.
- Spec mode hides setups with no supported spec; partially supported specs stay visible with a warning.
- Flat table with a monster filter, not a monsters × setups grid.
- Worker count = CPU cores − 1.
- Presets in browser storage plus JSON export/import; no cloud sync.

## Left to the builder

- Exact component breakdown and file names inside `src/bulk/`.
- Worker message protocol and chunk size.
- Whether to use a small MobX store or React state for the bulk page.
- Choice between the "Send to bulk" button and the zero-edit "Import from calculator" button (prefer zero-edit if usable).
- CSV export in v1 or later.
