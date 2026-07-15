import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/**
 * Returns the current time, refreshed on wall-clock minute boundaries.
 * Each timeout is scheduled from the current clock so delayed callbacks do not drift.
 */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleNextMinute = () => {
      const currentTime = Date.now();
      const delay = MINUTE_MS - (currentTime % MINUTE_MS);

      timeoutId = setTimeout(() => {
        setNow(Date.now());
        scheduleNextMinute();
      }, delay);
    };

    scheduleNextMinute();

    return () => clearTimeout(timeoutId);
  }, []);

  return now;
}
