# Best setup finder for bulk mode — design

Date: 2026-10-24
Repo: `~/Projects/dps-bulk-tool`, branch `bulk-mode` (fork of `weirdgloop/osrs-dps-calc`, upstream merged at `98e4fac3`).
Builds on: `docs/superpowers/specs/2026-10-23-bulk-mode-design.md` (its anti-goals still apply).

## Intent

The user wants GearScape's "Best Setup" feature inside the bulk tool: given a target, find the highest-DPS gear setup, limited to gear the player actually has and can wear. On top of that, a group mode that does this for several bosses at once (mainly raids), so preparing for a raid means one run instead of one per boss.

The point of building it here instead of using GearScape is the engine: results come from the Wiki calculator's own maths (the same numbers as the normal calc and the bulk table), not GearScape's Bitterkoekje-based engine. DPS is what matters; TTK is secondary (user: "the important thing is dps not ttk").

## Goals

1. **Best setup for one monster.** For the chosen monster, find the best setup for each combat style (stab, slash, crush, ranged, magic) and show them ranked by DPS, using the existing bulk results table (gear row, max hit, accuracy, DPS, TTK).
2. **Item pool.** The search only uses allowed items:
   - **All items** (default when no pool is set up).
   - **Bank import**: paste from the RuneLite Bank Memory plugin ("Copy item data to clipboard", TSV `Item id \t Item name \t Item quantity` with a header row). Match on id. **Owning rule (my call):** owning any variant of an item counts as owning the version the calc uses — uncharged/charged, degraded, ornament kits (via `EquipmentAliases` plus a name-based mapping for "(uncharged)"/degraded variants built by the import module). Un-imbued items do **not** count as imbued. Quantity 0 (placeholders) doesn't count. The import shows which bank lines matched nothing, so silent drops are visible.
   - **Manual entries**: add items to, and remove items from, the pool by hand, on top of an import.
   - **Exclude list / locks**: never use an item; force an item into a slot.
3. **Player constraints.**
   - Only gear whose level requirements the player meets (levels from the calc's existing hiscore lookup or entered by hand).
   - **Best available prayer and potion are picked, not searched**: per style, the strongest prayer the player has unlocked (see Prayers below) and the chosen potion set. These are fixed inputs to the search, never a search dimension.
4. **Group mode.** A list of monsters (for raids: a raid preset that fills in the bosses) is run in one go; results show the best setup per style per boss, with the raid inputs (ToA invocation/path, CoX CM, party size) taken from each monster's existing inputs.
5. **Fast and incremental.** A run for one monster finishes in a few seconds in the worker pool. Changing the pool only recomputes the styles that the changed item can affect (user: don't re-run melee when a magic item was added or removed).

## Non-goals (v1)

- A budget / GE price limit. GearScape has one; the user hasn't asked for it. The design shouldn't block adding it later (prices API: `https://prices.runescape.wiki/api/v2/osrs/latest` and `/mapping`).
- A single "one setup that is best across the whole raid" answer. Group mode shows per-boss bests; a combined score can come later.
- Ranking by XP rate, max hit, accuracy, or by defence/prayer bonus as a tiebreak fill (GearScape's "Prayer" fill mode).
- Inventory Setups import and other bank exporters (Bank Memory TSV only in v1; the parser should be one small module so more formats can be added).
- Quest-locked gear (Barrows gloves, Void, etc.): v1 assumes quest requirements are met. Users exclude what they don't have via the pool.
- Special attack optimization (the search ranks by normal DPS; spec numbers are still shown as in the bulk table).
- Defensive results or anything NPC-vs-player.

## Anti-goals

- Editing the calc engine (`src/lib/**`) or other upstream files beyond a tiny listed set. All optimizer code lives under `src/bulk/**`. Upstream merges must stay clean (same rule as bulk mode).
- A best setup that's wrong because the optimizer dropped an item whose value isn't in its bonuses (salve, slayer helm, void, Blood Moon, …). Silent wrong answers are the main failure mode; see "Special-effect items".
- Results that disagree with the normal calculator for the same setup and monster. Every reported setup's numbers come from `computeRow` (`src/bulk/lib/compute.ts`), the bulk tool's single entry into the engine.
- A UI freeze. Everything heavy runs in the existing worker pool (`src/bulk/worker/BulkPool.ts`).

## Facts from research

**Speed (measured, one core, `preparePlayer` + `PlayerVsNPCCalc`).** DPS only: melee 0.39 ms, ranged 0.16 ms, magic 0.09 ms per setup. Adding TTK roughly doubles it (melee 0.74 ms). With the pool (cores − 1 workers) that's roughly 20–70k DPS evaluations per second. So: search on DPS only, compute the full row (TTK, spec) only for the winners.

**Dominance pruning works extremely well.** For a fixed style, an item's contribution through bonuses is its style attack bonus and style strength bonus (stab/slash/crush + `str`; `ranged` + `ranged_str`; `magic` + `magic_str`). Removing every item that another item in the same slot matches or beats on both numbers leaves **1–3 items per non-weapon slot** out of the full 5,463-item list (e.g. head 1,025 → 2–3). With a smaller bank pool and level limits it's similar. So the real search is the special-effect items plus a handful of plain items per slot.

**How GearScape does it (read from its public worker bundle, for approach only; no code copied).** Per style × stance × one-handed/two-handed: items are reduced to (style attack bonus, style strength bonus, price, has-effect flag); effect items are always kept; weapons are pre-filtered by distance and by hard-coded per-monster rules (vampyres need blisterwood etc., CoX guardians need pickaxes, Tanglefoot needs secateurs); then a greedy hill-climb starts from the weapon and repeatedly applies the single-slot swap with the biggest real-metric gain, with a "search depth" that also branches on the 2nd/3rd-best swap. Per-slot lists are first sampled down to 5 for a coarse pass. Sets (void etc.) are passed in as units because greedy single swaps can't discover them. Item level requirements come from their own API.

**What the engine decides by name, not bonuses** (full inventory from `src/lib`; ~195 item names, plus substring checks like `'Keris'`, `'of Vitur'`, `'Virtus'`, version checks like Charged tomes, id lists like `BLOWPIPE_IDS`, and weapon categories):
- Set effects: void/elite void, obsidian + tzhaar, inquisitor (per piece), crystal armour + crystal bow/bowfa, barrows sets, Blood Moon, Virtus on ancients.
- Monster-type bonuses: salve variants, black mask/slayer helm, avarice, demonbane weapons, dragonhunter, keris, golem, leafy, rat-bone, vampyre weapons, elemental amulets/tomes, Tumeken's shadow, revenant weapons in wilderness, etc.
- Slot interactions: ammo stats only count with valid ammo (`ammoApplicability`, `Equipment.ts:96-185`), blowpipe dart, Dizana's quiver, Shadow multiplier, Dinh's bulwark, Eclipse atlatl/Hunter's spear using strength.
- Attack speed changes (rapid, harmonised staff, Twinflame, Blood Moon, …) and special hit distributions (scythe, dual macuahuitl, keris, enchanted bolts, …).
- There is no machine-readable list in the engine.

**Data gaps.**
- `equipment.json` has no level requirements, prices, or quest data. The Wiki Bucket API (which `scripts/generateEquipment.py` uses) has no requirements either. Sources: game cache item params 434/436 (skill id #1/level #1) and 435/437 (#2) — Jagex's own data, always current; or osrsreboxed-db `equipment.requirements` (stale since Jan 2025, no new items).
- `spells.json` has no level requirements and no per-weapon spell lists (any weapon can "manual cast" any spell).
- Monsters have no "raid" field; raids are only identifiable via id lists in `src/lib/constants.ts` (`TOMBS_OF_AMASCUT_MONSTER_IDS`, `TOB_MONSTER_IDS`, CoX lists, …).
- Prayers (`src/enums/Prayer.ts`) and potions (`src/enums/Potion.ts`) have no unlock data.

**Prayer unlocks** (from the Wiki Prayer page; Defence levels to be verified per prayer page when implementing): Eagle Eye 44 / Mystic Might 45 (none); Chivalry 60 + 65 Def, Piety 70 + 70 Def (both need King's Ransom/Knight Waves); Deadeye 62 / Mystic Vigour 63 (Royal Titans scrolls; replace Eagle Eye/Mystic Might); Rigour 74 + 70 Def (dexterous scroll); Augury 77 + 70 Def (arcane scroll); Zeal 84 (Horn of Bran, The Fractured Archive).

**Engine bugs found** (upstream, not part of this work): name checks that never match — `'Amulet of the damned'` (item is "Amulet of the Damned"), `'Rod of ivandis'`, `'Silver bolts#…'`, Blue moon names' casing, `'Flames of Zamarok'`, lower-case `'Staff of balance'` / `'Toxic staff of the dead'` in spell checks. To be fixed on a separate branch and offered upstream, like the Blood Moon fix.

## The search (decided)

Exhaustive over a pruned space, not greedy. GearScape needs greedy steps because it doesn't prune by dominance; with 1–3 plain candidates per slot an exhaustive search is affordable and exact for everything the pruning keeps.

Per monster, per style (stab, slash, crush, ranged, magic):

1. **Fixed inputs**: player levels, best unlocked prayer for the style, potions, combat conditions (below), monster with its inputs. Stance: every stance of the weapon whose attack type is this style is tried (at most 3), since accurate can beat aggressive against high defence.

**Combat conditions (my call).** The engine reads player buffs that change which gear wins: on slayer task, in wilderness, Charge, Mark of Darkness, Kandarin diary, Forinthry surge, Soulreaper stacks, current HP, chinchompa distance. Best setup mode has a conditions panel with these, saved with the preset. Defaults: **not on slayer task** (upstream defaults to on, which would make the slayer helm win every boss and raid), not in wilderness, Kandarin diary on, Charge off, Mark of Darkness off, Forinthry surge off, Soulreaper stacks 5 (as the bulk defaults), current HP = max HP, chinchompa distance as upstream's default. They're part of the search inputs and of the cache key.
2. **Weapon candidates**: every weapon in the pool whose styles include this attack type and whose requirements are met; for ranged, paired with each valid ammo from the pool (`ammoForRangedWeapons`); for magic, paired with the spells it can cast (best elemental spell per element the player can cast, plus god spells/special spells where the engine supports them). Plain weapons (no effect) are also dominance-pruned on (attack bonus, strength bonus, attack speed). Monster-specific weapon rules (vampyre tiers, guardians, etc.) are applied as filters — see "Builder's calls".
3. **Per-slot candidates** for the other 10 slots (shield emptied for two-handers): the non-dominated plain items + every *active* special-effect item in the pool for that slot + "empty".
   - **Activity test (my call, replaces hand-written monster conditions).** For each weapon, each special-effect item is swapped into a baseline setup (that weapon + the best plain items) twice: once as itself, once as a "plain twin" (same bonuses, a name and id the engine doesn't recognise). If both give the same DPS, the effect does nothing for this monster/style/weapon (salve vs a non-undead, demonbane vs a non-demon, crystal armour without a crystal bow, …) and the item is treated as a plain item, so dominance pruning applies to it. Sets are tested as a whole set the same way. This keeps the search exact for this monster without the optimizer having to know *why* an item is special, and leaves only a few active effect items per slot.
   - If a weapon still has more than a cap of combinations after pruning (the builder picks the cap from measurements; start around 20k), the search for that weapon falls back to coordinate descent from the best plain setup (try every candidate in each slot, keep the best, repeat until nothing changes) and the result is marked "approximate". Expected to be rare.
4. **Sets as units**: set effects (void variants, inquisitor, obsidian, crystal, barrows, Blood Moon, Virtus) are added as whole-set candidates so the search can compare "full set" vs "best individual pieces".
5. **Search**: for each weapon (+ammo/spell), enumerate combinations of the per-slot candidates, evaluating DPS only, in worker chunks. Use a bound to skip combinations: an upper bound per weapon from the best plain bonuses lets whole weapons be skipped when they can't beat the current best. Expected size: a few hundred to a few thousand evaluations per weapon.
6. **Output**: the top N setups per style (N ≈ 3–5, so near-ties and cheaper alternatives are visible), then full `computeRow` (TTK, spec, issues) for those only.

**Special-effect items list.** A list under `src/bulk/` of every item (by canonical name/id, substring pattern, version, or category) that the engine treats specially, with the style(s) it matters for. A test extracts every string literal used in `wearing(...)`, `wearingAll(...)`, `.includes(...)` on equipment names, and id lists from `src/lib/**`, and fails if any equipment name found there isn't covered by the list. That way an upstream merge that adds a new special item breaks a test instead of silently giving wrong best setups. Items are pruned on canonical items (`getCanonicalEquipment`, `EquipmentAliases.ts`), since the engine matches on canonical names.

**Incremental recompute.** Cache per (monster, style, fixed inputs) the candidate set and the result. When the pool changes, rebuild each style's candidate set; if it's unchanged (the added/removed item was dominated or irrelevant for that style), keep the cached result. Only styles whose candidate set changed are re-searched.

## Level requirements (decided: my call, see below)

A new script next to `scripts/generateEquipment.py` produces `cdn/json/equipment_requirements.json` (`{ [itemId]: { attack?: n, strength?: n, defence?: n, ranged?: n, magic?: n, prayer?: n, hitpoints?: n, slayer?: n } }`) from the game cache item params 434–437 (latest cache from OpenRS2 or a JSON cache dump such as abextm/osrs-cache). It's a separate file rather than a change to `equipment.json`, so upstream's automated equipment updates never conflict. Items missing from the file are treated as having no requirements. A small hand-kept overrides file covers anything the cache doesn't express.

## Prayers and potions (decided)

Per style, a ranked list of offensive prayers, filtered by an "unlocked" setting: Prayer level plus unlock toggles (Piety/Chivalry, Rigour, Augury, Deadeye, Mystic Vigour, Zeal). The top one that applies to the style is used. Potions: the bulk tool's existing potion override (`BulkFilters.potions`) — default to the best boosting potion per style (super combat/overload family for melee, ranged/bastion for ranged, magic/imbued heart for magic) with a toggle to set them explicitly.

## UI (decided at the level of what's shown; layout is the builder's)

- **Its own page** (user: the UI differs too much from the bulk page), at `/best` (`src/app/best/page.tsx`), next to the bulk tool (`/`) and the calculator (`/calc`). The top bar's bulk nav link (`src/bulk/components/BulkNavLink.tsx`) gains a link to it; full page loads between pages, as today. Page code lives under `src/best/` and reuses `src/bulk/` (engine entry `compute.ts`, worker pool, results table, gear cells, monster picker) rather than copying it.
- Inputs: monster (or monster group), item pool panel (import paste box, manual add/remove, exclude, locks), player levels (with hiscore lookup), prayer unlocks, potions, combat conditions, styles to include.
- Results reuse the bulk results table components: one block per style (or per boss × style in group mode), top N rows each.
- Best setup state (pool, levels, unlocks, conditions, monster list) is saved in its own localforage key, separate from bulk presets.
- A result row can be saved as a normal bulk setup / sent to the calculator, reusing the existing sync code (`SetupSync`, `calculatorLoadouts`).
- Progress shown while searching; changing an input cancels and restarts (the pool already supports cancellation).

## Group mode (decided)

The best setup page holds a list of monsters (bulk presets are unchanged). Raid shortcuts fill the list, each monster's inputs editable as today. Each monster is searched independently; caching is per monster.

**Raid shortcuts (my call).** Bosses only (no adds, obelisks, crabs, webs, or CoX non-boss rooms), one entry per phase where phases have different stats (Verzik P1/P2/P3, Wardens P2/P3, Olm head/hands as separate entries), and a mode picker per raid: ToB normal/hard/entry, CoX normal/CM, ToA with invocation level. The boss lists are hand-kept in `src/best/` (the engine's id lists aren't boss lists), checked by a test that every id exists in `monsters.json`.

## Builder's calls

- Exact module layout under `src/bulk/`, worker message shapes, chunk sizes.
- How to compute the per-weapon upper bound, and whether it's worth it (measure first).
- Which per-monster weapon rules to include in v1 (start with the ones the engine itself enforces; GearScape's list is a reference for what exists).
- Stance handling details per weapon category.
- The top-N value and how ties are shown.
- Where the prayer unlock and level settings live (per preset or global).

## Calls I made (for the user to check)

- **Exhaustive search over pruned candidates**, not GearScape's greedy hill-climb: exact for everything kept, and the measured candidate counts make it cheap. Special-effect items that do nothing against the chosen monster are found by testing them against a "plain twin", not by a hand-written list of conditions. Above a combination cap the search falls back to coordinate descent and says so.
- **Combat condition defaults**: not on slayer task, not in wilderness, Charge off, Kandarin diary on.
- **Bank ownership**: any charged/uncharged/degraded/ornament variant counts; un-imbued doesn't count as imbued; placeholders don't count.
- **Raid shortcuts**: bosses only, one entry per phase, mode picker per raid.
- **Requirements from the game cache**, in a separate JSON file, rather than osrsreboxed-db (stale) — this needs a one-off data script and is the most work of the data tasks.
- **Quest requirements are ignored** in v1; the pool handles "I don't have it".
- **Budget is out of v1.**
- **Bank Memory TSV is the only import format** in v1.
- **Group mode shows per-boss bests**, no combined raid score.
- **Calc engine bugs** found during research are fixed separately and offered upstream, not in this branch.

## Suggested build order

1. Special-effect items list + coverage test (the safety net everything else depends on).
2. Single-monster search with "all items" pool, best prayer/potion picked, no requirements.
3. Item pool: Bank Memory import, manual add/remove, exclude, locks.
4. Level requirements data script + filter; hiscore lookup.
5. Incremental recompute cache.
6. Group mode and raid shortcuts.
