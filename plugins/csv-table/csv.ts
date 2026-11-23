export const CSV_MAX_DATA_ROWS = 5_000;
export const CSV_MAX_COLUMNS = 100;
export const CSV_MAX_BYTES = 2_000_000;

export type CsvDelimiter = "," | ";" | "\t";

export interface CsvRecord {
  cells: string[];
  /** 1-based line where this record starts. Quoted fields can continue past it. */
  startLine: number;
}

export interface ParsedCsv {
  delimiter: CsvDelimiter;
  headers: string[];
  rows: CsvRecord[];
  truncatedRows: boolean;
  truncatedColumns: boolean;
}

export interface ParseCsvLimits {
  maxDataRows?: number;
  maxColumns?: number;
}

const DELIMITERS = [",", ";", "\t"] as const;

export function detectDelimiter(content: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') index += 1;
        else inQuotes = false;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === "\n" || character === "\r") break;
    if (character === "," || character === ";" || character === "\t") {
      counts[character] += 1;
    }
  }
  return DELIMITERS.reduce((best, delimiter) =>
    counts[delimiter] > counts[best] ? delimiter : best,
  );
}

export function parseCsv(
  content: string,
  limits: ParseCsvLimits = {},
): ParsedCsv {
  const maxDataRows = limits.maxDataRows ?? CSV_MAX_DATA_ROWS;
  const maxColumns = limits.maxColumns ?? CSV_MAX_COLUMNS;
  const text = content.replace(/^\uFEFF/u, "");
  const delimiter = detectDelimiter(text);
  const maxRecords = maxDataRows + 1;
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let endedWithLineBreak = text.length === 0;
  let line = 1;
  let startLine = 1;
  let truncatedRows = false;
  let truncatedColumns = false;

  const pushField = () => {
    if (row.length < maxColumns) row.push(field);
    else truncatedColumns = true;
    field = "";
    quotedField = false;
  };

  const pushRow = () => {
    if (records.length < maxRecords) {
      records.push({ cells: row, startLine });
    } else {
      truncatedRows = true;
    }
    row = [];
    startLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (truncatedRows) break;
    endedWithLineBreak = false;

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
        continue;
      }
      if (character === "\r" || character === "\n") {
        field += "\n";
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        line += 1;
        continue;
      }
      field += character;
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      quotedField = true;
      continue;
    }

    if (character === delimiter) {
      pushField();
      continue;
    }

    if (character === "\n" || character === "\r") {
      const blankLine = row.length === 0 && field.length === 0 && !quotedField;
      line += 1;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (blankLine) {
        startLine = line;
      } else {
        pushField();
        pushRow();
      }
      endedWithLineBreak = true;
      continue;
    }

    field += character;
  }

  if (
    !truncatedRows &&
    (field.length > 0 || row.length > 0 || quotedField || !endedWithLineBreak)
  ) {
    pushField();
    pushRow();
  }

  return buildTable(
    records,
    delimiter,
    truncatedRows,
    truncatedColumns,
    text.trim() === "",
  );
}

function buildTable(
  records: CsvRecord[],
  delimiter: CsvDelimiter,
  truncatedRows: boolean,
  truncatedColumns: boolean,
  empty: boolean,
): ParsedCsv {
  if (empty || records.length === 0) {
    return {
      delimiter,
      headers: [],
      rows: [],
      truncatedRows: false,
      truncatedColumns: false,
    };
  }
  const width = records.reduce(
    (maximum, record) => Math.max(maximum, record.cells.length),
    0,
  );
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, index) =>
    uniqueHeader(records[0]?.cells[index] ?? "", index, seen),
  );
  const rows = records.slice(1).map((record) => ({
    startLine: record.startLine,
    cells: Array.from(
      { length: width },
      (_, index) => record.cells[index] ?? "",
    ),
  }));
  return { delimiter, headers, rows, truncatedRows, truncatedColumns };
}

function uniqueHeader(
  raw: string,
  index: number,
  seen: Map<string, number>,
): string {
  const base = raw.trim() === "" ? `Column ${index + 1}` : raw.trim();
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base} (${count + 1})`;
}

/** Index of the data row that contains this 1-based line, or -1. */
export function rowIndexAtLine(
  rows: readonly CsvRecord[],
  line: number,
): number {
  let found = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]!.startLine <= line) found = index;
    else break;
  }
  return found;
}

export function delimiterLabel(delimiter: CsvDelimiter): string {
  switch (delimiter) {
    case ",":
      return "comma";
    case ";":
      return "semicolon";
    case "\t":
      return "tab";
  }
}
