import type { Readable } from "node:stream";
import { readCsv } from "./csv.js";

export interface FeedInfo {
  readonly publisherName: string | null;
  readonly feedStartDate: string | null;
  readonly feedEndDate: string | null;
  readonly feedVersion: string | null;
}

const EMPTY_FEED_INFO: FeedInfo = {
  publisherName: null,
  feedStartDate: null,
  feedEndDate: null,
  feedVersion: null,
};

/**
 * Reads the single row of `feed_info.txt`. `feed_end_date` is what the refresh
 * job watches: this feed ships ~20-day timetables, so an expired end date means
 * the served schedules are stale even when the file itself has not changed.
 */
export async function readFeedInfo(input: Readable): Promise<FeedInfo> {
  for await (const { header, row } of readCsv(input)) {
    const value = (name: string): string | null => {
      const index = header.indexOf(name);
      const raw = index === -1 ? undefined : row[index];
      return raw === undefined || raw === "" ? null : raw;
    };
    return {
      publisherName: value("feed_publisher_name"),
      feedStartDate: value("feed_start_date"),
      feedEndDate: value("feed_end_date"),
      feedVersion: value("feed_version"),
    };
  }
  return EMPTY_FEED_INFO;
}
