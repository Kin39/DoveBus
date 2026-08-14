import { defineConfig } from "vite";

/**
 * Port 5280 is fixed by the plan so it never collides with another project on
 * 5173, and `strictPort` makes a collision fail loudly instead of silently
 * hopping to 5281 — the screenshot loop and `VITE_API_BASE` both assume the
 * address they were told.
 */
export default defineConfig({
  server: { port: 5280, strictPort: true },
  preview: { port: 5280, strictPort: true },
  build: { target: "es2022", sourcemap: true },
});
