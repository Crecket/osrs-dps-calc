/**
 * The commit this build was made from (next.config.js puts it in the environment), with "-dirty" for uncommitted
 * changes; "unknown" without git data. Saved raid results remember it, so a new build doesn't show an old plan.
 */
// eslint-disable-next-line import/prefer-default-export
export const BUILD_ID = `${process.env.GIT_SHA_SHORT ?? 'unknown'}${process.env.GIT_DIRTY === 'true' ? '-dirty' : ''}`;
