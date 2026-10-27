/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import {
  defaultClientConditions,
  defaultServerConditions,
  defineConfig,
} from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // relative asset URLs, so the build works from any static host and sub-path
  base: "./",
  plugins: [react(), tailwindcss()],
  // Zarr probes for optional files: the dev server must 404 them, not serve index.html.
  appType: "mpa",
  server: {
    port: 5174,
    // the workspace packages import their assets (palettes) from the repo root
    fs: {
      allow: [resolve(import.meta.dirname, "../..")],
    },
  },
  build: {
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      checks: {
        pluginTimings: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
  },
  resolve: {
    conditions:
      mode === "production"
        ? [...defaultClientConditions]
        : ["tissuumaps-development", ...defaultClientConditions],
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  ssr: {
    resolve: {
      conditions:
        mode === "production"
          ? [...defaultServerConditions]
          : ["tissuumaps-development", ...defaultServerConditions],
    },
  },
}));
