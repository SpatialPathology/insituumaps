import { describe, expect, it } from "vitest";

import { raceSignal } from "./utils";

describe("raceSignal", () => {
  it("passes the promise through without a signal", async () => {
    const promise = Promise.resolve(1);
    expect(raceSignal(promise)).toBe(promise);
    expect(await raceSignal(promise)).toBe(1);
  });

  it("resolves and rejects with the promise while not aborted", async () => {
    const signal = new AbortController().signal;
    expect(await raceSignal(Promise.resolve(1), signal)).toBe(1);
    await expect(
      raceSignal(Promise.reject(new Error("failed")), signal),
    ).rejects.toThrow("failed");
  });

  it("rejects with the signal's reason once aborted, leaving the promise running", async () => {
    let resolveShared: (value: number) => void = () => {};
    const shared = new Promise<number>((resolve) => (resolveShared = resolve));
    const abortController = new AbortController();
    const raced = raceSignal(shared, abortController.signal);
    abortController.abort(new Error("stop"));
    await expect(raced).rejects.toThrow("stop");
    resolveShared(2);
    expect(await shared).toBe(2);
    expect(await raceSignal(shared)).toBe(2);
  });

  it("rejects at once for an aborted signal", async () => {
    const abortController = new AbortController();
    abortController.abort(new Error("stopped"));
    await expect(
      raceSignal(Promise.resolve(1), abortController.signal),
    ).rejects.toThrow("stopped");
  });
});
