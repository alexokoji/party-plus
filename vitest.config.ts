import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Engine and geometry tests are pure and run fastest in node; only the
    // React hook tests need a DOM, opted in per-file via
    // `// @vitest-environment jsdom`.
    environment: "node",
    globals: false,
  },
});
