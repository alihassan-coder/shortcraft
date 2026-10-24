import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  // Compile TSX with the automatic runtime (Next handles this itself in the app).
  esbuild: { jsx: "automatic" },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["lib/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "component",
          include: ["components/**/*.test.tsx", "tests/component/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          css: false,
        },
      },
    ],
  },
});
