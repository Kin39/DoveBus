/**
 * Canonical form for name matching (comune autocomplete, stop-name text fallback,
 * line lookup): uppercase, accent-stripped, alphanumerics only.
 *
 * "Colle di Val d'Elsa" -> "COLLEDIVALDELSA", so spacing, apostrophes and accents
 * can never make two spellings of the same place miss each other.
 */
export function normalizeName(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9]/g, "");
}
