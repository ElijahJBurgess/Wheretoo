import { parse } from "csv-parse/sync";
export const requiredHeaders = [
  "title",
  "description",
  "category",
  "start_date",
  "start_time",
  "end_date",
  "end_time",
  "venue_name",
  "address",
  "city",
  "postal_code",
] as const;
export const optionalHeaders = [
  "capacity",
  "source_url",
  "source_name",
  "notes",
] as const;
export function parseImportCsv(
  bytes: Uint8Array,
): {
  rows: {
    recordNumber: number;
    startLine: number;
    cells: Record<string, string>;
  }[];
} {
  if (bytes.length > 2097152) throw Error("FILE_TOO_LARGE");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(bytes);
  if (text.includes("\0")) throw Error("INVALID_ENCODING");
  const records = parse(text, {
    bom: true,
    columns: false,
    relax_column_count: false,
    skip_empty_lines: true,
    max_record_size: 65536,
    info: true,
  }) as unknown as {
    record: string[];
    info: { lines: number; empty_lines: number };
  }[];
  const first = records.shift();
  const header = first?.record;
  if (
    !header || new Set(header).size !== header.length ||
    requiredHeaders.some((h) => !header.includes(h)) ||
    header.some((h) =>
      ![...requiredHeaders, ...optionalHeaders].includes(
        h as typeof requiredHeaders[number],
      )
    )
  ) throw Error("INVALID_HEADERS");
  const rows = [];
  let previousLine = first!.info.lines;
  let previousEmpty = first!.info.empty_lines;
  let recordNumber = 1;
  for (const entry of records) {
    recordNumber++;
    const startLine = previousLine + 1 + entry.info.empty_lines - previousEmpty;
    previousLine = entry.info.lines;
    previousEmpty = entry.info.empty_lines;
    if (entry.record.every((v) => v.trim() === "")) continue;
    if (entry.record.length !== header.length) throw Error("INVALID_COLUMNS");
    rows.push({
      recordNumber,
      startLine,
      cells: Object.fromEntries(header.map((h, i) => [h, entry.record[i]])),
    });
    if (rows.length > 500) throw Error("TOO_MANY_ROWS");
  }
  if (!rows.length) throw Error("EMPTY_FILE");
  return { rows };
}
