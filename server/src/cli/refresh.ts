import { runRefreshCommand } from "./run.js";

/**
 * Scheduled daily job: rebuild and publish only when the feed actually changed.
 * Warns when the loaded timetable is past its feed_end_date.
 */
process.exitCode = await runRefreshCommand(process.argv.slice(2), { force: false });
