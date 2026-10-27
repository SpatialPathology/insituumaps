#!/usr/bin/env node
/**
 * Downloads, unzips and converts the test fixture (a 2-sample InSituExperiment
 * built from the public 10x Xenium breast cancer preview) into
 * apps/insituumaps/test-data/fixture.
 *
 *   pnpm --filter insituumaps fixture [--force]
 *
 * Requires python3 with numpy, zarr, h5py, scipy, pyarrow and anndata for the
 * conversion step (`pip install numpy zarr h5py scipy pyarrow anndata`).
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const fixtureUrl =
  "https://github.com/SpatialPathology/insituumaps/releases/download/fixture-v1/insituumaps-fixture-v1.zip";
const dataDir = resolve(import.meta.dirname, "../test-data");
const zipPath = resolve(dataDir, "insituumaps-fixture-v1.zip");
const fixtureDir = resolve(dataDir, "fixture");
const force = process.argv.includes("--force");

async function download() {
  if (existsSync(zipPath) && !force) {
    console.log(`Using existing ${zipPath}`);
    return;
  }
  console.log(`Downloading ${fixtureUrl} ...`);
  const response = await fetch(fixtureUrl);
  if (!response.ok || response.body === null) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }
  await mkdir(dataDir, { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));
  console.log("Downloaded.");
}

async function unzip() {
  if (existsSync(resolve(fixtureDir, "metadata.csv")) && !force) {
    console.log(`Using existing ${fixtureDir}`);
    return;
  }
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });
  console.log("Unzipping ...");
  const result = spawnSync("unzip", ["-q", zipPath, "-d", fixtureDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    // fall back to python's zipfile module
    const py = spawnSync(
      "python3",
      [
        "-c",
        `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`,
        zipPath,
        fixtureDir,
      ],
      { stdio: "inherit" },
    );
    if (py.status !== 0) {
      throw new Error("Unzipping failed (neither unzip nor python3 worked).");
    }
  }
}

function convert() {
  console.log(
    "Converting (AnnData layers, transcript index, demo cell layer) ...",
  );
  const result = spawnSync(
    "python3",
    [
      resolve(import.meta.dirname, "convert_project.py"),
      fixtureDir,
      "--duplicate-layer",
      "main-copy",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(
      "Conversion failed. The viewer still opens the fixture, with .X only and slow transcripts.",
    );
    process.exitCode = 1;
  }
}

await download();
await unzip();
convert();
console.log(
  `Fixture ready at ${fixtureDir}. Start the viewer with: pnpm --filter insituumaps dev:fixture`,
);
