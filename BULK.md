# Bulk mode

This fork of the [OSRS Wiki DPS calculator](https://github.com/weirdgloop/osrs-dps-calc) adds a **Bulk** page (`/bulk`) that runs many setups against many monsters at once, across a pool of web workers, and shows a sortable table with each setup's gear in a row. A Spec toggle switches to special-attack numbers and hides setups without a supported spec.

## Using it

1. Build loadouts in the normal calculator (gear, prayers, potions, style).
2. Open **Bulk mode** from the top bar and click **Add all calculator loadouts** (or **Add selected loadout**, or paste a share link).
3. Add monsters by search. For raids, phases or defence reductions, set the monster up in the calculator first and use **Add calculator's monster**.
4. Press **Run**. Click a column header to sort; use the monster filter, Spec toggle, or CSV export.

Presets are saved in the browser (IndexedDB key `dps-bulk-presets`) and can be exported/imported as JSON files.

## Development

Use Node 18 for the app (see `.nvmrc`) and Node 20+ for wrangler. `node .yarn/releases/yarn-4.9.2.cjs` works wherever `yarn` isn't installed.

```bash
yarn install
yarn dev                                    # http://localhost:3000/osrs-dps/bulk
yarn jest src/tests/bulk --coverage=false   # bulk tests
yarn test                                   # all tests
```

Code layout: everything bulk-specific is under `src/bulk/` (plus `src/app/bulk/page.tsx` and `src/tests/bulk/`). Only two files talk to the upstream engine: `src/bulk/lib/compute.ts` (calculations, runs in the workers) and `src/bulk/lib/presetIO.ts` (imports, reusing upstream's migrations).

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

The bulk tests include a parity check against the upstream engine and a saved-preset fixture. If they fail after a merge, the fix belongs in `src/bulk/lib/compute.ts` or `src/bulk/lib/presetIO.ts`.
