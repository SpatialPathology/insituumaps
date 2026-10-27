/**
 * Where a project or experiment lives: a base URL (static files served with
 * HTTP range requests) or a local directory opened through the File System
 * Access API.
 *
 * Everything the data-access layer reads goes through this interface, and the
 * TissUUmaps data sources it builds are expressed as `resolve(relativePath)`:
 * absolute URLs for URL sources and workspace paths (`/a/b`) for directories,
 * for which the directory handle is the TissUUmaps workspace.
 */
export interface InSituSource {
  /** Kind of source */
  readonly kind: "url" | "directory";

  /** Human-readable description, e.g. the URL or the directory name */
  readonly label: string;

  /** The TissUUmaps workspace handle (directories only) */
  readonly workspace: FileSystemDirectoryHandle | null;

  /**
   * Resolves a path relative to this source to a TissUUmaps source string
   *
   * @param relativePath - Path relative to the source root, `/`-separated
   * @returns An absolute URL or a workspace path
   */
  resolve(relativePath: string): string;

  /** Returns a source rooted at a sub-directory */
  child(relativePath: string): InSituSource;

  /** Reads a small text file; rejects with {@link NotFoundError} if missing */
  readText(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<string>;

  /** Reads a small JSON file; rejects with {@link NotFoundError} if missing */
  readJSON<T = unknown>(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<T>;

  /**
   * Reads a byte range (inclusive start, exclusive end), the last
   * `suffixLength` bytes, or a whole file
   */
  readBytes(
    relativePath: string,
    options?: {
      signal?: AbortSignal;
      range?: [number, number];
      suffixLength?: number;
    },
  ): Promise<Uint8Array>;

  /** Whether a file or directory exists */
  exists(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean>;

  /**
   * Lists the entries of a directory, if the source can list (directories
   * can, static HTTP cannot); `null` when listing is not possible
   */
  list(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ name: string; kind: "file" | "directory" }[] | null>;
}

/** A file or directory that does not exist */
export class NotFoundError extends Error {
  override readonly name = "NotFoundError";

  constructor(path: string) {
    super(`Not found: ${path}`);
  }
}

function joinPath(base: string, relativePath: string): string {
  const parts = relativePath.split("/").filter((p) => p !== "" && p !== ".");
  const baseParts = base.split("/").filter((p) => p !== "");
  for (const part of parts) {
    if (part === "..") {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.join("/");
}

/** A source served over HTTP(S) from a base URL (a directory URL) */
export class URLSource implements InSituSource {
  readonly kind = "url";
  readonly workspace = null;
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    const url = new URL(baseUrl, document.baseURI);
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) {
      url.pathname += "/";
    }
    this.baseUrl = url.toString();
  }

  get label(): string {
    return this.baseUrl;
  }

  resolve(relativePath: string): string {
    return new URL(
      relativePath
        .split("/")
        .filter((p) => p !== "")
        .map((p) => encodeURIComponent(p))
        .join("/"),
      this.baseUrl,
    ).toString();
  }

  child(relativePath: string): InSituSource {
    return new URLSource(this.resolve(relativePath) + "/");
  }

  async readText(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const response = await this._fetch(relativePath, options);
    return await response.text();
  }

  async readJSON<T = unknown>(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    const text = await this.readText(relativePath, options);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`Invalid JSON in ${relativePath}`, { cause: error });
    }
  }

  async readBytes(
    relativePath: string,
    options?: {
      signal?: AbortSignal;
      range?: [number, number];
      suffixLength?: number;
    },
  ): Promise<Uint8Array> {
    const { signal, range, suffixLength } = options ?? {};
    const headers: Record<string, string> = {};
    if (range !== undefined) {
      if (range[1] <= range[0]) {
        return new Uint8Array(0);
      }
      headers["Range"] = `bytes=${range[0]}-${range[1] - 1}`;
    } else if (suffixLength !== undefined) {
      headers["Range"] = `bytes=-${suffixLength}`;
    }
    const response = await this._fetch(relativePath, { signal, headers });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) {
      // the server ignored the range request and sent the whole file
      if (range !== undefined) {
        return bytes.subarray(range[0], Math.min(range[1], bytes.length));
      }
      if (suffixLength !== undefined) {
        return bytes.subarray(Math.max(0, bytes.length - suffixLength));
      }
    }
    return bytes;
  }

  async exists(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<boolean> {
    const { signal } = options ?? {};
    const response = await fetch(this.resolve(relativePath), {
      method: "HEAD",
      signal,
    });
    if (response.status === 405 || response.status === 501) {
      // HEAD not supported: fall back to a ranged GET
      const getResponse = await fetch(this.resolve(relativePath), {
        headers: { Range: "bytes=0-0" },
        signal,
      });
      return getResponse.ok;
    }
    return response.ok;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  list(_relativePath: string): Promise<null> {
    return Promise.resolve(null);
  }

  private async _fetch(
    relativePath: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> {
    const { signal, headers } = options ?? {};
    const url = this.resolve(relativePath);
    const response = await fetch(url, { signal, headers });
    if (response.status === 404) {
      throw new NotFoundError(relativePath);
    }
    if (!response.ok) {
      throw new Error(
        `Failed to load ${relativePath}: ${response.status} ${response.statusText}`,
      );
    }
    return response;
  }
}

/** A source backed by a directory handle from the File System Access API */
export class DirectorySource implements InSituSource {
  readonly kind = "directory";
  readonly workspace: FileSystemDirectoryHandle;
  private readonly _root: FileSystemDirectoryHandle;
  private readonly _path: string;

  /**
   * @param workspace - The directory the user picked (the TissUUmaps workspace)
   * @param path - Path of this source within the workspace (empty for the root)
   */
  constructor(workspace: FileSystemDirectoryHandle, path: string = "") {
    this.workspace = workspace;
    this._root = workspace;
    this._path = path;
  }

  get label(): string {
    return this._path !== ""
      ? `${this.workspace.name}/${this._path}`
      : this.workspace.name;
  }

  resolve(relativePath: string): string {
    return "/" + joinPath(this._path, relativePath);
  }

  child(relativePath: string): InSituSource {
    return new DirectorySource(this._root, joinPath(this._path, relativePath));
  }

  async readText(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    const file = await this._getFile(relativePath, options);
    return await file.text();
  }

  async readJSON<T = unknown>(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    const text = await this.readText(relativePath, options);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`Invalid JSON in ${relativePath}`, { cause: error });
    }
  }

  async readBytes(
    relativePath: string,
    options?: {
      signal?: AbortSignal;
      range?: [number, number];
      suffixLength?: number;
    },
  ): Promise<Uint8Array> {
    const { range, suffixLength } = options ?? {};
    const file = await this._getFile(relativePath, options);
    const blob =
      range !== undefined
        ? file.slice(range[0], range[1])
        : suffixLength !== undefined
          ? file.slice(Math.max(0, file.size - suffixLength))
          : file;
    return new Uint8Array(await blob.arrayBuffer());
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await this._getEntry(relativePath);
      return true;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      throw error;
    }
  }

  async list(
    relativePath: string,
  ): Promise<{ name: string; kind: "file" | "directory" }[] | null> {
    const entry = await this._getEntry(relativePath);
    if (entry.kind !== "directory") {
      throw new Error(`Not a directory: ${relativePath}`);
    }
    const entries: { name: string; kind: "file" | "directory" }[] = [];
    for await (const [name, handle] of (
      entry as unknown as {
        entries(): AsyncIterable<[string, FileSystemHandle]>;
      }
    ).entries()) {
      entries.push({ name, kind: handle.kind });
    }
    return entries.toSorted((a, b) => a.name.localeCompare(b.name));
  }

  private async _getEntry(
    relativePath: string,
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    const segments = joinPath(this._path, relativePath)
      .split("/")
      .filter((s) => s !== "");
    let dir = this._root;
    const fullPath = segments.join("/");
    try {
      for (let i = 0; i < segments.length - 1; i++) {
        dir = await dir.getDirectoryHandle(segments[i]!);
      }
      const name = segments.at(-1);
      if (name === undefined) {
        return dir;
      }
      try {
        return await dir.getFileHandle(name);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "TypeMismatchError"
        ) {
          return await dir.getDirectoryHandle(name);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new NotFoundError(fullPath);
      }
      throw error;
    }
  }

  private async _getFile(
    relativePath: string,
    options?: { signal?: AbortSignal },
  ): Promise<File> {
    const { signal } = options ?? {};
    signal?.throwIfAborted();
    const entry = await this._getEntry(relativePath);
    if (entry.kind !== "file") {
      throw new Error(`Not a file: ${relativePath}`);
    }
    const file = await entry.getFile();
    signal?.throwIfAborted();
    return file;
  }
}
