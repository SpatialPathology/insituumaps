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
