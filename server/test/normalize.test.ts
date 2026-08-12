import { describe, expect, test } from "vitest";
import { normalizeName } from "../src/geo/normalize.js";

describe("normalizeName", () => {
  test("uppercases and strips accents", () => {
    expect(normalizeName("Sesto Fiorentino")).toBe("SESTOFIORENTINO");
    expect(normalizeName("Bagni di Lucca")).toBe("BAGNIDILUCCA");
    expect(normalizeName("Barberino Tavarnelle")).toBe("BARBERINOTAVARNELLE");
  });

  test("strips accents so accented and unaccented spellings collide", () => {
    expect(normalizeName("Città di Castello")).toBe(normalizeName("Citta di Castello"));
    expect(normalizeName("Forlì")).toBe("FORLI");
  });

  test("drops punctuation and apostrophes", () => {
    expect(normalizeName("Colle di Val d'Elsa")).toBe("COLLEDIVALDELSA");
    expect(normalizeName("San Giovanni Valdarno.")).toBe("SANGIOVANNIVALDARNO");
    expect(normalizeName("Vicchio (Mugello)")).toBe("VICCHIOMUGELLO");
  });

  test("keeps digits", () => {
    expect(normalizeName("Linea 12A")).toBe("LINEA12A");
  });

  test("returns empty string for empty or symbol-only input", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("  -- ")).toBe("");
  });
});
