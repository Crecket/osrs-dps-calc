# Best Setup Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/best` page that finds the highest-DPS setup per combat style for one monster, searching all items, with the best prayer and potions picked automatically.

**Architecture:** Pure, worker-safe search code in `src/best/lib/` (candidates, activity test, search) runs per weapon job inside web workers through a generic pool extracted from the bulk tool's `BulkPool`. The main thread builds the base player per style, plans weapon jobs, merges the per-weapon top results, then computes full rows for the winners with the existing `computeRow`, shown in the existing `BulkTable`.

**Tech Stack:** Next.js 14 (static export), React 18, MobX, Tailwind, Jest, TypeScript. Path alias `@/` → `src/`.

**Spec:** `docs/superpowers/specs/2026-10-24-best-setup-design.md`

**Scope of this plan:** spec build-order steps 1–2 (special-effect list + coverage test; single-monster search with "all items", best prayer/potion, conditions). Not in this plan: item pool / bank import, level requirements, incremental cache, group mode (each gets its own plan).

## Global Constraints

- No edits to `src/lib/**`, `src/worker/**`, or `src/state.tsx`. Upstream files touched by this plan: none besides what bulk mode already touches (`TopBar` renders `BulkNavLink`; this plan only edits `BulkNavLink`).
- Code under `src/best/**` and `src/bulk/**` that runs in a worker must not import `@/state`, React, or anything under `src/app` (same rule as `src/bulk/lib/compute.ts`).
- Every number shown for a result comes from `computeRow` (`src/bulk/lib/compute.ts`).
- Search ranks by DPS (`PlayerVsNPCCalc#getDps`); TTK and spec only for the final top N rows.
- Combat condition defaults: not on slayer task, not in wilderness, Charge off, Mark of Darkness off, Forinthry surge off, Kandarin diary on, Soulreaper stacks 5, current HP = max HP.
- Commit messages: one short line, no body, no attribution lines (user's global instruction).
- Tests go in `src/tests/best/`. Run single files with `yarn jest <path> --coverage=false`. Typecheck: `yarn tsc --noEmit -p .`. Lint: `yarn lint-fast <files>`.

## Review Focus

1. A monster where a special-effect item must win (undead → Salve (ei); demon → Arclight for stab/slash) — the activity test must keep it. Test in Task 4.
2. Two-handed weapons must never be combined with a shield, and a one-hander's best result should include a shield when one helps. Test in Task 3.
3. Ranged weapons with required ammo must only be paired with valid ammo (`ammoApplicability` INCLUDED); weapons that take no ammo (blowpipe, bowfa) must not get ammo bonuses. Test in Task 3.
4. Changing an input mid-run cancels the old run and its late results never reach the table. Test in Task 6.
5. A style with no usable weapon (e.g. magic when the engine returns 0 DPS for every pairing) shows "no setup found" for that style instead of an error or an empty table. Test in Task 6.

---

### Task 1: Special-effect items list + coverage test

**Files:**
- Create: `src/best/lib/effectItems.ts`
- Test: `src/tests/best/effectItems.test.ts`

**Interfaces:**
- Produces: `EFFECT_ITEM_NAMES: ReadonlySet<string>` (canonical item names the engine treats specially), `EFFECT_NAME_PATTERNS: readonly RegExp[]` (for the engine's substring/prefix checks: `Keris`, `of Vitur` (case-insensitive), `Virtus`, `Seeking`, `Bow of Faerdhinen`, Blood Moon pieces, crystal armour, etc.), `isEffectItem(piece: EquipmentPiece): boolean` (true if the canonical item's name is in the set or matches a pattern, or its category is one the engine branches on: crossbows with enchanted bolts are covered by ammo names; pickaxes, polearms, salamanders, chinchompas, powered staves by `EquipmentCategory`).

- [ ] **Step 1: Write the failing coverage test**

The test reads every `.ts` file under `src/lib/` with `fs`, extracts all single-quoted and double-quoted string literals, and:
- `test('every equipment name the engine mentions is an effect item')`: for each literal that equals the `name` of some item in `availableEquipment`, expect `isEffectItem(thatItem)` to be true. Report all misses in one failure message (`expect(missing).toEqual([])`).
- `test('every substring check on names is covered')`: for each literal passed to `.includes(`, `.startsWith(` or `.endsWith(` (regex `/\.(includes|startsWith|endsWith)\(\s*['"]([^'"]+)['"]/g`) that is a substring of at least one equipment name but not a full name, expect some item containing it to satisfy `isEffectItem`.
- `test('plain items are not effect items')`: `isEffectItem` is false for `Amulet of fury`, `Barrows gloves`, `Dragon boots`, `Primordial boots`. (If the engine turns out to mention one of these by name, the first test wins: replace it with another unmentioned item.)
- `test('known effect items are flagged')`: true for `Salve amulet(ei)`, `Slayer helmet (i)`, `Void knight top`, `Inquisitor's great helm`, `Obsidian helmet`, `Crystal helm`, `Blood Moon helm`, `Arclight`, `Dragon hunter lance`, `Keris partisan of breaching`, `Amulet of avarice`.

Use `findEquipment` from `@/tests/utils/TestUtils` for lookups (check exact names/versions in `cdn/json/equipment.json` first; several items need a version argument).

- [ ] **Step 2: Run it and confirm it fails** — `yarn jest src/tests/best/effectItems.test.ts --coverage=false` → FAIL, module not found.

- [ ] **Step 3: Implement `src/best/lib/effectItems.ts`**

Build the list from the report of engine checks in the spec ("What the engine decides by name"). `isEffectItem` uses `getCanonicalItem` from `@/lib/Equipment` before matching. Iterate: run the test, add each reported miss, until green. Keep entries grouped with a one-line comment per group (set effects, monster-type bonuses, slot interactions, speed changes, special hit distributions).

- [ ] **Step 4: Run the test** → PASS. Also `yarn lint-fast src/best/lib/effectItems.ts src/tests/best/effectItems.test.ts`.

- [ ] **Step 5: Commit** — `git add src/best/lib/effectItems.ts src/tests/best/effectItems.test.ts && git commit -m "Add best setup effect items list with engine coverage test"`

---

### Task 2: Search inputs: prayers, potions, conditions, base player

**Files:**
- Create: `src/best/types.ts`, `src/best/lib/loadout.ts` (worker-safe), `src/best/lib/basePlayer.ts` (main thread only; may import `@/state`)
- Test: `src/tests/best/loadout.test.ts`

**Interfaces:**
- Produces in `src/best/types.ts`:
  ```ts
  export type BestStyle = 'stab' | 'slash' | 'crush' | 'ranged' | 'magic';
  export const BEST_STYLES: BestStyle[];
  export interface PrayerUnlocks { prayerLevel: number; piety: boolean; rigour: boolean; augury: boolean; deadeye: boolean; mysticVigour: boolean; zeal: boolean }
  export interface CombatConditions { onSlayerTask: boolean; inWilderness: boolean; chargeSpell: boolean; markOfDarknessSpell: boolean; forinthrySurge: boolean; kandarinDiary: boolean; soulreaperStacks: number; currentHp: number | null /* null = max */ }
  export interface BestInputs { skills: PlayerSkills; unlocks: PrayerUnlocks; conditions: CombatConditions; potions: Partial<Record<'melee'|'ranged'|'magic', Potion[]>>; styles: BestStyle[]; topN: number }
  export const DEFAULT_CONDITIONS: CombatConditions; // values from Global Constraints
  export const DEFAULT_UNLOCKS: PrayerUnlocks; // prayerLevel 99, all true
  ```
- Produces in `loadout.ts`: `bestPrayers(style: BestStyle, unlocks: PrayerUnlocks, defLevel: number): Prayer[]`, `defaultPotions(style: BestStyle): Potion[]`.
- Produces in `basePlayer.ts`: `basePlayer(inputs: BestInputs, style: BestStyle): Player` — `generateEmptyPlayer()`, skills from inputs, `prayers` from `bestPrayers`, potions (inputs override, else `defaultPotions`) with boosts via `potionBoosts` from `@/bulk/lib/filters`, buffs from conditions, empty equipment.

- [ ] **Step 1: Failing tests** in `loadout.test.ts`:
  - `bestPrayers('slash', DEFAULT_UNLOCKS, 99)` → `[Prayer.ZEAL]`; with `zeal: false` → `[Prayer.PIETY]`; with `piety: false, zeal: false` → `[Prayer.ULTIMATE_STRENGTH, Prayer.INCREDIBLE_REFLEXES]`; with prayerLevel 1 → `[]`.
  - `bestPrayers('ranged', …)` → `[Prayer.RIGOUR]`; rigour off → `[Prayer.DEADEYE]`; both off → `[Prayer.EAGLE_EYE]`; prayerLevel 43 → `[Prayer.HAWK_EYE]`.
  - `bestPrayers('magic', …)` → `[Prayer.AUGURY]`; augury off → `[Prayer.MYSTIC_VIGOUR]`; both off → `[Prayer.MYSTIC_MIGHT]`.
  - Defence gates: Piety needs 70 Def, Chivalry 65 Def, Rigour/Augury 70 Def — `bestPrayers('slash', {…, zeal:false}, 69)` → `[Prayer.CHIVALRY]`.
  - `defaultPotions`: melee styles → `[Potion.SUPER_COMBAT]`, ranged → `[Potion.RANGING]`, magic → `[Potion.SATURATED_HEART]`.
  - `basePlayer(inputs, 'ranged')`: `prayers` equals `[Prayer.RIGOUR]`, `buffs.onSlayerTask === false`, `boosts.ranged === 13` for 99 ranged with ranging potion, every equipment slot null.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Prayer levels (verify each against its Wiki page before committing): Sharp Eye 8, Mystic Will 9, Burst of Strength 4, Clarity of Thought 7, Superhuman Strength 13, Improved Reflexes 16, Hawk Eye 26, Mystic Lore 27, Ultimate Strength 31, Incredible Reflexes 34, Eagle Eye 44, Mystic Might 45, Chivalry 60, Deadeye 62, Mystic Vigour 63, Piety 70, Rigour 74, Augury 77, Zeal 84. Ranking per group: melee Zeal > Piety > Chivalry > best arm+brain pair; ranged Rigour > Deadeye > Eagle Eye > Hawk Eye > Sharp Eye; magic Augury > Mystic Vigour > Mystic Might > Mystic Lore > Mystic Will. `piety` unlock covers Chivalry too.

- [ ] **Step 4: Run** → PASS; lint the new files.

- [ ] **Step 5: Commit** — `git commit -m "Add best setup inputs: prayers, potions, conditions"`

---

### Task 3: Candidates: per-style scores, dominance pruning, weapon jobs

**Files:**
- Create: `src/best/lib/candidates.ts` (worker-safe)
- Test: `src/tests/best/candidates.test.ts`

**Interfaces:**
- Consumes: `isEffectItem` (Task 1), `BestStyle` (Task 2).
- Produces:
  ```ts
  export type GearSlot = Exclude<keyof PlayerEquipment, 'weapon'>;
  export const styleScore: (item: EquipmentPiece, style: BestStyle) => [attack: number, strength: number];
  // stab/slash/crush → [offensive[style], bonuses.str]; ranged → [offensive.ranged, bonuses.ranged_str]; magic → [offensive.magic, bonuses.magic_str]
  export const paretoFront: (items: EquipmentPiece[], style: BestStyle) => EquipmentPiece[];
  // keeps items no other item matches-or-beats on both numbers; ties keep the first by id
  export const slotCandidates: (pool: EquipmentPiece[], style: BestStyle, slot: GearSlot) => { plain: EquipmentPiece[]; effect: EquipmentPiece[] };
  export interface WeaponJob { style: BestStyle; weaponId: number; combatStyle: PlayerCombatStyle; ammoId: number | null; spellName: string | null; dartId: number | null }
  export const weaponJobs: (pool: EquipmentPiece[], style: BestStyle) => WeaponJob[];
  ```
- `pool` is the list of allowed items (this plan: `availableEquipment`, canonical items only — filter with `getCanonicalItemId(e.id) === e.id`).

- [ ] **Step 1: Failing tests:**
  - `styleScore(findEquipment('Torva full helm','Restored'), 'slash')` equals `[torva.offensive.slash, torva.bonuses.str]`.
  - `paretoFront` on three synthetic items `[ [5,5], [4,4], [6,1] ]` (build via `{...findEquipment('Abyssal whip'), id: n, offensive: {...}, bonuses: {...}}`) keeps `[5,5]` and `[6,1]`.
  - `slotCandidates(pool, 'slash', 'head').plain.length` ≤ 5 and `.effect` contains a slayer helmet (i); `.plain` never contains an effect item.
  - `weaponJobs(pool, 'slash')`: every job's `combatStyle.type === 'slash'`; includes the Scythe of Vitur (Charged) with each of its slash stances; never a job for a magic-only weapon.
  - `weaponJobs(pool, 'ranged')`: every job with a weapon listed in `ammoForRangedWeapons` has `ammoApplicability(weaponId, ammoId) === AmmoApplicability.INCLUDED`; Toxic blowpipe jobs have `ammoId === null` and a `dartId`; Bow of faerdhinen (c) jobs have `ammoId === null`.
  - `weaponJobs(pool, 'magic')`: powered staves (Tumeken's shadow) have `spellName === null`; a standard staff has jobs for the strongest spell of each element (`Wind/Water/Earth/Fire Surge`) and the ancient `* Barrage` spells, plus god spells/Iban Blast/Magic Dart/Crumble Undead/demonbane/grasp spells.
  - Two-handed: no `WeaponJob` field carries a shield; Task 4 tests the shield rule.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Weapons: keep every effect weapon; dominance-prune plain weapons separately for one-handed and two-handed on `(attack, strength, -speed)` (three-way dominance). Stances: every `getCombatStylesForCategory(category)` entry whose `type` matches the style (for magic: entries with `type === 'magic'`, preferring `Autocast` over `Defensive Autocast`, plus the built-in styles of powered staves). Ammo: for weapons in `ammoForRangedWeapons` with a non-empty list, the Pareto front (ranged style) of their valid ammo plus valid effect ammo; weapons not in the map or with an empty list get `ammoId: null`. Darts: blowpipe ids (`BLOWPIPE_IDS` in `@/lib/constants`) get one job per dart on the dart Pareto front. Spells: from `spells` in `@/types/Spell` — per element the highest `max_hit` standard spell, per ancient element the barrage, and every spell whose name the engine checks by name (god spells, Iban Blast, Magic Dart, Crumble Undead, demonbane and grasp spells); skip binds and curses (`max_hit === 0`).

- [ ] **Step 4: Run** → PASS; lint.

- [ ] **Step 5: Commit** — `git commit -m "Add best setup candidate pruning and weapon jobs"`

---

### Task 4: Per-weapon search: activity test, descent, exhaustive

**Files:**
- Create: `src/best/lib/search.ts` (worker-safe)
- Test: `src/tests/best/search.test.ts`

**Interfaces:**
- Consumes: Task 3 exports; `preparePlayer` from `@/bulk/lib/compute`; `PlayerVsNPCCalc`.
- Produces:
  ```ts
  export type Gear = Partial<Record<GearSlot, number | null>>; // item ids; null = empty
  export interface SearchResult { job: WeaponJob; gear: Gear; dps: number; approximate: boolean }
  export const buildPlayer: (base: Player, job: WeaponJob, gear: Gear) => Player; // equips by id, sets style/spell/dart itemVars, empties shield for two-handers
  export const evalDps: (base: Player, monster: Monster, job: WeaponJob, gear: Gear) => number; // 0 on any thrown error
  export const plainTwin: (item: EquipmentPiece) => EquipmentPiece; // same stats, id -1000000 - item.id, name `__plain ${item.id}`
  export const activeEffects: (base: Player, monster: Monster, job: WeaponJob, baseline: Gear, effect: Partial<Record<GearSlot, EquipmentPiece[]>>) => Partial<Record<GearSlot, EquipmentPiece[]>>;
  export const searchWeapon: (base: Player, monster: Monster, job: WeaponJob, pool: EquipmentPiece[], opts: { mode: 'descent' | 'exhaustive'; topN: number; cap: number }) => SearchResult[];
  ```

- [ ] **Step 1: Failing tests** (use `getTestMonster` and `basePlayer` from Task 2 with `DEFAULT_*` inputs):
  - `evalDps` for the Scythe job (Chop) with Torva + Rancour + Ultor equals `computeRow` DPS for the same player (to 10 decimals).
  - `buildPlayer` with a two-handed weapon and `gear.shield` set → `equipment.shield === null`.
  - `plainTwin(salveEi)` against a vampyre-free undead monster (e.g. `Vorkath`) gives lower DPS than the real Salve (ei) in the neck; against `Abyssal demon` the DPS is equal.
  - `activeEffects` against `Abyssal demon` (slash, Scythe) does **not** keep Salve (ei); against `Vorkath` it does.
  - Sets: crush vs `General Graardor` with the Inquisitor's mace job: the full inquisitor set is kept as active.
  - `searchWeapon(..., { mode: 'exhaustive', topN: 3 })` for Scythe vs `Vorkath` returns 3 results sorted by DPS desc, the first has Salve (ei) in the neck.
  - `searchWeapon` for Scythe vs `Abyssal demon` with `onSlayerTask: true` puts a slayer helmet (i) on the head.
  - `searchWeapon` for a one-handed weapon (Ghrazi rapier, Lunge) returns gear with a shield (Avernic defender or better) against `Abyssal demon`.
  - `mode: 'exhaustive'` with a tiny `cap` (e.g. 10) returns `approximate: true`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** Baseline gear = per slot the plain candidate with the highest `attack + strength` for the style (shield empty for two-handers). Activity test: for each effect item, DPS of baseline with the item vs with its `plainTwin`; keep it as an effect candidate if real > twin (strictly, with 1e-9 tolerance); otherwise add it to that slot's plain list and re-run `paretoFront` on that slot. Sets: test each set from a `SETS` table in `effectItems.ts` (add it there in this task: void/elite void per style, inquisitor, obsidian, crystal, barrows sets, Blood Moon, Virtus) by equipping all its pieces at once vs all-twins; an active set is kept as a unit — its pieces stay candidates in their slots even if individually inactive. Descent: start from baseline, loop over slots trying every candidate (plain ∪ active effect ∪ empty), keep the best, until a full pass improves nothing; also try each active set as one move. Exhaustive: if the product of per-slot candidate counts ≤ `cap`, enumerate all and keep the top `topN` distinct by DPS; else return the descent result with `approximate: true`. Return results sorted by DPS desc.

- [ ] **Step 4: Run** → PASS; lint.

- [ ] **Step 5: Commit** — `git commit -m "Add best setup per-weapon search with effect activity test"`

---

### Task 5: Generic task pool + best worker

**Files:**
- Create: `src/bulk/worker/TaskPool.ts`, `src/best/worker/protocol.ts`, `src/best/worker/bestWorker.ts`, `src/best/worker/createBestWorker.ts`
- Modify: `src/bulk/worker/BulkPool.ts` (becomes a thin wrapper over `TaskPool`; public API and `src/tests/bulk/BulkPool.test.ts` unchanged)
- Test: `src/tests/best/TaskPool.test.ts`, `src/tests/best/protocol.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // TaskPool.ts — the chunk queue, worker lifecycle, cancellation, crash handling and progress throttling now in BulkPool, generic over payloads
  export interface TaskChunk<P> { runId: number; chunkId: number; payload: P }
  export interface TaskResult<R> { runId: number; chunkId: number; results: R[] }
  export class TaskPool<P, R> {
    constructor(opts: { createWorker: () => WorkerLike; size?: number; progressInterval?: number });
    run(payloads: P[], onProgress: (p: { results: R[]; done: number; total: number }) => void, count?: (p: P) => number): Promise<R[]>; // results in payload order
    cancel(): void; shutdown(): void;
  }
  // best protocol
  export interface BestSearchPayload { base: Player; monster: Monster; jobs: WeaponJob[]; mode: 'descent' | 'exhaustive'; topN: number; cap: number }
  export const handleBestChunk: (p: BestSearchPayload) => SearchResult[]; // pool = canonical availableEquipment, built once per worker
  ```
- `WorkerLike` stays exported from `BulkPool.ts` (re-exported from `TaskPool.ts`).

- [ ] **Step 1: Failing tests:** `TaskPool.test.ts` ports the BulkPool tests' fake-worker pattern (see `src/tests/bulk/BulkPool.test.ts`): results come back in payload order with out-of-order workers; `cancel()` rejects the run with `Error('cancelled')` and ignores late responses; a worker crash during a run rejects it; progress `done` counts results. `protocol.test.ts`: `handleBestChunk` for one Scythe job vs `Vorkath` returns the same first result as `searchWeapon` directly.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `TaskPool` by moving BulkPool's internals; `BulkPool.run` builds its chunks as payloads and maps results. `bestWorker.ts` mirrors `bulkWorker.ts` (JSON with `WORKER_JSON_REPLACER/REVIVER`).
- [ ] **Step 4: Run** `yarn jest src/tests/bulk src/tests/best --coverage=false` → all PASS; `yarn tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** — `git commit -m "Extract generic task pool and add best setup worker"`

---

### Task 6: Run orchestration

**Files:**
- Create: `src/best/lib/run.ts` (main thread)
- Test: `src/tests/best/run.test.ts`

**Interfaces:**
- Consumes: `basePlayer` (Task 2), `weaponJobs` (Task 3), `buildPlayer` (Task 4), `TaskPool` + protocol (Task 5), `BulkPool` and `BulkSetup`/`BulkRow` from `src/bulk`.
- Produces:
  ```ts
  export interface StyleOutcome { style: BestStyle; setups: BulkSetup[]; rows: BulkRow[]; approximate: boolean; message: string | null /* e.g. 'No usable magic setup found' */ }
  export interface BestRunDeps { search: Pick<TaskPool<BestSearchPayload, SearchResult>, 'run' | 'cancel'>; rows: Pick<BulkPool, 'run' | 'cancel'> }
  export const runBestSetup: (inputs: BestInputs, monster: BulkMonster, deps: BestRunDeps, onProgress: (done: number, total: number) => void) => Promise<StyleOutcome[]>;
  export const TOP_K_WEAPONS = 15; export const COMBINATION_CAP = 20000;
  ```
- Setup names: `${weapon name} (${combat style name})`, plus ` + ${spell}` / ` + ${ammo name}` when set; setup ids `best-${style}-${index}`.

- [ ] **Step 1: Failing tests** (fake deps that call `handleBestChunk`/`computeRow` synchronously):
  - vs `Vorkath` with defaults: one `StyleOutcome` per `inputs.styles` entry, each with ≤ `topN` setups sorted by `rows[i].dps` desc, and `rows[i].dps` equal to `computeRow` for `setups[i]`.
  - Two phases: the fake search dep records calls; first call has `mode: 'descent'` with all jobs, second has `mode: 'exhaustive'` with only the top `TOP_K_WEAPONS` jobs per style by phase-1 DPS.
  - A style whose search returns only 0-DPS results gives `setups: []` and `message: 'No usable magic setup found'` (style name lower-case).
  - Calling `runBestSetup` again before the first resolves: the first promise rejects with `Error('cancelled')`; `deps.search.cancel` was called.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Per style: `basePlayer` → `weaponJobs(pool, style)` → phase 1 descent over all jobs (chunk jobs ~8 per payload) → pick top `TOP_K_WEAPONS` jobs → phase 2 exhaustive → merge, sort, dedupe identical gear, keep `topN` → `buildPlayer` → `BulkSetup` → `deps.rows.run(setups, [monster])`. Progress counts jobs across both phases.
- [ ] **Step 4: Run** → PASS; lint.
- [ ] **Step 5: Commit** — `git commit -m "Add best setup run orchestration"`

---

### Task 7: Store and target sync

**Files:**
- Create: `src/best/state/BestStore.ts`
- Modify: `src/bulk/state/TargetSync.ts` (take a small interface instead of `BulkStore`), `src/bulk/components/TargetMonster.tsx` (pass the bulk store through that interface; accept an optional holder prop)
- Test: `src/tests/best/BestStore.test.ts`; existing `src/tests/bulk/TargetSync.test.ts` must still pass

**Interfaces:**
- Produces:
  ```ts
  // TargetSync.ts
  export interface TargetHolder { readonly targetScope: unknown /* changes when a different preset/page is active */; readonly target: BulkMonster | null; setTarget(m: BulkMonster): void; readonly canSave: boolean }
  // BestStore.ts — MobX, saved to localforage key 'dps-best-state', same load/readFailed safety as BulkStore
  export class BestStore implements TargetHolder {
    inputs: BestInputs; monster: BulkMonster | null; loaded: boolean;
    load(): Promise<void>; setSkills(s: Partial<PlayerSkills>): void; setUnlocks(u: Partial<PrayerUnlocks>): void; setConditions(c: Partial<CombatConditions>): void; setStyles(s: BestStyle[]): void; setPotions(group: 'melee'|'ranged'|'magic', p: Potion[] | null): void; setTarget(m: BulkMonster): void;
    get runKey(): string | null; // JSON of inputs + monster, null without a monster
  }
  export const BestStoreContext: React.Context<BestStore>; export const useBestStore: () => BestStore;
  ```
- Defaults: skills all 99 (hp 99), `DEFAULT_UNLOCKS`, `DEFAULT_CONDITIONS`, styles all five, topN 5, potions `{}`.

- [ ] **Step 1: Failing tests:** load with empty storage gives defaults; setters persist (fake storage like `BulkStore.test.ts`); unreadable storage never overwrites; `runKey` changes when a condition changes and is null without a monster.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; refactor `TargetSync` to `TargetHolder` (BulkStore gets the adapter getters: `targetScope = activeId`, `target = active?.monster`, `setTarget = setMonster`, `canSave = !!active`).
- [ ] **Step 4: Run** `yarn jest src/tests/bulk src/tests/best --coverage=false` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add best setup store and make target sync reusable"`

---

### Task 8: The /best page

**Files:**
- Create: `src/app/best/page.tsx`, `src/best/components/BestRoot.tsx`, `src/best/components/BestPage.tsx`, `src/best/components/InputsPanel.tsx`
- Modify: `src/bulk/components/BulkNavLink.tsx`
- Test: `src/tests/best/BestNavLink.test.tsx` (extend the existing `src/tests/bulk/BulkNavLink.test.tsx` cases instead if simpler)

**Interfaces:**
- Consumes: `BestStore` (Task 7), `runBestSetup` (Task 6), `TargetMonster` with a `holder` prop (Task 7), `BulkTable`, `Panel`/`buttonClass`.
- Page layout: left column Inputs panel (skills as number inputs; prayer level + unlock checkboxes; condition checkboxes and Soulreaper stacks / current HP numbers; style toggles; potions per group using the bulk FilterBar's potion picker if it can take a value/onChange, else a simple multi-select), right column target monster (`TargetMonster holder={store}`), below: results — one `Panel` per style titled with the style name, holding a `BulkTable` (`mode 'normal'`, `hasRun`), `approximate` shown as a small "approximate" badge, `message` shown instead of the table. A progress bar and a Stop button while running. Runs automatically on `store.runKey` change (debounced 300 ms via a MobX `reaction` like `BulkPage`).
- Each result row has a "Send to calculator" action reusing the bulk page's existing send path (find it in `SetupList`/`calculatorLoadouts`; reuse, don't copy).
- Nav: `BulkNavLink` shows a "Best setup" link (`IconTrophy`) to `${NEXT_PUBLIC_BASE_PATH}/best` everywhere except on `/best`; on `/best` it shows "Back to bulk tool".

- [ ] **Step 1: Failing test:** nav link renders the Best setup link on `/` and `/calc`, and "Back to bulk tool" on `/best` (mock `usePathname` as the existing test does).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the page and link.
- [ ] **Step 4: Verify:** `yarn jest --coverage=false` all pass; `yarn tsc --noEmit -p .`; `yarn lint-fast` on new/changed files; `yarn build` succeeds (static export includes `/best`); then run the app (`yarn dev`) and check: Vorkath gives a Salve (ei) melee result; toggling "on slayer task" vs Abyssal demon changes the head to a slayer helmet (i); changing a skill mid-run restarts without stale rows.
- [ ] **Step 5: Commit** — `git commit -m "Add best setup page"`
