const UNITS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** A GP amount like "100m", "4.5b", "250k" or "1,000,000"; null when it isn't one */
export const parseGp = (text: string): number | null => {
  const m = text.trim().toLowerCase().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] ? UNITS[m[2]] : 1));
};

const trim = (n: number) => String(Number(n.toFixed(2)));

export const formatGp = (gp: number): string => {
  if (gp >= 1e9) return `${trim(gp / 1e9)}b`;
  if (gp >= 1e6) return `${trim(gp / 1e6)}m`;
  if (gp >= 1e3) return `${trim(gp / 1e3)}k`;
  return String(Math.round(gp));
};

/** Seconds as m:ss */
export const formatTime = (seconds: number): string => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
