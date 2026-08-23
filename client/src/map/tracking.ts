import type { Vehicle } from "../api/types.js";
import type { Fix } from "./estimate.js";

/** One bus as the map holds it: the fleet's word for it, and its last two fixes. */
export interface Tracked {
  readonly vehicle: Vehicle;
  /** The two most recent positions the bus reported, oldest first. */
  readonly previous: Fix | null;
  readonly latest: Fix;
}

/**
 * Folds a fleet snapshot into what the map is already tracking.
 *
 * Kept out of `VehicleLayer` because it is the part with rules in it: which fix
 * becomes "previous", when a repeated timestamp must not overwrite the pair a
 * speed is measured between, and which bus survives an answer that does not
 * mention it. None of that needs a WebGL context to be wrong, so none of it
 * needs one to be tested.
 *
 * **The followed bus is never dropped for being absent.** The fleet request is
 * bounded by the viewport and answered from each bus's last *reported* position,
 * while its marker is drawn at the position we have extrapolated to — measured
 * up to 1.9 km ahead. Zoom in far enough and the followed bus falls outside its
 * own request: the answer comes back without it, and a snapshot trusted as the
 * whole world would erase the one bus the rider is watching. It is kept until
 * the rider stops following it; the freshness meter, which never stops counting,
 * is what says how old the held position is.
 */
export function trackSnapshot(
  current: ReadonlyMap<string, Tracked>,
  vehicles: readonly Vehicle[],
  selectedKey: string | null,
): Map<string, Tracked> {
  const next = new Map<string, Tracked>();

  for (const vehicle of vehicles) {
    const fix: Fix = {
      lon: vehicle.lon,
      lat: vehicle.lat,
      // A bus with no clock of its own cannot be extrapolated, only placed.
      at: vehicle.timestamp ?? 0,
    };
    const existing = current.get(vehicle.key);
    const moved = existing !== undefined && existing.latest.at !== fix.at;

    // On first sight, take the earlier position the API sends rather than
    // waiting to observe one. Without it a freshly opened map would sit
    // motionless for a whole publisher cycle — about two minutes — before any
    // bus had two fixes to measure a speed between.
    const seeded: Fix | null =
      vehicle.previous === null
        ? null
        : { lon: vehicle.previous.lon, lat: vehicle.previous.lat, at: vehicle.previous.at };

    next.set(vehicle.key, {
      vehicle,
      previous: moved ? existing.latest : (existing?.previous ?? seeded),
      latest: moved || existing === undefined ? fix : existing.latest,
    });
  }

  if (selectedKey !== null && !next.has(selectedKey)) {
    const held = current.get(selectedKey);
    if (held) next.set(selectedKey, held);
  }

  return next;
}
