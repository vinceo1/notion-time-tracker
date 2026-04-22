import { useEffect, useState } from "react";

/**
 * Returns elapsed seconds since `startedAt` (epoch ms) while `running` is true.
 * Ticks once per second.
 */
export function useTimer(startedAt: number | null, running: boolean): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
