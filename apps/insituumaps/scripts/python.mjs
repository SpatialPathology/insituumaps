#!/usr/bin/env node
/**
 * Finds a working Python for the converter and fixture scripts. On Windows
 * `python3` is usually the Microsoft Store stub (exit code 9009), so the
 * candidates are tried in order and the first one that runs is used:
 * INSITUUMAPS_PYTHON, python3, python, py -3.
 *
 * Run directly, it forwards its arguments to that Python:
 *
 *   node scripts/python.mjs scripts/convert_project.py test-data/fixture
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const candidates = [
  process.env.INSITUUMAPS_PYTHON ? [process.env.INSITUUMAPS_PYTHON] : undefined,
  ["python3"],
  ["python"],
  process.platform === "win32" ? ["py", "-3"] : undefined,
].filter((c) => c !== undefined);

let found;

/** Returns [command, ...prefixArgs] of the first Python that runs */
export function findPython() {
  if (found === undefined) {
    found = candidates.find(([command, ...args]) => {
      const result = spawnSync(command, [...args, "-c", "import sys"], {
        stdio: "ignore",
      });
      return result.status === 0;
    });
    if (found === undefined) {
      throw new Error(
        "No Python found (tried INSITUUMAPS_PYTHON, python3, python, py -3). " +
          "Set INSITUUMAPS_PYTHON to a python executable.",
      );
    }
  }
  return found;
}

/** Runs Python with the given arguments, output to the console */
export function runPython(args) {
  const [command, ...prefix] = findPython();
  return spawnSync(command, [...prefix, ...args], { stdio: "inherit" });
}

if (resolve(process.argv[1] ?? "") === resolve(import.meta.filename)) {
  const result = runPython(process.argv.slice(2));
  process.exitCode = result.status ?? 1;
}
