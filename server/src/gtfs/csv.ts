import type { Readable } from "node:stream";
import { parse } from "csv-parse";

export interface CsvRow {
  /** Column names from the first line, shared across every row of one file. */
  readonly header: readonly string[];
  /** Raw cell values, positionally aligned with `header`. */
  readonly row: readonly string[];
}

/**
 * Streams a GTFS `.txt` (RFC 4180 CSV) as positional rows.
 *
 * Rows are yielded as arrays rather than objects: the feed's largest files are
 * ~5M (`stop_times`) and ~7M (`shapes`) rows, and allocating a keyed object per
 * row dominates import time. Callers resolve columns once via `header`, which is
 * the same array instance for every row of a file.
 */
export async function* readCsv(input: Readable): AsyncGenerator<CsvRow> {
  const parser = input.pipe(
    parse({
      bom: true,
      skipEmptyLines: true,
      relaxColumnCount: true,
      trim: false,
    }),
  );

  let header: readonly string[] | null = null;
  for await (const record of parser) {
    const row = record as string[];
    if (header === null) {
      header = row.map((name) => name.trim());
      continue;
    }
    yield { header, row };
  }
}
