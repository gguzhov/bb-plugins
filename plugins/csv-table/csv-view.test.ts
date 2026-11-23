import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { buildCsvView, columnLooksNumeric, nextSort } from "./csv-view";

const parsed = parseCsv(
  "name,score,city\nAda,10,Paris\nBea,2,Lyon\nCleo,,Nice\n",
);

describe("buildCsvView", () => {
  it("sorts numbers ascending and keeps blanks last in both directions", () => {
    const ascending = buildCsvView(parsed.rows, {
      query: "",
      columnFilters: [],
      sort: { column: 1, direction: "asc" },
      page: 0,
      pageSize: 10,
    });
    expect(ascending.rows.map((row) => row.cells[0])).toEqual(["Bea", "Ada", "Cleo"]);

    const descending = buildCsvView(parsed.rows, {
      query: "",
      columnFilters: [],
      sort: { column: 1, direction: "desc" },
      page: 0,
      pageSize: 10,
    });
    expect(descending.rows.map((row) => row.cells[0])).toEqual(["Ada", "Bea", "Cleo"]);
  });

  it("filters by every search token and by a column", () => {
    const view = buildCsvView(parsed.rows, {
      query: "cleo nice",
      columnFilters: ["", "", "nice"],
      sort: null,
      page: 0,
      pageSize: 10,
    });
    expect(view.rows.map((row) => row.cells[0])).toEqual(["Cleo"]);
    expect(view.matchCount).toBe(1);
  });

  it("pages the sorted matches and clamps the requested page", () => {
    const view = buildCsvView(parsed.rows, {
      query: "",
      columnFilters: [],
      sort: null,
      page: 9,
      pageSize: 2,
    });
    expect(view.pageCount).toBe(2);
    expect(view.page).toBe(1);
    expect(view.rows.map((row) => row.cells[0])).toEqual(["Cleo"]);
  });

  it("cycles a column between ascending and descending", () => {
    expect(nextSort(null, 1)).toEqual({ column: 1, direction: "asc" });
    expect(nextSort({ column: 1, direction: "asc" }, 1)).toEqual({
      column: 1,
      direction: "desc",
    });
    expect(nextSort({ column: 1, direction: "desc" }, 0)).toEqual({
      column: 0,
      direction: "asc",
    });
  });

  it("recognizes a numeric column", () => {
    expect(columnLooksNumeric(parsed.rows, 1)).toBe(true);
    expect(columnLooksNumeric(parsed.rows, 0)).toBe(false);
  });
});
