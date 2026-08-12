import { describe, expect, test } from "vitest";
import { createComuneResolver, loadComuni } from "../src/geo/comuni.js";

/** Two disjoint unit squares standing in for comune polygons. */
const squareFeature = (name: string, istat: string, x: number, y: number) => ({
  type: "Feature" as const,
  properties: { name, com_istat_code: istat },
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  },
});

const collection = {
  type: "FeatureCollection" as const,
  features: [
    squareFeature("Arezzo", "051002", 11, 43),
    squareFeature("Anghiari", "051001", 12, 43),
    squareFeature("San Gimignano", "052021", 11, 44),
  ],
};

describe("loadComuni", () => {
  test("reads name, istat code, bbox and centroid from the GeoJSON", () => {
    const comuni = loadComuni(collection);
    expect(comuni).toHaveLength(3);
    const arezzo = comuni.find((c) => c.istatCode === "051002");
    expect(arezzo?.name).toBe("Arezzo");
    expect(arezzo?.nameNorm).toBe("AREZZO");
    expect(arezzo?.bbox).toEqual([11, 43, 12, 44]);
    expect(arezzo?.centroidLat).toBeCloseTo(43.5, 5);
    expect(arezzo?.centroidLon).toBeCloseTo(11.5, 5);
  });

  test("rejects input that is not a FeatureCollection", () => {
    expect(() => loadComuni({ type: "Feature" })).toThrow(/FeatureCollection/);
  });

  test("rejects a feature missing the istat code", () => {
    const broken = {
      type: "FeatureCollection",
      features: [{ ...squareFeature("X", "1", 0, 0), properties: { name: "X" } }],
    };
    expect(() => loadComuni(broken)).toThrow(/com_istat_code/);
  });
});

describe("createComuneResolver", () => {
  const resolve = createComuneResolver(loadComuni(collection));

  test("resolves a stop inside a polygon", () => {
    const hit = resolve({ lat: 43.5, lon: 11.5, name: "STAZIONE" });
    expect(hit).toEqual({ istatCode: "051002", name: "Arezzo", source: "polygon" });
  });

  test("prefers the polygon over a conflicting stop name", () => {
    const hit = resolve({ lat: 43.5, lon: 11.5, name: "ANGHIARI CENTRO" });
    expect(hit?.istatCode).toBe("051002");
    expect(hit?.source).toBe("polygon");
  });

  test("falls back to the stop name when the point is just outside the polygon", () => {
    // Coastline and border precision: a stop a few hundred metres out is still
    // its comune's stop.
    const hit = resolve({ lat: 42.98, lon: 12.02, name: "ANGHIARI CAPOLINEA" });
    expect(hit).toEqual({ istatCode: "051001", name: "Anghiari", source: "name" });
  });

  test("rejects a name match that is nowhere near that comune", () => {
    // Real case from the live feed: "BIVIO PRATO" is a junction 98 km from the
    // city of Prato. Assigning it to Prato would corrupt the comune search.
    expect(resolve({ lat: 40, lon: 8, name: "BIVIO AREZZO" })).toBeNull();
  });

  test("name fallback matches accented and punctuated spellings", () => {
    // Just north of the San Gimignano square, outside every polygon.
    const hit = resolve({ lat: 45.03, lon: 11.5, name: "San Gimignano, Porta S. Giovanni" });
    expect(hit?.istatCode).toBe("052021");
  });

  test("name fallback prefers the longest matching comune name", () => {
    const withShort = loadComuni({
      type: "FeatureCollection",
      features: [
        squareFeature("Gimignano", "999999", 0, 0),
        squareFeature("San Gimignano", "052021", 5, 5),
      ],
    });
    const hit = createComuneResolver(withShort)({
      lat: 4.98,
      lon: 5.5,
      name: "SAN GIMIGNANO CENTRO",
    });
    expect(hit?.istatCode).toBe("052021");
  });

  test("uses the name alone when the stop has no coordinates", () => {
    const hit = resolve({ lat: null, lon: null, name: "ANGHIARI CAPOLINEA" });
    expect(hit).toEqual({ istatCode: "051001", name: "Anghiari", source: "name" });
  });

  test("returns null for a stop outside Tuscany with an unrelated name", () => {
    // Cross-border stops (Emilia, Umbria, Liguria) legitimately have no comune.
    expect(resolve({ lat: 45.5, lon: 9.2, name: "PORRETTA TERME" })).toBeNull();
  });

  test("ignores comune names shorter than the minimum fallback length", () => {
    const tiny = loadComuni({
      type: "FeatureCollection",
      features: [squareFeature("Po", "000001", 0, 0)],
    });
    expect(createComuneResolver(tiny)({ lat: 1.02, lon: 0.5, name: "PONTE A POPPI" })).toBeNull();
  });

  test("returns null when coordinates are missing", () => {
    expect(resolve({ lat: null, lon: null, name: "NOWHERE" })).toBeNull();
  });
});
