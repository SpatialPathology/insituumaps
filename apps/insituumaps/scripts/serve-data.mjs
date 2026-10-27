#!/usr/bin/env node
/**
 * Serves a folder as static files with HTTP range requests and CORS, the way
 * a bucket behind a proxy would. Used to serve the test data to the viewer.
 *
 *   node scripts/serve-data.mjs [folder] [--port 8787]
 *
 * Defaults: folder = test-data, port = 8787.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const args = process.argv.slice(2);
let folder = "test-data";
let port = 8787;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") {
    port = Number(args[++i]);
  } else if (!args[i].startsWith("--")) {
    folder = args[i];
  }
}
const root = resolve(folder);

const mimeTypes = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".parquet": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".geojson": "application/geo+json",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".html": "text/html",
};

const server = http.createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const relative = normalize(decodeURIComponent(url.pathname)).replace(
    /^(\.\.(\/|\\|$))+/,
    "",
  );
  const path = join(root, relative);
  if (!path.startsWith(root + sep) && path !== root) {
    res.writeHead(403, headers);
    res.end();
    return;
  }
  let info;
  try {
    info = await stat(path);
  } catch {
    res.writeHead(404, headers);
    res.end();
    return;
  }
  if (info.isDirectory()) {
    // a static build: serve its index.html at the folder root
    try {
      const indexPath = join(path, "index.html");
      info = await stat(indexPath);
      return serveFile(req, res, headers, indexPath, info);
    } catch {
      res.writeHead(404, headers);
      res.end();
      return;
    }
  }
  return serveFile(req, res, headers, path, info);
});

function serveFile(req, res, headers, path, info) {
  const size = info.size;
  const type = mimeTypes[extname(path)] ?? "application/octet-stream";
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range !== undefined) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match === null) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    if (match[1] === "" && match[2] !== "") {
      start = Math.max(0, size - Number(match[2]));
    } else {
      start = Number(match[1]);
      end = match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (start > end || start >= size) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Type"] = type;
  headers["Content-Length"] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(path, { start, end }).pipe(res);
}

server.listen(port, () => {
  console.log(
    `Serving ${root} at http://localhost:${port}/ (range requests, CORS)`,
  );
});
