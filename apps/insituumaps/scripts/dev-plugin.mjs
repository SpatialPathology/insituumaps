#!/usr/bin/env node
/**
 * Rebuilds the TissUUmaps plugin on every change and serves it with CORS, so
 * that the TissUUmaps app can load it through "Load plugin from URL":
 *
 *   pnpm --filter insituumaps dev:plugin [--port 8788]
 *
 * The plugin is then at http://localhost:8788/insitupy-plugin.js. Browsers
 * cache modules by URL: reload the page, or append `?v=2`, after a rebuild.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8788;
const appDir = resolve(import.meta.dirname, "..");
const outDir = resolve(appDir, "dist-plugin");
mkdirSync(outDir, { recursive: true });

const build = spawn(
  "pnpm",
  ["exec", "vite", "build", "--mode", "plugin", "--watch"],
  { cwd: appDir, stdio: "inherit", shell: process.platform === "win32" },
);
const server = spawn(
  process.execPath,
  [
    resolve(import.meta.dirname, "serve-data.mjs"),
    outDir,
    "--port",
    String(port),
  ],
  { stdio: "inherit" },
);
const stop = () => {
  build.kill();
  server.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
build.on("exit", stop);
setTimeout(() => {
  console.log(
    `\nLoad the plugin in TissUUmaps (plugins menu, "Load plugin from URL…"):\n  http://localhost:${port}/insitupy-plugin.js\n`,
  );
}, 1500);
