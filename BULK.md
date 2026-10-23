# Bulk DPS tool

This fork of the [OSRS Wiki DPS calculator](https://github.com/weirdgloop/osrs-dps-calc) makes a bulk comparison tool its homepage: every setup in a preset is run against one target monster, across a pool of web workers, and ranked in a sortable table with each setup's gear in a row. A Spec toggle switches to special-attack numbers and hides setups without a supported spec. The Wiki calculator is still there, at `/calc`, for building setups.

## Using it

1. Open the site. A new preset starts with max-gear setups (scythe, inquisitor, twisted bow, void, blowpipe, shadow, ayak, and harmonised staff with each Surge).
2. Pick the target monster from the drop-down. Results run on their own whenever the target or the setups change. For raids, phases or defence reductions, set the monster up in the calculator and use **Use calculator's monster**.
3. To add your own setup, click **Build a new setup** (or **Build setups in the calculator** in the top bar), build the loadout, then **Back to bulk tool**. A banner offers the calculator loadouts that aren't in the preset yet. **Add all calculator loadouts**, **Add selected loadout** and pasting a share link also work.
4. Setups are never added twice: a setup with the same gear, stats, prayers, potions, style and spell as one already in the preset is skipped, whatever its name. **Add max setups** brings back any defaults you removed.
5. Click a column header to sort; use the Spec toggle or CSV export.

Presets are saved in the browser (IndexedDB key `dps-bulk-presets`) and can be exported/imported as JSON files. Presets saved or exported before one-monster presets keep their first monster.

## Development

Use Node 18 for the app (see `.nvmrc`) and Node 20+ for wrangler. `node .yarn/releases/yarn-4.9.2.cjs` works wherever `yarn` isn't installed.

```bash
yarn install
yarn dev                                    # bulk tool: http://localhost:3000/osrs-dps/  calculator: http://localhost:3000/osrs-dps/calc
yarn jest src/tests/bulk --coverage=false   # bulk tests
yarn test                                   # all tests
```

Code layout: everything bulk-specific is under `src/bulk/` (plus `src/app/calc/page.tsx`, the `/bulk` redirect in `src/app/bulk/page.tsx`, and `src/tests/bulk/`). Upstream files touched: `src/app/page.tsx` (renders the bulk tool), `src/app/components/TopBar.tsx` (the nav button), `package.json` (scripts) and `.gitignore`. The default setups in `src/bulk/lib/defaultSetups.ts` copy their slots from upstream's equipment presets (`src/app/components/player/equipment/EquipmentPresets.tsx`); update them when upstream's change. Only three files talk to the upstream engine: `src/bulk/lib/compute.ts` (calculations, runs in the workers), `src/bulk/lib/presetIO.ts` (imports, reusing upstream's migrations) and `src/bulk/lib/defaultSetups.ts` (item ids, styles, potion boosts).

## Deploying to Cloudflare (bulk-dps-calc.olm.pet)

The site is a static export served by a static-assets-only Cloudflare Worker (`wrangler.jsonc`). The `olm.pet` zone must be on the same Cloudflare account; wrangler creates the `bulk-dps-calc.olm.pet` DNS record and certificate on first deploy.

```bash
npx wrangler login     # once
yarn deploy-cf         # builds with no base path, then wrangler deploy
yarn preview-cf        # build and serve locally with wrangler dev
```

## Pulling in upstream Wiki changes

```bash
git fetch upstream
git merge upstream/main
yarn install
yarn test
```

The bulk tests include a parity check against the upstream engine and a saved-preset fixture. If they fail after a merge, the fix belongs in `src/bulk/lib/compute.ts`, `src/bulk/lib/presetIO.ts` or `src/bulk/lib/defaultSetups.ts`. A merge conflict in `src/app/page.tsx` resolves to keeping the bulk version.
