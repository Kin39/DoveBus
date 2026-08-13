/**
 * Decimals kept on any coordinate leaving this process: ~1 m on the ground.
 *
 * Realtime positions arrive as protobuf floats, so a bus at 43.47 reaches us as
 * 43.470001220703125 — seventeen digits of noise, times two per point, times
 * ~1100 vehicles a request and thousands of points a shape. The precision is not
 * real and the bytes are.
 */
export const COORDINATE_DECIMALS = 5;

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(COORDINATE_DECIMALS));
}
