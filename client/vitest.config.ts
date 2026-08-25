import { defineConfig } from "vitest/config";

/**
 * The client's unit tests.
 *
 * Deliberately no DOM environment: what is worth testing here is the reasoning
 * the interface does *before* it touches a node — which bus stays on the map,
 * how far a viewport query has to reach, what a typed time string means. The
 * rendering itself is checked where it can actually be seen, by the Playwright
 * loops in `scripts/` against the real API.
 *
 * Coverage is therefore scoped to those pure modules rather than to `src/**`:
 * a threshold spread over MapLibre wiring and `main.ts` would be a number that
 * measures how much of the app is untestable from Node, not how well the logic
 * that *is* testable is covered.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/count/counter.ts",
        "src/map/tracking.ts",
        "src/map/viewport.ts",
        "src/ui/when.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
