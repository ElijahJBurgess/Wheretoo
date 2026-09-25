import { importWallTime } from "./eventImportTime.ts";
export type RowIssue = { field: string; code: string; message: string };
export type ImportInput = {
  title: string;
  description: string;
  category: string;
  venue_name: string;
  address: string;
  city: string;
  postal_code: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  starts_at: string | null;
  ends_at: string | null;
  capacity: number | null;
  source_url: string;
  source_name: string;
  notes: string;
};
export function validateImportRow(
  cells: Record<string, string>,
  now: number,
  wallTime: typeof importWallTime = importWallTime,
): { input: ImportInput; errors: RowIssue[] } {
  const c = Object.fromEntries(
    Object.entries(cells).map(([k, v]) => [k, v.trim()]),
  );
  const errors: RowIssue[] = [];
  const issue = (field: string, code: string) =>
    errors.push({
      field,
      code,
      message: `${field}: ${code.replaceAll("_", " ").toLowerCase()}`,
    });
  for (
    const [field, min, max] of [
      ["title", 3, 120],
      ["description", 20, 5000],
      ["venue_name", 1, 160],
      ["address", 1, 250],
      ["city", 1, 120],
      ["source_url", 0, 2048],
      ["source_name", 0, 160],
      ["notes", 0, 1000],
    ] as const
  ) {
    const value = c[field] ?? "";
    const length = [...value].length;
    if (length < min || length > max) issue(field, "INVALID_LENGTH");
    const multiline = field === "description" || field === "notes";
    if (
      [...value].some((char) => {
        const code = char.codePointAt(0)!;
        return code === 127 ||
          (code < 32 && !(multiline && [9, 10, 13].includes(code)));
      })
    ) issue(field, "INVALID_TEXT");
  }
  if (
    ![
      "food_drink",
      "music",
      "fitness",
      "art_culture",
      "shopping",
      "community",
      "nightlife",
      "other",
    ].includes(c.category)
  ) issue("category", "INVALID_CATEGORY");
  if (!/^\d{5}(-\d{4})?$/.test(c.postal_code)) {
    issue("postal_code", "INVALID_POSTAL_CODE");
  }
  let capacity: number | null = null;
  if (c.capacity) {
    capacity = Number(c.capacity);
    if (
      !/^\d+$/.test(c.capacity) || !Number.isSafeInteger(capacity) ||
      capacity < 1 || capacity > 2147483647
    ) {
      issue("capacity", "INVALID_CAPACITY");
      capacity = null;
    }
  }
  if (c.source_url) {
    try {
      const u = new URL(c.source_url);
      if (
        !["http:", "https:"].includes(u.protocol) || u.username || u.password
      ) throw Error();
    } catch {
      issue("source_url", "INVALID_URL");
    }
  }
  const starts_at = wallTime(c.start_date ?? "", c.start_time ?? ""),
    ends_at = wallTime(c.end_date ?? "", c.end_time ?? "");
  if (!starts_at || Date.parse(starts_at) <= now) {
    issue("start_time", "INVALID_OR_PAST_START");
  }
  if (!ends_at || !starts_at || Date.parse(ends_at) <= Date.parse(starts_at)) {
    issue("end_time", "INVALID_END");
  }
  const input = {
    ...c,
    capacity,
    starts_at,
    ends_at,
    source_url: c.source_url ?? "",
    source_name: c.source_name ?? "",
    notes: c.notes ?? "",
  } as ImportInput;
  return { input, errors };
}

/** Cache only within one upload; no identity or source data survives a request. */
export function createImportRowValidator(now: number) {
  const cache = new Map<string, string | null>();
  const wallTime = (date: string, time: string) => {
    const key = date + " " + time;
    if (!cache.has(key)) cache.set(key, importWallTime(date, time));
    return cache.get(key)!;
  };
  return (cells: Record<string, string>) =>
    validateImportRow(cells, now, wallTime);
}
