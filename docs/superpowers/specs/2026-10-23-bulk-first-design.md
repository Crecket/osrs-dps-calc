# Bulk-first redesign — design

Date: 2026-10-23
Builds on: `docs/superpowers/specs/2026-10-23-bulk-mode-design.md` (bulk mode as shipped on branch `bulk-mode`, commit 277f65c3). Everything in that design still holds unless this document changes it, in particular the upstream-friendliness rules (additive code under `src/bulk/`, a short listed set of upstream touches, the adapter as the only contact with the engine).

## Intent

Bulk mode works, but it hides behind a button on the Wiki calculator, and the user wants it to be the tool: people should land in it, see a ranked list of setups against the boss they care about, and only visit the calculator to build a new setup. Three changes get there:

1. The bulk tool is the homepage; the calculator becomes a secondary page used for building setups.
2. Each preset targets one monster, picked from a single drop-down, so the results are one ranked list of setups.
3. A fresh tool is useful immediately: presets start with a set of max-gear setups, and adding setups never creates duplicates.

## Goals

- Opening the site (`/`) shows the bulk tool.
- The calculator stays, fully working, at its own route, with an obvious way to get there from the bulk tool for building a new setup, and an obvious way back.
- One target monster per preset, chosen from a single searchable drop-down. The results table ranks setups against it.
- New presets (including the first one a new visitor gets) start with the default max setups listed below.
- Adding setups (from the calculator, a share link, or the defaults) never adds a setup that is already in the preset.

## Non-goals

- Removing the calculator. (The user considered it, then decided to keep it.)
- Gear editing inside the bulk tool. Setups are still built in the calculator.
- Comparing against several monsters at once. That ability goes away.
- Changing the calc engine, the worker pool's behaviour, presets' storage format beyond the monster change, or export/import file compatibility beyond what's described here.

## Anti-goals

- A first-time visitor landing on an empty, confusing page.
- Building a setup in the calculator and not finding how to get it into the bulk tool.
- Pressing "add" twice (or re-adding the calculator's loadouts after building one more) and getting duplicate rows.
- Breaking the calculator's own start-up (share links via `?id=`, session restore, storage updater, calc worker). It must still initialise exactly once per page load (see the polish fix in `BulkNavLink`).

## Decisions

### Routes

- `/` renders the bulk tool. Upstream's `src/app/page.tsx` changes from rendering `Home` to rendering the bulk page (one-line upstream touch; record it in the upstream-touch list and in BULK.md).
- The calculator moves to `/calc` via a new `src/app/calc/page.tsx` that renders upstream's `Home` unchanged.
- `/bulk` keeps working as an alias that redirects (client-side) to `/`, so old links and bookmarks still work. Builder's call how.
- The base path still comes from `NEXT_PUBLIC_BASE_PATH` (`/osrs-dps` in local dev, empty for the Cloudflare build), so in `npm run dev` the tool is at `http://localhost:3000/osrs-dps/` and the calculator at `/osrs-dps/calc`.
- Known wrinkle (my call to accept): after loading a `?id=` share link, upstream's `InitialLoad` rewrites the URL to the base path, which is now the bulk tool's URL, while the calculator stays on screen. A reload would then show the bulk tool. Acceptable; share links are made on the Wiki's own site and are pasted into the bulk tool's "Add from link" box, not opened at `/calc`. Don't edit `InitialLoad` for this.

### Getting to the calculator and back

- The top-bar button keeps doing a full page load into the calculator (the fix from the polish round), now labelled for its purpose, e.g. "Build setups in the calculator". Builder's call on exact wording and icon.
- The Setups panel gets a prominent "Build a new setup" link to the calculator, and its empty state says that's where setups come from. Builder's call on layout; it must be visible without scrolling on a laptop screen.
- In the calculator, the top-bar button reads e.g. "Back to bulk tool". Going back can be a normal client-side navigation (the bulk page has no once-only start-up), but builder's call.
- Returning to the bulk tool: if the calculator's saved loadouts contain setups that aren't in the active preset, show a small banner in the Setups panel ("2 calculator loadouts aren't in this preset — Add them"), using the same duplicate check as below. The existing "Add all calculator loadouts" / "Add selected loadout" buttons stay. (My call: makes the round trip obvious without auto-adding anything the user didn't ask for.)
- The banner has a dismiss (×) that hides it until the page is reloaded or the set of not-yet-added loadouts changes (e.g. a newly built one). Not stored. (My call: presets that are meant to differ shouldn't be nagged forever, and a new loadout should still bring the cue back.)
- Calculator loadouts with no equipment at all (the calculator's blank "Loadout 1") are ignored by every add-from-calculator path and by the banner. (My call.)

### One monster per preset

- `BulkPreset.monsters: BulkMonster[]` becomes `BulkPreset.monster: BulkMonster | null`.
- Loading a stored or imported preset that has the old `monsters` array keeps the first valid monster and drops the rest, with one warning naming how many were dropped (only if more than one). Export writes the new shape; import accepts both. Bump the export file `version` to 2.
- The picker is one searchable drop-down (upstream's `Combobox`, as `MonsterList` uses today) showing the current target, with the same name + version labels. Choosing a monster replaces the target.
- Keep "Use calculator's monster" next to the drop-down: it's the only way to get raid levels, phases and defence reductions in, and the calculator is staying.
- Keep the short line showing non-default inputs (phase, raid level, DWH etc.) under the drop-down when the target has them.
- No target yet: the results area says "Pick a monster" in place of the table. New presets start with no target (my call: no sensible universal default boss).
- Results run automatically: when a target is picked or changed, when setups are added or removed, and on page load when the preset already has a target and setups. Changes within ~300 ms are batched into one run, and a new run cancels the one in progress (the pool already does that). The Run button goes; Cancel stays visible while a run is in progress (a large preset can take a second or more). (My call: one target and a dozen setups is milliseconds of work, and "land in it, see a ranked list" means not hunting for a button.)
- The results table drops the Monster column and the monster filter. CSV export drops the monster column too, but keep the monster's name in the file name. The worker pool and `computeRow` stay as they are (a run is setups × one monster).

### Default max setups

New presets start with these setups, in this order. Each is level 99 in all skills (the calculator's default), with the best offensive prayer for its style (Piety / Rigour / Augury) and one potion: Super combat (melee), Ranging potion (ranged), Saturated heart (magic). Boosts are computed from the potion with upstream's `PotionMap[p].calculateFn(skills)`, because imported loadouts carry their boosts rather than recomputing them.

Slot choices follow upstream's own Max Melee / Max Ranged / Void Ranged / Max Mage presets in `src/app/components/player/equipment/EquipmentPresets.tsx` (the wiki maintains those), plus the weapon:

| Setup | Base (upstream preset) | Weapon / off-hand | Changes from the base | Style |
|---|---|---|---|---|
| Max scythe | Max Melee | Scythe of Vitur (charged, 22325), no shield | — | Chop (slash, aggressive) |
| Max scythe inquisitor | Max Melee | Scythe of Vitur (22325), no shield | Inquisitor's great helm 24419, hauberk 24420, plateskirt 24421 | Jab (crush) |
| Max range | Max Ranged | Twisted bow 20997 | — | Rapid |
| Max range void | Void Ranged | Twisted bow 20997 | — | Rapid |
| Max shadow | Max Mage | Tumeken's shadow (charged, 27275) | — | Accurate |
| Max ayak | Max Mage | Eye of Ayak (charged, 31113) + Elidinis' ward (f) 27251 | — | Accurate |
| Max range blowpipe | Max Ranged | Toxic blowpipe (charged, 12926) loaded with Dragon darts (11230, via `itemVars.blowpipeDartId`) | — | Rapid |
| Max harm wind surge | Max Mage | Harmonised nightmare staff 24423 + Elidinis' ward (f) 27251 | spell Wind Surge | the staff's autocast style |
| Max harm water surge | Max Mage | as above | spell Water Surge | autocast |
| Max harm earth surge | Max Mage | as above | spell Earth Surge | autocast |
| Max harm fire surge | Max Mage | as above | spell Fire Surge | autocast |

Requested by the user: "max range blowpipe" and "max mage with harm/ward casting surge variants". My reading: one setup per Surge element (the calculator applies elemental weaknesses, so the best one depends on the target), all with the ward rather than a tome. Blowpipe: the Toxic blowpipe, because the calculator gives the Blazing blowpipe identical stats; dragon darts as the standard max dart. (My calls.)

- Store them in code as minimal loadouts (item ids plus stats, prayers, boosts, style), the same shape as a share link, and pass them through `migrateImportable` like any import. That way upstream's re-resolution and migrations apply, and a missing item shows up as the normal "no longer exists" warning rather than a crash. Item ids are from `cdn/json/equipment.json` at upstream 89c3e25b. Copy the base presets' item ids into the bulk code rather than importing the upstream component (it's a React component that writes straight into the calculator store).
- If an item turns out to be two-handed (so the off-hand is dropped) or a style name doesn't exist for that weapon, fix the table rather than special-casing; a test should load every default setup and assert no warnings and a non-zero DPS against a standard monster.
- Max obligator is wanted but the Obligator isn't in upstream's item data yet (as of 2026-09-02). Leave it out; adding it later is one entry.
- Defaults are added to new presets only. Existing presets are not changed. An "Add max setups" action in the Setups panel re-adds any defaults the preset is missing (through the duplicate check), so a user who deleted them can get them back. (My call.)
- The first visit creates "My preset" with the defaults, so a new visitor sees six setups and only needs to pick a monster.

### No duplicate setups

- Two setups are duplicates when they would calculate identically: same equipment (by item id per slot), skills, boosts, prayers, combat style, spell, and the other player inputs the calc reads (buffs and the like). The name and id don't count; neither do fields the calculator derives from gear (bonuses, attack speed). Builder's call on the exact field list, as long as that rule holds and it's tested.
- Every way of adding setups goes through one store method that skips duplicates, both against the preset and within the batch being added.
- The toast says what happened, e.g. "Added 2 setups, 3 were already in this preset", or "Those setups are already in this preset" when nothing was added.
- Existing presets that already contain duplicates are left alone (my call: don't silently delete user data).

## Constraints

- Upstream-friendly as before. New upstream touches from this redesign: `src/app/page.tsx` (render the bulk page). The new `src/app/calc/page.tsx` is a new file. Keep the list in BULK.md current.
- Tests: Jest under `src/tests/bulk/`, TDD as in the first round. Browser check with headless Chromium against `wrangler dev` on the `build-cf` output, as before.
- Claude can't run git here; commands go to the user to run.

## Left to the builder

- Exact copy, icons, and layout of the new links, banner and picker, within the constraints above.
- How `/bulk` redirects to `/`.
- Exact duplicate-check field list, per the rule above.
- How preset migration from `monsters[]` to `monster` is structured, as long as stored presets, exported files and the tests' fixture all load.
