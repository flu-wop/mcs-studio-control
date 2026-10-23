export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** OBS reports "HH:MM:SS.mmm"; show whole seconds. */
export function fmtTimecode(tc: string | undefined): string {
  if (!tc) return "00:00:00";
  return tc.split(".")[0];
}

export function fmtDisk(mb: number | null): string {
  if (mb === null || Number.isNaN(mb)) return "—";
  const gb = mb / 1024;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

/** Maps -60..0 dBFS to 0..100%. */
export function dbToPct(db: number | null): number {
  if (db === null || !Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export function fmtDb(db: number | null): string {
  if (db === null || !Number.isFinite(db)) return "—";
  if (db <= -60) return "-inf";
  return `${db.toFixed(0)}`;
}
