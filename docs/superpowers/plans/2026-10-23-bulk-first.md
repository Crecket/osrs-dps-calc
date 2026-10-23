# Bulk-first Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bulk tool the homepage, with one target monster per preset, default max setups, no duplicate setups, and an obvious round trip to the calculator for building setups.

**Architecture:** All new logic stays under `src/bulk/`. Duplicate detection is a pure key function used by one store method. Default setups are minimal loadouts passed through the existing `migrateImportable`. The preset shape changes from `monsters[]` to `monster`, migrated in `loadPreset`. Routes: `/` renders the bulk page, the calculator moves to `/calc`, `/bulk` redirects to `/`.

**Tech Stack:** Next.js 14 (static export), React 18, MobX, Tailwind, Jest (ts-jest via next/jest), Playwright for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-23-bulk-first-design.md` (builds on `docs/superpowers/specs/2026-10-23-bulk-mode-design.md`).

## Global Constraints

- Upstream touches allowed: `src/app/page.tsx` (render the bulk page) plus the existing ones (`TopBar.tsx`, `package.json`, `.gitignore`). Everything else is new files or files under `src/bulk/`. Never edit `src/lib/**`, `src/worker/**`, `src/state.tsx`, `InitialLoad.tsx`, `home.tsx`.
- Node 18 for tests and build: `source ~/.nvm/nvm.sh && nvm use 18`, then `node .yarn/releases/yarn-4.9.2.cjs <script>`. Wrangler needs Node 24 (`nvm use 24`).
- Claude can't run git here. Each "Commit" step means: give the user the exact `! git add … && git commit -m "…" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` command, and carry on without waiting.
- Do not run `next build` while the user's `next dev` might be running; if the build fails with `PageNotFoundError: /_document`, ask the user to stop dev and run `! rm -rf .next`.
- Copy (exact): duplicate toast "Added N setup(s), M were already in this preset" / "Those setups are already in this preset"; run-disabled reason "Pick a monster"; dropped-monsters warning "Only one monster per preset now: kept <name>, dropped N".

## Review Focus

1. A stored preset from before this change (with `monsters[]`, possibly empty) loads without error and keeps its first monster — test in Task 3.
2. A preset file exported before this change (`version: 1`) still imports — test in Task 3.
3. Adding the calculator's loadouts twice in a row adds nothing the second time, including when the calculator holds two identical loadouts — test in Task 1.
4. Every default setup loads with no warnings and deals damage — test in Task 2.
5. Navigating calculator → bulk → calculator still starts the calculator once (no "already set" console warnings) — browser check in Task 5.

---

### Task 1: Duplicate-free setup adding

**Files:**
- Create: `src/bulk/lib/dedupe.ts`
- Modify: `src/bulk/state/BulkStore.ts` (`addSetups`)
- Modify: `src/bulk/components/SetupList.tsx` (toasts use the result)
- Test: `src/tests/bulk/dedupe.test.ts`, `src/tests/bulk/BulkStore.test.ts`

**Interfaces:**
- Produces: `setupKey(player: Player): string` — equal keys ⇔ the setups calculate identically. Built from: equipment item id per slot (null → `null`), `skills`, `boosts`, `prayers` (sorted), `style` (name + type + stance), `spell?.name ?? null`, and `buffs` (with `potions` sorted). Excludes `name`, `bonuses`, `offensive`, `defensive`, `attackSpeed`.
- Produces: `uniqueNewSetups(candidates: BulkSetup[], existing: BulkSetup[]): BulkSetup[]` — candidates whose key isn't in `existing` nor earlier in `candidates`.
- Produces: `BulkStore.addSetups(setups: BulkSetup[]): { added: number; skipped: number }`.

- [ ] **Step 1: Write failing tests** in `dedupe.test.ts`:
  - `same gear and settings with a different name is a duplicate`: two `generateEmptyPlayer` players with different names and the same weapon → equal `setupKey`.
  - `a different prayer, style or item is not a duplicate`: change each in turn → different key.
  - `prayer order doesn't matter`: `[PIETY, X]` vs `[X, PIETY]` → equal key.
  - `uniqueNewSetups drops setups already present and repeats within the batch`: existing `[A]`, candidates `[A', B, B']` (primes = same settings, new ids/names) → `[B]`.
  And in `BulkStore.test.ts`:
  - `adding the same setups twice adds them once`: `addSetups([A, B])` → `{added: 2, skipped: 0}`; again with fresh ids → `{added: 0, skipped: 2}`; `active.setups.length === 2`.
- [ ] **Step 2: Run** `node .yarn/releases/yarn-4.9.2.cjs jest src/tests/bulk --coverage=false` — expect the new tests to FAIL (module missing / wrong return).
- [ ] **Step 3: Implement** `dedupe.ts` and change `addSetups` to filter through `uniqueNewSetups`, push the rest, `touch` only if something was added, and return the counts.
- [ ] **Step 4: Update `SetupList.tsx`** so all three add paths (all loadouts, selected loadout, share link) show the toast copy from Global Constraints from the returned counts (`toast.info` when nothing was added).
- [ ] **Step 5: Run** bulk tests — all PASS; `npx eslint src/bulk src/tests/bulk` — no errors.
- [ ] **Step 6: Commit** — `feat(bulk): never add duplicate setups`.

### Task 2: Default max setups

**Files:**
- Create: `src/bulk/lib/defaultSetups.ts`
- Modify: `src/bulk/state/BulkStore.ts` (`createPreset`, new `addDefaultSetups`)
- Modify: `src/bulk/components/SetupList.tsx` ("Add max setups" button)
- Test: `src/tests/bulk/defaultSetups.test.ts`, `src/tests/bulk/BulkStore.test.ts`

**Interfaces:**
- Consumes: `migrateImportable` (presetIO), `addSetups` (Task 1), `computeRow` (compute.ts), `PotionMap` and `getCombatStylesForCategory` from `@/utils`, `Prayer` from `@/enums/Prayer`, `Potion` from `@/enums/Potion`.
- Produces: `DEFAULT_SETUP_NAMES: string[]` = `['Max scythe', 'Max scythe inquisitor', 'Max range', 'Max range void', 'Max range blowpipe', 'Max shadow', 'Max ayak', 'Max harm wind surge', 'Max harm water surge', 'Max harm earth surge', 'Max harm fire surge']`.
- Produces: `defaultSetups(): { setups: BulkSetup[]; warnings: string[] }` — fresh ids each call.
- Produces: `BulkStore.addDefaultSetups(): { added: number; skipped: number }`.

- [ ] **Step 1: Write failing tests** in `defaultSetups.test.ts`:
  - `default setups load in order with no warnings`: names equal `DEFAULT_SETUP_NAMES`; `warnings` equal `[]`.
  - `each default setup has its weapon, prayer, style and boost`: e.g. Max scythe weapon id 22325, `prayers` contains `Prayer.PIETY`, style name `Chop`, `boosts.str > 0`; Max scythe inquisitor head id 24419 and style `Jab`; Max range weapon 20997 and style `Rapid` and `prayers` contains `RIGOUR`; Max ayak shield id 27251 and `prayers` contains `AUGURY`, `boosts.magic > 0`; Max range blowpipe weapon 12926 with `itemVars.blowpipeDartId === 11230`; Max harm fire surge weapon 24423, shield 27251, `spell.name === 'Fire Surge'` (and likewise Wind/Water/Earth).
  - `every default setup damages a standard monster`: `computeRow` against `monsterFromSearch(<Abyssal demon, id 415>)` → `dps > 0` and no `error` for each.
  And in `BulkStore.test.ts`:
  - update `load creates a default preset` to also expect `active.setups.map(s => s.name)` to equal `DEFAULT_SETUP_NAMES`.
  - `addDefaultSetups restores deleted defaults only`: remove 'Max range', call → `{added: 1, skipped: 10}`.
- [ ] **Step 2: Run** bulk tests — new tests FAIL.
- [ ] **Step 3: Implement `defaultSetups.ts`**: a table of the eleven setups from the spec (item ids copied from upstream's MAX_MELEE / MAX_RANGED / VOID_RANGED / MAX_MAGE presets plus the spec's weapon/off-hand/armour changes; shield `null` for 2H weapons), each built on `generateEmptyPlayer(name)` with `style` picked by name from `getCombatStylesForCategory(weapon.category)`, one prayer, `buffs.potions = [potion]` and `boosts` from `PotionMap[potion].calculateFn(skills)`; equipment given as `{ id }` objects so `migrateImportable` re-resolves them. Run them through `migrateImportable` with `serializationVersion: IMPORT_VERSION` and any monster (as `loadPreset` does).
- [ ] **Step 4: Wire the store**: `createPreset` adds `defaultSetups().setups` (and appends any warnings to `this.warnings`); `addDefaultSetups` calls `addSetups(defaultSetups().setups)`.
- [ ] **Step 5: Add the "Add max setups" button** to the Setups panel actions, toasting from the counts like Task 1.
- [ ] **Step 6: Run** bulk tests — all PASS (fix the data table, not the tests, if an item or style name is off).
- [ ] **Step 7: Commit** — `feat(bulk): start new presets with max setups`.

### Task 3: One target monster per preset

**Files:**
- Modify: `src/bulk/types.ts` (`BulkPreset.monster: BulkMonster | null` replaces `monsters`)
- Modify: `src/bulk/lib/presetIO.ts` (`loadPreset`, `presetToJson`, `presetFromJson`; `FILE_VERSION = 2`)
- Modify: `src/bulk/state/BulkStore.ts` (`canRun`, `setMonster` replaces `addMonster`/`removeMonster`)
- Rename/rewrite: `src/bulk/components/MonsterList.tsx` → `src/bulk/components/MonsterPicker.tsx`
- Modify: `src/bulk/lib/table.ts` (drop `monsterId` option), `src/bulk/lib/format.ts` (`rowsToCsv(rows, setups)`), `src/bulk/components/BulkTable.tsx` (drop Monster column and `monsters` prop), `src/bulk/components/BulkPage.tsx` (drop filter; reaction key uses `monster?.id`; run with `[monster]`; CSV file name includes `monsterLabel`)
- Test: `src/tests/bulk/presetIO.test.ts`, `BulkStore.test.ts`, `table.test.ts`, `format.test.ts`, `BulkTable.test.tsx`

**Interfaces:**
- Produces: `BulkPreset.monster: BulkMonster | null`.
- Produces: `loadPreset(raw: BulkPreset | LegacyBulkPreset)` where `LegacyBulkPreset = Omit<BulkPreset, 'monster'> & { monsters: BulkMonster[] }`; returns the new shape.
- Produces: `BulkStore.setMonster(m: BulkMonster | null): void`; `canRun` reason `'Pick a monster'` when `monster` is null.
- Produces: `runKey(preset: BulkPreset | null): string | null` in `src/bulk/lib/table.ts` — `null` when the preset can't run, else a string that changes exactly when the target id or the setup id list changes (drives auto-run).
- Produces: `selectRows(rows, { mode, sort })`, `rowsToCsv(rows, setups)`.

- [ ] **Step 1: Write failing tests**:
  - presetIO `legacy preset keeps its first monster`: the existing v10 fixture (two monsters) → `preset.monster.id === 'monster-abyssal'`, warnings contain `Only one monster per preset now: kept Abyssal demon, dropped 1`.
  - presetIO `legacy preset with no monsters loads with monster null` and no warning.
  - presetIO `legacy preset whose first monster is invalid keeps the next valid one`.
  - presetIO `version 1 export file imports` (fixture file as-is through `presetFromJson`, then `loadPreset`) and `round trip writes version 2 with monster`.
  - store `canRun asks for a monster`: setups present, `monster` null → `{ ok: false, reason: 'Pick a monster' }`; after `setMonster(abyssal())` → ok.
  - store `stored legacy presets load` (write a `monsters[]` preset straight into `MemoryStorage`, then `load()`).
  - table/format/BulkTable: update existing tests to the new signatures; `rowsToCsv` header has no `Monster` column.
  - table `runKey`: `null` without a monster or without setups; changes when a setup is added/removed or the target changes; unchanged when a setup is renamed.
- [ ] **Step 2: Run** bulk tests — new tests FAIL (type errors count as failing).
- [ ] **Step 3: Implement** the type, presetIO and store changes. In `loadPreset`, normalise `raw.monster ?? raw.monsters` to a candidate list, migrate in order until one succeeds, warn as above when more than one was present.
- [ ] **Step 4: Implement `MonsterPicker.tsx`**: the existing `Combobox` (same options and labels as `MonsterList`) whose selection calls `setMonster`; shows the current target with `monsterLabel` and `summarizeInputs` chips; keeps "Use calculator's monster" (with the try/catch toast); a clear (×) button sets `null`. Swap it into `BulkPage` and delete `MonsterList.tsx`.
- [ ] **Step 5: Update table/format/BulkTable/BulkPage** as listed in Files. In `BulkPage`, replace the clear-results reaction and the Run button with auto-run: a MobX reaction on `runKey(store.active)` (`fireImmediately: true`, `delay: 300`) that runs the pool when the key is non-null and clears results when it is null. Keep the Cancel button while running and the "Stopped after N of M results." note. With no target, show "Pick a monster" in place of the table.
- [ ] **Step 6: Run** bulk tests, `npx eslint src/bulk src/tests/bulk`, `npx tsc --noEmit -p .` — all clean.
- [ ] **Step 7: Commit** — `feat(bulk): one target monster per preset`.

### Task 4: Bulk tool at `/`, calculator at `/calc`, obvious round trip

**Files:**
- Create: `src/bulk/components/BulkRoot.tsx` (the current contents of `src/app/bulk/page.tsx`: `BulkPage` + tooltips + `ToastContainer`)
- Modify: `src/app/page.tsx` (upstream touch: render `BulkRoot`)
- Create: `src/app/calc/page.tsx` (renders upstream `Home` exactly as the old `src/app/page.tsx` did)
- Modify: `src/app/bulk/page.tsx` (client redirect to `/` with `useRouter().replace('/')`)
- Modify: `src/bulk/components/BulkNavLink.tsx`
- Modify: `src/bulk/components/SetupList.tsx` (build-a-setup link, empty state, calculator banner)
- Create: `src/bulk/lib/calculatorLoadouts.ts`
- Test: `src/tests/bulk/calculatorLoadouts.test.ts`

**Interfaces:**
- Consumes: `uniqueNewSetups` (Task 1), `fromCalculatorState`, `readCalculatorState` (presetIO).
- Produces: `newCalculatorSetups(state: ImportableData | null, existing: BulkSetup[]): BulkSetup[]` — the calculator's loadouts that have at least one equipped item and aren't in `existing` (empty for null state or no loadouts; returns `[]` instead of throwing when the state can't be migrated).
- Produces: `hasGear(player: Player): boolean` in the same file, also used by `SetupList`'s "Add all calculator loadouts" / "Add selected loadout" to skip gearless loadouts.
- Produces: `CALC_PATH = '/calc'` exported from `BulkNavLink.tsx`.

- [ ] **Step 1: Write failing tests** in `calculatorLoadouts.test.ts`:
  - `counts only loadouts not already in the preset`: state with two loadouts, one already added → length 1.
  - `null or empty state gives none`, `unmigratable state gives none` (e.g. `{ loadouts: [null] }`).
  - `gearless loadouts are ignored`: the calculator's blank default loadout → none.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `calculatorLoadouts.ts`. **Step 4: Run** — PASS.
- [ ] **Step 5: Routes**: create `BulkRoot`, point `src/app/page.tsx` at it, add `src/app/calc/page.tsx`, turn `src/app/bulk/page.tsx` into the redirect.
- [ ] **Step 6: Nav**: `BulkNavLink` on `/calc` → `<Link href="/">` "Back to bulk tool" (icon `IconTable`); anywhere else → full-page `<a href={`${NEXT_PUBLIC_BASE_PATH || ''}${CALC_PATH}`}>` "Build setups in the calculator" (icon `IconCalculator`); keep the comment about the calculator's once-only start-up.
- [ ] **Step 7: Setups panel**: a prominent "Build a new setup" link (same full-page href) in the panel header; empty state "No setups yet. Build one in the calculator, then come back and add it."; on mount and window focus, `readCalculatorState()` → `newCalculatorSetups(...)`; when non-empty show a banner "N calculator loadout(s) aren't in this preset" with an "Add them" button calling `addSetups` and toasting per Task 1, and a dismiss (×) that hides it until the list of new loadouts changes (component state, keyed by the joined `setupKey`s; not stored).
- [ ] **Step 8: Run** full suite `node .yarn/releases/yarn-4.9.2.cjs test`, lint, `build-cf` — all pass/clean.
- [ ] **Step 9: Commit** — `feat: bulk tool is the homepage, calculator at /calc`.

### Task 5: Docs and browser check

**Files:**
- Modify: `BULK.md` (routes, dev URLs `http://localhost:3000/osrs-dps/` and `/osrs-dps/calc`, upstream-touch list incl. `src/app/page.tsx`), `PROGRESS.md` (status)

- [ ] **Step 1: Browser check** (headless Chromium via Playwright against `npx wrangler@4 dev` on `build-cf` output, fresh browser profile):
  - `/` shows the bulk tool with the eleven default setups and "Pick a monster"; pick Vorkath from the drop-down → 11 rows appear without pressing anything, no Monster column; reload → rows come back on their own.
  - Click "Build setups in the calculator" → calculator at `/calc` loads; no banner yet (its blank loadout is ignored). In the calculator pick the "Max Melee" equipment preset and a weapon; "Back to bulk tool" → banner shows 1 loadout; "Add them" → 12 setups and 12 rows; banner gone; "Add all calculator loadouts" again → "Those setups are already in this preset".
  - Go to the calculator again → no `already set` console warnings; `/bulk` redirects to `/`.
  - Zero console errors overall.
- [ ] **Step 2: Update** `BULK.md` and `PROGRESS.md`.
- [ ] **Step 3: Commit** — `docs: bulk-first redesign`.
