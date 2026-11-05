/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import {
  type BuildEnvironmentOptions,
  defaultClientConditions,
  defaultServerConditions,
  defineConfig,
} from "vite";

/**
 * The build options of the `plugin` mode, which builds the viewer as a
 * TissUUmaps plugin: a single ES module file that the TissUUmaps app loads
 * through "Load plugin from URL" (see docs/lens-prototype-spec.md)
 *
 * The module bundles everything it imports (React, Zustand, the TissUUmaps
 * packages), since a plugin only receives the application's stores. Its
 * stylesheet is imported as a string by the entry and added to the page there.
 */
const pluginBuild: BuildEnvironmentOptions = {
  outDir: "dist-plugin",
  emptyOutDir: true,
  chunkSizeWarningLimit: 16384,
  // a plugin loaded from a file has to be a single file, assets included
  assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  lib: {
    entry: resolve(import.meta.dirname, "src/plugin/index.tsx"),
    formats: ["es"],
    fileName: () => "insitupy-plugin.js",
  },
  rolldownOptions: {
    output: {
      codeSplitting: false,
    },
    checks: {
      pluginTimings: false,
    },
  },
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const plugin = mode === "plugin";
  const production = mode === "production" || plugin;
  return {
    // relative asset URLs, so the build works from any static host and sub-path
    base: "./",
    plugins: [react(), tailwindcss()],
    // Zarr probes for optional files: the dev server must 404 them, not serve index.html.
    appType: "mpa",
    ...(plugin && {
      // the app's favicon is of no use to a plugin
      publicDir: false as const,
      define: {
        // libraries such as React read it; library builds do not replace it
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
    }),
    server: {
      port: 5174,
      // the workspace packages import their assets (palettes) from the repo root
      fs: {
        allow: [resolve(import.meta.dirname, "../..")],
      },
    },
    build: plugin
      ? pluginBuild
      : {
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
      conditions: production
        ? [...defaultClientConditions]
        : ["tissuumaps-development", ...defaultClientConditions],
      alias: {
        "@": resolve(import.meta.dirname, "./src"),
      },
    },
    ssr: {
      resolve: {
        conditions: production
          ? [...defaultServerConditions]
          : ["tissuumaps-development", ...defaultServerConditions],
      },
    },
  };
});
