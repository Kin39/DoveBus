import { describe, expect, test } from "vitest";
import { decodeTripUpdates, decodeVehiclePositions } from "../src/rt/decode.js";
import { encodeTripUpdates, encodeVehiclePositions } from "./helpers/rtFixture.js";

describe("decodeVehiclePositions", () => {
  test("reads every field the live feed carries", () => {
    const snapshot = decodeVehiclePositions(
      encodeVehiclePositions([
        {
          tripId: "60732-4",
          routeId: "1104",
          directionId: 1,
          startDate: "20260812",
          startTime: "07:15:00",
          lat: 43.7696,
          lon: 11.2558,
          bearing: 90,
          speed: 8.5,
          stopId: "S1",
          currentStopSequence: 12,
          currentStatus: 2,
          vehicleId: "BUS42",
          vehicleLabel: "42",
          licensePlate: "AB123CD",
          occupancyStatus: 3,
          timestamp: 1_759_999_940,
        },
      ]),
    );

    expect(snapshot.headerTimestamp).toBe(1_760_000_000);
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.vehicles[0]).toMatchObject({
      tripId: "60732-4",
      routeId: "1104",
      directionId: 1,
      startDate: "20260812",
      startTime: "07:15:00",
      bearing: 90,
      speed: 8.5,
      stopId: "S1",
      currentStopSequence: 12,
      currentStatus: "IN_TRANSIT_TO",
      vehicleId: "BUS42",
      vehicleLabel: "42",
      licensePlate: "AB123CD",
      occupancyStatus: "STANDING_ROOM_ONLY",
      timestamp: 1_759_999_940,
    });
    // GTFS-RT carries coordinates as float32, so ~1e-5 degrees of drift is the wire format.
    expect(snapshot.vehicles[0]?.lat).toBeCloseTo(43.7696, 4);
    expect(snapshot.vehicles[0]?.lon).toBeCloseTo(11.2558, 4);
  });

  test("keeps deadheading buses that carry no trip", () => {
    const snapshot = decodeVehiclePositions(
      encodeVehiclePositions([{ vehicleId: "BUS7", timestamp: 1_760_000_000 }]),
    );

    expect(snapshot.vehicles[0]?.tripId).toBeNull();
    expect(snapshot.vehicles[0]?.vehicleId).toBe("BUS7");
    expect(snapshot.stats.withTrip).toBe(0);
  });

  test("drops positions outside Tuscany instead of drawing ghost buses", () => {
    const snapshot = decodeVehiclePositions(
      encodeVehiclePositions([
        { vehicleId: "OK", lat: 43.7, lon: 11.2 },
        { vehicleId: "NULL_ISLAND", lat: 0, lon: 0 },
        { vehicleId: "MILANO", lat: 45.46, lon: 9.19 },
      ]),
    );

    expect(snapshot.vehicles.map((vehicle) => vehicle.vehicleId)).toEqual(["OK"]);
    expect(snapshot.stats).toMatchObject({ entities: 3, positioned: 3, outsideBbox: 2 });
  });

  test("drops entities with no position at all", () => {
    const snapshot = decodeVehiclePositions(
      encodeVehiclePositions([{ vehicleId: "PARKED", noPosition: true }]),
    );

    expect(snapshot.vehicles).toHaveLength(0);
    expect(snapshot.stats).toMatchObject({ entities: 1, positioned: 0, outsideBbox: 0 });
  });

  test("reports a missing header timestamp rather than inventing one", () => {
    const snapshot = decodeVehiclePositions(encodeVehiclePositions([], null));
    expect(snapshot.headerTimestamp).toBeNull();
    expect(snapshot.vehicles).toEqual([]);
  });

  test("rejects a body that is not a GTFS-RT feed", () => {
    expect(() => decodeVehiclePositions(Buffer.from("<html>502 Bad Gateway</html>"))).toThrow(
      /vehicle-positions/,
    );
  });
});

describe("decodeTripUpdates", () => {
  test("reads delays and per-stop updates", () => {
    const snapshot = decodeTripUpdates(
      encodeTripUpdates([
        {
          tripId: "60732-4",
          routeId: "1104",
          startDate: "20260812",
          startTime: "07:15:00",
          directionId: 1,
          timestamp: 1_759_999_900,
          stopTimeUpdates: [
            { stopId: "S1", stopSequence: 10, arrivalDelay: 120, departureDelay: 130 },
            { stopId: "S2", stopSequence: 11, skipped: true },
          ],
        },
      ]),
    );

    expect(snapshot.headerTimestamp).toBe(1_760_000_000);
    const [update] = snapshot.updates;
    expect(update).toMatchObject({
      tripId: "60732-4",
      routeId: "1104",
      startDate: "20260812",
      startTime: "07:15:00",
      directionId: 1,
      scheduleRelationship: "SCHEDULED",
      timestamp: 1_759_999_900,
      delaySeconds: 120,
    });
    expect(update?.stopUpdates).toEqual([
      { stopId: "S1", stopSequence: 10, arrivalDelay: 120, departureDelay: 130, skipped: false },
      { stopId: "S2", stopSequence: 11, arrivalDelay: null, departureDelay: null, skipped: true },
    ]);
  });

  test("surfaces cancellations, which is why this feed is in the MVP", () => {
    const snapshot = decodeTripUpdates(
      encodeTripUpdates([{ tripId: "T1", startDate: "20260812", scheduleRelationship: 3 }]),
    );

    expect(snapshot.updates[0]?.scheduleRelationship).toBe("CANCELED");
    expect(snapshot.updates[0]?.delaySeconds).toBeNull();
  });

  test("falls back to the trip-level delay when no stop carries one", () => {
    const snapshot = decodeTripUpdates(
      encodeTripUpdates([
        { tripId: "T1", startDate: "20260812", delay: 300, stopTimeUpdates: [{ stopId: "S1" }] },
      ]),
    );

    expect(snapshot.updates[0]?.delaySeconds).toBe(300);
  });

  test("skips entities without a trip_id — they cannot be joined to anything", () => {
    const snapshot = decodeTripUpdates(
      encodeTripUpdates([{ startDate: "20260812" }, { tripId: "T1", startDate: "20260812" }]),
    );

    expect(snapshot.updates.map((update) => update.tripId)).toEqual(["T1"]);
    expect(snapshot.stats).toMatchObject({ entities: 2, withTrip: 1 });
  });

  test("rejects a body that is not a GTFS-RT feed", () => {
    expect(() => decodeTripUpdates(Buffer.from("nope"))).toThrow(/trip-updates/);
  });
});
