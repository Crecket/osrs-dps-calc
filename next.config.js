/** @type {import('next').NextConfig} */
const {execSync} = require("node:child_process");

// what a cached raid search or DPS number depends on: the engine, the search and the item and monster data
const ENGINE_PATHS = [
  'cdn/json', 'src/lib', 'src/types', 'src/enums', 'src/utils.ts', 'src/best/lib', 'src/best/worker', 'src/best/types.ts',
  'src/bulk/lib/compute.ts', 'src/raid/lib/candidates.ts', 'src/raid/lib/searchCache.ts',
].join(' ');

let engineSha = undefined,
  gitSha = undefined,
  gitShaShort = "unknown",
  gitDirty = "false";
try {
  gitSha = execSync("git rev-parse HEAD", { windowsHide: true }).toString().trim();
  gitShaShort = execSync("git rev-parse --short HEAD", { windowsHide: true }).toString().trim();
  gitDirty = execSync("git status --untracked-files=no --porcelain", { windowsHide: true }).toString().trim();
  if (gitDirty !== "") {
    gitDirty = "true";
  }
  const engineDirty = execSync(`git status --untracked-files=no --porcelain -- ${ENGINE_PATHS}`, { windowsHide: true }).toString().trim();
  engineSha = execSync(`git log -1 --format=%h -- ${ENGINE_PATHS}`, { windowsHide: true }).toString().trim() + (engineDirty ? "-dirty" : "");
} catch (e) {
  console.warn(`No git data available, building without`);
}

const shouldAnalyse = process.env.ANALYSE === 'true';

let nextConfig = {
  output: 'export',
  reactStrictMode: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  images: {
    unoptimized: true,
    domains: ['runescape.wiki', 'oldschool.runescape.wiki'],
  },
  transpilePackages: [
    'd3',
    'd3-array',
    'internmap'
  ],
  env: {
    GIT_SHA: gitSha,
    GIT_SHA_SHORT: gitShaShort,
    GIT_DIRTY: gitDirty,
    ENGINE_SHA: engineSha,
  },
  async redirects() {
    if (process.env.NEXT_PUBLIC_BASE_PATH) {
      return [
        {
          source: '/',
          destination: process.env.NEXT_PUBLIC_BASE_PATH,
          basePath: false,
          permanent: true
        }
      ]
    } else {
      return [];
    }
  }
}

if (shouldAnalyse) {
  const withNextBundleAnalyzer = require('@next/bundle-analyzer')();
  nextConfig = withNextBundleAnalyzer(nextConfig);
}

module.exports = nextConfig
