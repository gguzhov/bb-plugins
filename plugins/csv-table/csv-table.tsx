import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  delimiterLabel,
  rowIndexAtLine,
  type ParsedCsv,
} from "./csv";
import {
  buildCsvView,
  columnLooksNumeric,
  nextSort,
  type CsvSort,
} from "./csv-view";

const PAGE_SIZE = 100;
/** Phone touch targets: at least 44 px tall (the vendored controls stop at 32-40). */
export const TOUCH_HEIGHT = "max-md:pointer-coarse:h-11";

export function CsvTable({
  parsed,
  lineRange,
  fileName,
  toolbarExtra = null,
}: {
  parsed: ParsedCsv;
  lineRange: { startLineNumber: number; endLineNumber: number } | null;
  fileName: string;
  toolbarExtra?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [columnFiltersOpen, setColumnFiltersOpen] = useState(false);
  const [columnFilters, setColumnFilters] = useState<string[]>(() =>
    parsed.headers.map(() => ""),
  );
  const [sort, setSort] = useState<CsvSort | null>(null);
  const [page, setPage] = useState(0);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const seenRange = useRef(lineRange);
  const rowNodes = useRef(new Map<number, HTMLTableRowElement>());
  const view = useMemo(
    () =>
      buildCsvView(parsed.rows, {
        query,
        columnFilters,
        sort,
        page,
        pageSize: PAGE_SIZE,
      }),
    [columnFilters, page, parsed.rows, query, sort],
  );
  const numericColumns = useMemo(
    () => parsed.headers.map((_, index) => columnLooksNumeric(parsed.rows, index)),
    [parsed.headers, parsed.rows],
  );
  const filtersActive =
    query.trim() !== "" || columnFilters.some((filter) => filter.trim() !== "");

  useEffect(() => {
    if (lineRange === null) {
      seenRange.current = null;
      return;
    }
    if (seenRange.current === lineRange) return;
    seenRange.current = lineRange;
    const index = rowIndexAtLine(parsed.rows, lineRange.startLineNumber);
    setQuery("");
    setColumnFilters(parsed.headers.map(() => ""));
    setSort(null);
    setPinnedIndex(index === -1 ? null : index);
    setPage(index === -1 ? 0 : Math.floor(index / PAGE_SIZE));
  }, [lineRange, parsed.headers, parsed.rows]);

  useEffect(() => {
    if (pinnedIndex === null) return;
    rowNodes.current.get(pinnedIndex)?.scrollIntoView({ block: "nearest" });
  }, [pinnedIndex, view.page, view.rows]);

  if (parsed.headers.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground" role="status">
        This CSV file is empty.
      </p>
    );
  }

  const rangeStart = view.matchCount === 0 ? 0 : view.page * PAGE_SIZE + 1;
  const rangeEnd = view.page * PAGE_SIZE + view.rows.length;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-48 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Filter rows"
            aria-label="Filter rows"
            className={cn("h-8 pl-8", TOUCH_HEIGHT)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={TOUCH_HEIGHT}
          aria-pressed={columnFiltersOpen}
          onClick={() => setColumnFiltersOpen((open) => !open)}
        >
          <Icon name="Filter" />
          Columns
        </Button>
        {filtersActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={TOUCH_HEIGHT}
            onClick={() => {
              setQuery("");
              setColumnFilters(parsed.headers.map(() => ""));
              setPage(0);
            }}
          >
            Clear
          </Button>
        ) : null}
        {toolbarExtra}
        <p className="text-xs text-muted-foreground">
          {filtersActive
            ? `${view.matchCount.toLocaleString()} of ${rowsLabel(parsed.rows.length)}`
            : rowsLabel(parsed.rows.length)}
          {" · "}
          {delimiterLabel(parsed.delimiter)}
        </p>
      </div>
      {parsed.truncatedRows || parsed.truncatedColumns ? (
        <p className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          {truncationNote(parsed)}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full border-collapse text-left text-sm">
          <caption className="sr-only">{fileName} CSV table</caption>
          <thead className="sticky top-0 z-10 bg-background">
            <tr>
              {parsed.headers.map((header, index) => {
                const active = sort?.column === index ? sort.direction : null;
                return (
                  <th
                    key={header}
                    scope="col"
                    aria-sort={
                      active === "asc"
                        ? "ascending"
                        : active === "desc"
                          ? "descending"
                          : "none"
                    }
                    className="border-b border-border px-2 py-1 font-medium"
                  >
                    <button
                      type="button"
                      className="inline-flex max-w-64 items-center gap-1 rounded-sm px-1 py-1 text-left max-md:pointer-coarse:min-h-11 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={`Sort by ${header}`}
                      onClick={() => {
                        setSort((current) => nextSort(current, index));
                        setPage(0);
                      }}
                    >
                      <span className="truncate">{header}</span>
                      <Icon
                        name={
                          active === "asc"
                            ? "ChevronUp"
                            : active === "desc"
                              ? "ChevronDown"
                              : "ArrowUpDown"
                        }
                        className={cn(
                          "size-3.5 shrink-0",
                          active === null && "text-muted-foreground",
                        )}
                      />
                    </button>
                  </th>
                );
              })}
            </tr>
            {columnFiltersOpen ? (
              <tr>
                {parsed.headers.map((header, index) => (
                  <th key={`${header}-filter`} className="border-b border-border px-2 py-1">
                    <Input
                      value={columnFilters[index] ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setColumnFilters((current) =>
                          current.map((filter, filterIndex) =>
                            filterIndex === index ? value : filter,
                          ),
                        );
                        setPage(0);
                      }}
                      aria-label={`Filter ${header}`}
                      placeholder="Filter"
                      className={cn("h-7 text-xs", TOUCH_HEIGHT)}
                    />
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {view.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={parsed.headers.length}
                  className="px-3 py-6 text-muted-foreground"
                >
                  No rows match the filter.
                </td>
              </tr>
            ) : (
              view.rows.map((row) => (
                <tr
                  key={row.index}
                  ref={(node) => {
                    if (node) rowNodes.current.set(row.index, node);
                    else rowNodes.current.delete(row.index);
                  }}
                  data-pinned={row.index === pinnedIndex ? "true" : undefined}
                  className={cn(
                    "border-b border-border hover:bg-muted/40",
                    row.index === pinnedIndex && "bg-muted",
                  )}
                >
                  {row.cells.map((cell, index) => (
                    <td
                      key={`${row.index}-${parsed.headers[index]}`}
                      title={cell}
                      className={cn(
                        "max-w-80 truncate px-3 py-1.5 align-top",
                        numericColumns[index] && "text-right tabular-nums",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {parsed.rows.length > PAGE_SIZE || view.pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs">
          <p className="whitespace-nowrap text-muted-foreground">
            {view.matchCount === 0
              ? "No matching rows"
              : `Rows ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()}`}
          </p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={TOUCH_HEIGHT}
              disabled={view.page === 0}
              onClick={() => setPage(view.page - 1)}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={TOUCH_HEIGHT}
              disabled={view.page >= view.pageCount - 1}
              onClick={() => setPage(view.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function rowsLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "row" : "rows"}`;
}

function truncationNote(parsed: ParsedCsv): string {
  const parts: string[] = [];
  if (parsed.truncatedRows) {
    parts.push(`the first ${parsed.rows.length.toLocaleString()} data rows`);
  }
  if (parsed.truncatedColumns) {
    parts.push(`the first ${parsed.headers.length.toLocaleString()} columns`);
  }
  return `Showing ${parts.join(" and ")}.`;
}
