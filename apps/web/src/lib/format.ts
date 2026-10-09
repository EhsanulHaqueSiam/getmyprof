/** "$0.0245", "$0.17", "$12.40": up to four decimals for small sums, two otherwise. */
export function usd(v: number) {
  if (v === 0) return "free";
  return `$${v < 1 ? v.toFixed(4).replace(/0{1,2}$/, "") : v.toFixed(2)}`;
}

/** "now", "12m", "3h", "2d", or a date for anything older than a week. */
export function ago(iso: string | null, nowMs = Date.now()) {
  if (!iso) return "";
  const s = Math.max(0, (nowMs - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "48s", "1m 12s", "3h 05m". */
export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "just now", "12m ago", or a date past a week: for labels that read "synced …". */
export function since(iso: string | null, nowMs = Date.now()) {
  const a = ago(iso, nowMs);
  return a === "now" ? "just now" : /^\d/.test(a) ? `${a} ago` : a;
}
