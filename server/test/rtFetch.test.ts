import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fetchRtFeed, RT_MAX_BODY_BYTES } from "../src/rt/fetch.js";
import { encodeVehiclePositions } from "./helpers/rtFixture.js";

const SNAPSHOT = Buffer.from(encodeVehiclePositions([{ tripId: "T1", startDate: "20260812" }]));

describe("fetchRtFeed", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/vehicle-positions") {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(SNAPSHOT);
        return;
      }
      if (request.url === "/hang") {
        // Never responds: exercises the request timeout.
        return;
      }
      if (request.url === "/huge") {
        // Announces far more than any real snapshot; the body is never read.
        response.writeHead(200, { "content-length": String(RT_MAX_BODY_BYTES + 1) });
        response.end();
        return;
      }
      response.writeHead(502).end("Bad Gateway");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("returns the snapshot bytes with timing", async () => {
    const result = await fetchRtFeed(`${baseUrl}/vehicle-positions`);

    expect(Buffer.from(result.body)).toEqual(SNAPSHOT);
    expect(result.bytes).toBe(SNAPSHOT.length);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("throws on a gateway error rather than handing an error page to the decoder", async () => {
    await expect(fetchRtFeed(`${baseUrl}/down`)).rejects.toThrow(/responded 502/);
  });

  test("refuses a body far larger than any real snapshot", async () => {
    await expect(fetchRtFeed(`${baseUrl}/huge`)).rejects.toThrow(/announced \d+ bytes/);
  });

  test("gives up on a hung request so the poll loop keeps its cadence", async () => {
    await expect(fetchRtFeed(`${baseUrl}/hang`, { timeoutMs: 50 })).rejects.toThrow();
  }, 10_000);
});
