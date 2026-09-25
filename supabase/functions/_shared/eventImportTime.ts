const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** Import has no offset column, so neither a gap nor a fold is an acceptable guess. */
export function importWallTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const [y, m, d] = date.split("-").map(Number),
    [h, min] = time.split(":").map(Number);
  if (
    y < 1000 || m < 1 || m > 12 || d < 1 ||
    d > new Date(Date.UTC(y, m, 0)).getUTCDate() || h > 23 || min > 59
  ) return null;
  const utc = Date.UTC(y, m - 1, d, h, min);
  const matches: number[] = [];
  for (let offset = -840; offset <= 840; offset += 15) {
    const candidate = utc - offset * 60000;
    const p = Object.fromEntries(
      formatter.formatToParts(candidate).map((p) => [p.type, Number(p.value)]),
    );
    if (
      p.year === y && p.month === m && p.day === d && p.hour === h &&
      p.minute === min
    ) matches.push(candidate);
  }
  return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
}
