import { useEffect, useState } from "react";

/** Re-renders every 30s so "Working 2m" and "synced 12m ago" stay true without a repainting animation. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
