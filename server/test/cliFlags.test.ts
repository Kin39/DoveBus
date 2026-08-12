import { describe, expect, test } from "vitest";
import { parseFlags } from "../src/cli/run.js";

describe("parseFlags", () => {
  test("defaults to downloading the live feed without forcing", () => {
    expect(parseFlags([])).toEqual({ force: false, zipPath: null });
  });

  test("accepts --force and both spellings of --zip", () => {
    expect(parseFlags(["--force"])).toEqual({ force: true, zipPath: null });
    expect(parseFlags(["--zip", "/tmp/gtfs.zip"])).toEqual({
      force: false,
      zipPath: "/tmp/gtfs.zip",
    });
    expect(parseFlags(["--zip=/tmp/gtfs.zip", "--force"])).toEqual({
      force: true,
      zipPath: "/tmp/gtfs.zip",
    });
  });

  test("rejects unknown arguments and a --zip without a value", () => {
    expect(() => parseFlags(["--wat"])).toThrow(/unknown argument/);
    expect(() => parseFlags(["--zip"])).toThrow(/--zip requires a path/);
  });
});
