/** What the map can see, in degrees. */
export interface Viewport {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** What the API is asked about. */
export interface Bbox {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

const METRES_PER_DEGREE = 111_320;

/**
 * The smallest distance a fleet request may reach beyond the viewport.
 *
 * The server answers from each bus's last *reported* position; the map draws it
 * at the position we have advanced it to. Those two are the same thing only for
 * a bus that has just reported — in between they diverge by whatever the bus has
 * covered, measured on this feed at 1.1–1.9 km on an ordinary urban run.
 *
 * A fraction of the viewport is the right margin while the viewport is large,
 * and useless once it is not: at zoom 16 the visible strip is ~1.4 km, so 15% of
 * it is 210 m and every bus on screen can be outside the box its own marker sits
 * in. Two kilometres each side is the floor because it covers that measured
 * divergence with room to spare, and it costs ~25 vehicles in a city viewport —
 * a few kilobytes, once every thirty seconds.
 */
export const FOLLOW_PAD_M = 2_000;

/**
 * Grows a viewport into the box to ask the API about.
 *
 * `margin` is the fraction of the viewport added on each side, so a small pan
 * finds the next bus already loaded; `minPadMetres` is the floor that keeps the
 * request meaningful when the viewport itself has become smaller than the
 * distance a bus travels between two fixes.
 *
 * The longitude pad is corrected for latitude: the floor is a distance, and a
 * degree of longitude is 111 km at the equator and 56 km at 60°N.
 */
export function padViewport(view: Viewport, margin: number, minPadMetres: number): Bbox {
  const midLat = (view.north + view.south) / 2;
  const metresPerLonDegree = Math.max(1, METRES_PER_DEGREE * Math.cos((midLat * Math.PI) / 180));

  const latPad = Math.max((view.north - view.south) * margin, minPadMetres / METRES_PER_DEGREE);
  const lonPad = Math.max((view.east - view.west) * margin, minPadMetres / metresPerLonDegree);

  return {
    minLon: view.west - lonPad,
    minLat: view.south - latPad,
    maxLon: view.east + lonPad,
    maxLat: view.north + latPad,
  };
}
