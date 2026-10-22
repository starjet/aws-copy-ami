/** Parse a `key=value,key2=value2` string into S3 tag pairs. */
export function parseTags(input: string | undefined): { key: string; value: string }[] {
  if (!input) return [];
  const pairs: { key: string; value: string }[] = [];
  for (const raw of input.split(",")) {
    const segment = raw.trim();
    if (segment === "") continue;
    const eq = segment.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid tag "${segment}". Expected key=value.`);
    }
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (key === "") {
      throw new Error(`Invalid tag "${segment}". Tag key must not be empty.`);
    }
    pairs.push({ key, value });
  }
  return pairs;
}

/** Human-readable byte size, e.g. 1536 -> "1.50 KiB". */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || Number.isNaN(bytes)) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

/** Positive integer parser for CLI numeric options. */
export function parsePositiveInt(raw: string, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer (got "${raw}").`);
  }
  return n;
}
