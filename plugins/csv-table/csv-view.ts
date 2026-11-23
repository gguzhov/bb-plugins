import type { CsvRecord } from "./csv";

export type SortDirection = "asc" | "desc";

export interface CsvSort {
  column: number;
  direction: SortDirection;
}

export interface CsvViewState {
  query: string;
  columnFilters: readonly string[];
  sort: CsvSort | null;
  page: number;
  pageSize: number;
}

export interface CsvViewRow extends CsvRecord {
  index: number;
}

export interface CsvView {
  rows: CsvViewRow[];
  matchCount: number;
  page: number;
  pageCount: number;
}

export function buildCsvView(
  rows: readonly CsvRecord[],
  state: CsvViewState,
): CsvView {
  const tokens = state.query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter((token) => token.length > 0);
  const columnFilters = state.columnFilters.map((filter) =>
    filter.trim().toLocaleLowerCase(),
  );
  const matched: CsvViewRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (!matches(row.cells, tokens, columnFilters)) continue;
    matched.push({ ...row, index });
  }
  const sorted =
    state.sort === null
      ? matched
      : matched
          .map((row, order) => ({ row, order }))
          .sort((left, right) => {
            const compared = compareCells(
              left.row.cells[state.sort!.column] ?? "",
              right.row.cells[state.sort!.column] ?? "",
              state.sort!.direction,
            );
            return compared === 0 ? left.order - right.order : compared;
          })
          .map((entry) => entry.row);
  const pageSize = Math.max(1, state.pageSize);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(0, state.page), pageCount - 1);
  const start = page * pageSize;
  return {
    rows: sorted.slice(start, start + pageSize),
    matchCount: sorted.length,
    page,
    pageCount,
  };
}

function matches(
  cells: readonly string[],
  tokens: readonly string[],
  columnFilters: readonly string[],
): boolean {
  for (let index = 0; index < columnFilters.length; index += 1) {
    const filter = columnFilters[index]!;
    if (filter.length === 0) continue;
    if (!(cells[index] ?? "").toLocaleLowerCase().includes(filter)) return false;
  }
  if (tokens.length === 0) return true;
  const haystack = cells.join("\u0001").toLocaleLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function compareCells(
  left: string,
  right: string,
  direction: SortDirection,
): number {
  const leftBlank = left.trim() === "";
  const rightBlank = right.trim() === "";
  if (leftBlank || rightBlank) {
    if (leftBlank && rightBlank) return 0;
    return leftBlank ? 1 : -1;
  }
  const compared = left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return direction === "asc" ? compared : -compared;
}

export function columnLooksNumeric(rows: readonly CsvRecord[], column: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const value = (row.cells[column] ?? "").trim();
    if (value === "") continue;
    seen += 1;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(value)) return false;
  }
  return seen > 0;
}

export function nextSort(current: CsvSort | null, column: number): CsvSort {
  if (current?.column !== column || current.direction === "desc") {
    return { column, direction: "asc" };
  }
  return { column, direction: "desc" };
}
