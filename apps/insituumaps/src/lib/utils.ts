import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Formats a length in µm for display (switches to mm above 1000 µm) */
export function formatLength(um: number): string {
  if (um >= 1000) {
    const mm = um / 1000;
    return `${Number.isInteger(mm) ? mm : mm.toFixed(mm < 10 ? 1 : 0)} mm`;
  }
  return `${Number.isInteger(um) ? um : um.toFixed(um < 10 ? 1 : 0)} µm`;
}

/** Formats a legend number compactly */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }
  const abs = Math.abs(value);
  if (abs >= 100) {
    return value.toFixed(0);
  }
  if (abs >= 10) {
    return value.toFixed(1);
  }
  if (abs >= 1) {
    return value.toFixed(2);
  }
  return value.toPrecision(2);
}

/**
 * Waits for a shared promise on behalf of one caller (decision D15)
 *
 * Reads shared between callers run without any caller's signal, since an
 * aborted signal would fail them for every caller. Each caller instead races
 * its own signal against the shared promise, which only ends its own wait.
 *
 * @param promise - The shared promise, which keeps running when aborted
 * @param signal - The caller's signal, if any
 * @returns The promise's value
 * @throws The signal's reason once it is aborted, or the promise's rejection
 */
export function raceSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
