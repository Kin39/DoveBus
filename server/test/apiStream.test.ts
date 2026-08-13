import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type ApiFixture, createApiFixture, vehicleTimestamp } from "./helpers/apiFixture.js";

const DATE = "20260812";

interface SseEvent {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** Minimal SSE reader: enough to assert what the frontend's EventSource will see. */
function eventReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const next = async (timeoutMs = 2000): Promise<SseEvent | null> => {
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseFrame(frame);
        if (parsed) return parsed;
        continue;
      }

      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (chunk === null || chunk.done) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };

  return { next, cancel: () => reader.cancel() };
}

function parseFrame(frame: string): SseEvent | null {
  const lines = frame.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
  const data = lines.find((line) => line.startsWith("data: "))?.slice(6);
  if (!event || !data) return null; // a heartbeat comment
  return { event, data: JSON.parse(data) as Record<string, unknown> };
}

describe("GET /api/stream/trip/:tripId", () => {
  let fixture: ApiFixture;
  let baseUrl: string;

  beforeEach(async () => {
    fixture = await createApiFixture();
    await fixture.realtime.pollOnce();
    await fixture.app.listen({ port: 0, host: "127.0.0.1" });
    const address = fixture.app.server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await fixture.dispose();
  });

  test("opens with the current live picture of the run", async () => {
    const response = await fetch(`${baseUrl}/api/stream/trip/T1?date=${DATE}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const stream = eventReader(response.body as ReadableStream<Uint8Array>);
    const first = await stream.next();
    expect(first?.event).toBe("snapshot");
    expect(first?.data).toMatchObject({
      tripId: "T1",
      date: DATE,
      live: { vehicle: { lat: 43.47, delaySeconds: 180, freshness: "live" } },
    });

    await stream.cancel();
  });

  test("pushes an update when the poller sees the bus move", async () => {
    const response = await fetch(`${baseUrl}/api/stream/trip/T1?date=${DATE}`);
    const stream = eventReader(response.body as ReadableStream<Uint8Array>);
    await stream.next();

    fixture.setVehicles([
      {
        tripId: "T1",
        routeId: "R1",
        startDate: DATE,
        lat: 43.5,
        lon: 11.95,
        vehicleId: "BUS1",
        timestamp: vehicleTimestamp(),
      },
    ]);
    await fixture.realtime.pollOnce();

    const update = await stream.next();
    expect(update?.event).toBe("update");
    expect(update?.data).toMatchObject({ live: { vehicle: { lat: 43.5, lon: 11.95 } } });
    // The trail is the whole point: both positions, in the order travelled.
    const live = update?.data.live as { trail: ReadonlyArray<{ lat: number }> };
    expect(live.trail.map((point) => point.lat)).toEqual([43.47, 43.5]);

    await stream.cancel();
  });

  test("stays quiet when a poll brings nothing new", async () => {
    const response = await fetch(`${baseUrl}/api/stream/trip/T1?date=${DATE}`);
    const stream = eventReader(response.body as ReadableStream<Uint8Array>);
    await stream.next();

    // Same snapshot again: re-sending an identical position would be noise on
    // every connected client, every 30 seconds.
    await fixture.realtime.pollOnce();
    expect(await stream.next(300)).toBeNull();

    await stream.cancel();
  });

  test("streams a run nobody is driving as live: null rather than refusing", async () => {
    const response = await fetch(`${baseUrl}/api/stream/trip/T2?date=${DATE}`);
    const stream = eventReader(response.body as ReadableStream<Uint8Array>);
    expect((await stream.next())?.data.live).toBeNull();
    await stream.cancel();
  });

  test("404s an unknown trip before hijacking the response", async () => {
    const response = await fetch(`${baseUrl}/api/stream/trip/NOPE`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "not_found" },
    });
  });

  test("keeps polling after a client disconnects", async () => {
    const response = await fetch(`${baseUrl}/api/stream/trip/T1?date=${DATE}`);
    const stream = eventReader(response.body as ReadableStream<Uint8Array>);
    await stream.next();
    await stream.cancel();

    await expect(fixture.realtime.pollOnce()).resolves.toBeUndefined();
  });
});
