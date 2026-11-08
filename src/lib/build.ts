/**
 * The commit this build was made from (next.config.js puts it in the environment), with "-dirty" for uncommitted
 * changes; "unknown" without git data. Saved raid results remember it, so a new build doesn't show an old plan.
 */
export const BUILD_ID = `${process.env.GIT_SHA_SHORT ?? 'unknown'}${process.env.GIT_DIRTY === 'true' ? '-dirty' : ''}`;

/** The last commit to change what cached searches and DPS numbers depend on (ENGINE_PATHS in next.config.js), so that other deploys keep them */
export const ENGINE_ID = process.env.ENGINE_SHA ?? BUILD_ID;
