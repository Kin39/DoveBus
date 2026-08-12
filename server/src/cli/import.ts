import { runRefreshCommand } from "./run.js";

/**
 * Force a full rebuild of the static database, even if the feed is unchanged.
 *   npm run import                 (download the live feed)
 *   npm run import -- --zip a.zip  (reuse a local copy)
 */
process.exitCode = await runRefreshCommand(process.argv.slice(2), { force: true });
