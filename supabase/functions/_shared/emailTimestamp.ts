export function validEmailTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value)
  ) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(
    /[-T:]/,
  ).map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= maxDay && hour <= 23 &&
    minute <= 59 && second <= 59 && Number.isFinite(Date.parse(value));
}
