# Raid gear planner (POC) — design

Date: 2026-10-29
Repo: `~/Projects/dps-bulk-tool`, branch `bulk-mode`.
Builds on: `docs/superpowers/specs/2026-10-24-best-setup-design.md` (the best setup search and its anti-goals).

## Intent

Given a GP budget and the gear the player already owns, show a "half decent" full raid loadout: worn gear plus inventory switches that gives the lowest total solo kill time over a chosen route through a raid. It's "best in slot for a budget", like GearScape's groups view but spending money across the whole raid: at 20b it maxes everything and has GP left, at 4b it skips the 3.2b Obligator because that money buys more time elsewhere (armour, ranged switches). Approximate on purpose: the user wants a decent idea of the gear, not perfect setups. First raid: The Fractured Archive. Built so more raids and boss groups can be added as data later.

## Goals

1. **Raid definitions as data.** A raid is a list of stops; each stop has one or more boss options; each boss has one or more phases (monster id + version) and rules. The Fractured Archive: Archive Guardian → Bork or Ezekiel → Moia or Dreadnoth → Dagon'hai or Xarth → Ocellus (phases 1–3). The page, the search and the display read the definition and know nothing about the Archive.
2. **Route picking.** One choice per stop with more than one option (default Bork / Dreadnoth / Xarth).
3. **Budget and prices.** A GP budget. Prices from the OSRS Wiki real-time prices API (`https://prices.runescape.wiki/api/v1/osrs/mapping` and `/latest`, as `../price-index-osrs` uses), fetched in the browser and cached. Owned items cost 0. Items with no price (untradeable) cost 0 (my call: you earn them, you don't buy them).
4. **Owned and excluded items.** Right-click an item to exclude it (as on the best setup page) or mark it owned. Owned items can also be imported by pasting a RuneLite Inventory Setups export (`eq`, `inv`, `afi` ids).
5. **Per-boss defence reduction.** A scrollable row of bosses, each with counters for Elder maul, Dragon warhammer and Tonalztics specs (defaults from the wiki strategy table). A boss with a non-zero count needs that weapon in the loadout.
6. **Supplies.** Number fields for brews, restores and other reserved slots (boost potions etc.); together with the magic option they take inventory slots before switches.
7. **Magic option.** Thralls (Arceuus: Book of the Dead + rune pouch, flat thrall DPS added), Ancients (rune pouch, ancient spells), Standard (rune pouch, standard spells), or None (powered staves only). Boss rules can forbid an option: Dagon'hai needs elemental spells, so with that rule on (toggle, on by default) a route through Dagon'hai can't use Thralls or Ancients.
8. **Boss rules.** Moia requires a Venator bow in the loadout unless the Venator bow is excluded.
9. **Score.** Total time = sum over route phases of HP / DPS of the fastest setup made only of loadout items. Solo, main HP bars only, no adds, no switching time.
10. **Display.** Two in-game style grids side by side: the equipment grid (with the quiver's extra ammo slot when a quiver is worn) and the 4×7 inventory. Total cost and total raid time above. Below, one row per route boss like GearScape's groups: boss name, defence reduction counters, and one cell per weapon setup in the loadout with DPS and kill time, the fastest in green. Ocellus shows a sub-row per phase.

## Non-goals (POC)

- Multi-player scaling, adds, phase mechanics, switching time, spec weapons other than defence reduction.
- Perfect optimisation. A greedy budget assembly over candidate setups is enough.
- A separate thralls engine: a flat DPS approximation is enough.
- Defence reduction caps per boss beyond what the engine already does.

## Anti-goals

- Editing the calc engine (`src/lib/**`). Raid code lives under `src/raid/**` and reuses `src/best/**` and `src/bulk/**`.
- Archive-specific code outside the raid definition file.
- Auto-running the search on input changes: it starts from a button, input changes mark results stale (as on the best setup page).

## How it works (decided)

1. **Candidates.** For each route phase (monster with its defence reduction applied) and each style, run the existing best setup search (`runBestSetup`) several times with the item pool cut at price tiers: the budget, budget/4 and owned-or-free only (items above the tier and not owned are passed as excluded). Every resulting setup is a candidate for that phase.
2. **Assembly.** Start with an empty loadout. Required items (Venator bow for Moia, defence reduction weapons with a non-zero count, Book of the Dead for thralls) are added first. Then repeatedly add the candidate setup whose missing items give the most saved raid time per GP (a phase with no usable setup counts as a large time), while the total price stays within budget and the item count fits the slots. Stop when no candidate improves the time.
3. **Slots.** Worn = the setup used for the most raid time; every other loadout item is an inventory switch. Ammo: one type is worn, a second is worn when a quiver is worn, any further type takes an inventory slot. Inventory = switches + rune pouch / Book of the Dead + brews + restores + other reserved ≤ 28.
4. **Spellbook.** The magic option limits which spells the search may use (a spellbook filter added to the best setup inputs).

## Builder's calls

- Module layout under `src/raid/`, price caching details, the exact tier list, the "no setup" penalty, item order in the inventory.

## Calls I made (for the user to check)

- Untradeable items cost 0.
- A fourth magic option, Standard, so a Dagon'hai route still has magic.
- Thralls as a flat ~0.6 DPS (max hit 3, every 4 ticks, always hits), only on the Thralls option.
- Greedy assembly over tiered candidates, not an exact optimiser.
- Routes default to Bork / Dreadnoth / Xarth; the Guardian counts its flying and grounded forms as two phases.
