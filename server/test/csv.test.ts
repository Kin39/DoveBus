import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { readCsv } from "../src/gtfs/csv.js";

const streamOf = (text: string): Readable => Readable.from([Buffer.from(text, "utf8")]);

async function collect(text: string): Promise<{ header: string[]; rows: string[][] }> {
  const rows: string[][] = [];
  let header: string[] = [];
  for await (const chunk of readCsv(streamOf(text))) {
    if (header.length === 0) header = [...chunk.header];
    rows.push([...chunk.row]);
  }
  return { header, rows };
}

describe("readCsv", () => {
  test("yields the header separately from data rows", async () => {
    const { header, rows } = await collect("a,b\n1,2\n3,4\n");
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("handles quoted fields containing commas (GTFS stop names)", async () => {
    const { rows } = await collect('stop_id,stop_name\n1,"VIA DELLA CHIMERA, 87"\n');
    expect(rows).toEqual([["1", "VIA DELLA CHIMERA, 87"]]);
  });

  test("handles escaped double quotes inside a quoted field", async () => {
    const { rows } = await collect('a\n"say ""hi"""\n');
    expect(rows).toEqual([['say "hi"']]);
  });

  test("strips a UTF-8 BOM from the first column name", async () => {
    const { header } = await collect("﻿stop_id,stop_name\n1,X\n");
    expect(header).toEqual(["stop_id", "stop_name"]);
  });

  test("handles CRLF line endings", async () => {
    const { header, rows } = await collect("a,b\r\n1,2\r\n");
    expect(header).toEqual(["a", "b"]);
    expect(rows).toEqual([["1", "2"]]);
  });

  test("skips blank lines and tolerates short rows", async () => {
    const { rows } = await collect("a,b,c\n1,2,3\n\n4,5\n");
    expect(rows).toEqual([
      ["1", "2", "3"],
      ["4", "5"],
    ]);
  });

  test("yields nothing for a header-only file", async () => {
    const { rows } = await collect("a,b\n");
    expect(rows).toEqual([]);
  });
});
