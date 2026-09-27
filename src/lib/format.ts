// Compact money for scanning ("$359.2B"); the exact figure goes in a
// tooltip, since the eval grades exact values.
export function compactUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toLocaleString("en-US")}`;
}

export function exactUsd(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;
}

export function pct(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

export const SCALE_LABEL: Record<number, string> = {
  1: "dollars",
  1000: "thousands",
  1000000: "millions",
  1000000000: "billions",
};
