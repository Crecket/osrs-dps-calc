# Bulk DPS tool

A fork of the [OSRS Wiki DPS calculator](https://github.com/weirdgloop/osrs-dps-calc) whose homepage compares many gear setups against one target at once, ranked in a single table. The original calculator stays at `/calc` as the place to build setups.

## Goals

- Answer "which of my setups is best against this monster?" in one view, for normal and special attacks.
- Reuse the Wiki calculator's engine and UI instead of reimplementing them, so results match the Wiki and upstream fixes come in with a merge.
- Keep bulk code in `src/bulk/` and touch upstream files as little as possible, so merges stay easy.
- No backend: everything runs and is saved in the browser. Presets move between browsers through JSON export/import.

## Development

Node 18 for the app, Node 20+ for wrangler.

```bash
yarn dev                                    # http://localhost:3000/osrs-dps/
yarn jest src/tests/bulk --coverage=false   # bulk tests
```

Hosted at https://bulk-dps-calc.olm.pet as a static Cloudflare Worker (`wrangler.jsonc`). Pushing `bulk-mode` builds and deploys it.

## Upstream merges

`git fetch upstream && git merge upstream/main`, then run the tests. Breakage usually lands in `src/bulk/lib/` (`compute.ts`, `presetIO.ts`, `defaultSetups.ts`); a conflict in `src/app/page.tsx` keeps the bulk version.
