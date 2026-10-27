## Ideas

- Explore adding Rust/WASM modules (via `wasm-pack`, run in Web Workers) to the TissUUmaps 4 TypeScript monorepo for compute-heavy tasks such as spatial indexing, geometry operations and large-file decoding, keeping TypeScript and WebGL for the UI and rendering. Profile first to find the real bottlenecks, and use coarse-grained JS/WASM calls with shared typed arrays to avoid boundary overhead.
