#!/usr/bin/env node
/**
 * Starts the data server on the test data and the Vite dev server, and prints
 * the URL that opens the fixture experiment.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");
const fixtureDir = resolve(appDir, "test-data/fixture");
if (!existsSync(fixtureDir)) {
  console.error(
    "No fixture found. Run `pnpm --filter insituumaps fixture` first.",
  );
  process.exit(1);
}
const dataPort = 8787;
const appPort = 5174;
const dataServer = spawn(
  process.execPath,
  [
    resolve(import.meta.dirname, "serve-data.mjs"),
    resolve(appDir, "test-data"),
    "--port",
    String(dataPort),
  ],
  { stdio: "inherit" },
);
const vite = spawn(
  "pnpm",
  ["exec", "vite", "--port", String(appPort), "--strictPort"],
  {
    cwd: appDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
const stop = () => {
  dataServer.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
vite.on("exit", stop);
setTimeout(() => {
  console.log(
    `\nOpen the fixture experiment:\n  http://localhost:${appPort}/?source=http://localhost:${dataPort}/fixture/\n` +
      `Or a single sample:\n  http://localhost:${appPort}/?source=http://localhost:${dataPort}/fixture/data-000/\n`,
  );
}, 1500);
