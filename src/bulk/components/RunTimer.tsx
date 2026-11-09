import React, { useEffect, useState } from 'react';

// how much of a stage has to be done, and for how long, before its pace says anything
const MIN_DONE = 3;
const MIN_SHARE = 0.05;
const MIN_MS = 3000;

/** The time left at the pace so far, in ms; null until there is enough to go on, or when nothing has moved */
export const remainingMs = (elapsed: number, done: number, doneAtStart: number, total: number): number | null => {
  const moved = done - doneAtStart;
  if (elapsed < MIN_MS || moved < Math.max(MIN_DONE, (total - doneAtStart) * MIN_SHARE)) return null;
  return ((total - done) / moved) * elapsed;
};

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const useNow = () => {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now - start;
};

/** Time since it appeared, in even-width digits so it holds still; left out of screen readers' status updates, which would read every second */
export const Elapsed: React.FC = () => {
  const elapsed = useNow();
  return <span aria-hidden className="shrink-0 tabular-nums">{clock(elapsed)}</span>;
};

/** An estimate for one stage, timed from when it appeared: give it a `key` per stage. Shows nothing until it can be honest. */
export const Remaining: React.FC<{ done: number; total: number; label?: string }> = ({ done, total, label = 'left' }) => {
  const elapsed = useNow();
  const [doneAtStart] = useState(done);
  const left = remainingMs(elapsed, done, doneAtStart, total);
  if (left === null) return null;
  return <span aria-hidden className="shrink-0 tabular-nums text-gray-500 dark:text-gray-300">{`about ${clock(left)} ${label}`}</span>;
};
