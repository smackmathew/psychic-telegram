/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    // Tests share one set of emulators; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
  build: {
    rollupOptions: {
      output: {
        // Pages are already code-split via React.lazy() (see src/App.tsx); this just
        // pulls the framework libs used by every route into their own stable, cacheable
        // chunk instead of duplicating/inlining them with app code.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-firebase": ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/functions"],
        },
      },
    },
  },
});
