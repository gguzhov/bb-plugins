import { describe, expect, it } from "vitest";
import {
  CSV_MAX_COLUMNS,
  CSV_MAX_DATA_ROWS,
  detectDelimiter,
  parseCsv,
  rowIndexAtLine,
} from "./csv";

describe("parseCsv", () => {
  it("uses the first row as headers and keeps data cells", () => {
    const parsed = parseCsv("name,score\nAda,10\nBea,2\n");
    expect(parsed.delimiter).toBe(",");
    expect(parsed.headers).toEqual(["name", "score"]);
    expect(parsed.rows.map((row) => row.cells)).toEqual([
      ["Ada", "10"],
      ["Bea", "2"],
    ]);
    expect(parsed.truncatedRows).toBe(false);
  });

  it("parses quotes, escaped quotes, and newlines inside fields", () => {
    const parsed = parseCsv('city,note\nParis,"line1\nline2"\nLyon,"say ""hi"""\n');
    expect(parsed.rows).toEqual([
      { cells: ["Paris", "line1\nline2"], startLine: 2 },
      { cells: ["Lyon", 'say "hi"'], startLine: 4 },
    ]);
    expect(rowIndexAtLine(parsed.rows, 3)).toBe(0);
    expect(rowIndexAtLine(parsed.rows, 4)).toBe(1);
  });

  it("strips a leading BOM and accepts CRLF", () => {
    const parsed = parseCsv("\uFEFFname,city\r\nAda,Paris\r\n");
    expect(parsed.headers).toEqual(["name", "city"]);
    expect(parsed.rows[0]?.cells).toEqual(["Ada", "Paris"]);
  });

  it("detects semicolon and tab delimiters from the header line", () => {
    expect(detectDelimiter('name;note\nAda;"a,b"\n')).toBe(";");
    expect(parseCsv("name\tscore\nAda\t10\n").rows[0]?.cells).toEqual([
      "Ada",
      "10",
    ]);
    expect(detectDelimiter('"a,b";c\n')).toBe(";");
  });

  it("names blank and duplicate headers", () => {
    const parsed = parseCsv("name,,name\nAda,x,y\n");
    expect(parsed.headers).toEqual(["name", "Column 2", "name (2)"]);
  });

  it("pads short rows and reports truncation", () => {
    const parsed = parseCsv("a,b,c\n1\n2,3,4,5\n", {
      maxDataRows: 1,
      maxColumns: 2,
    });
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([{ cells: ["1", ""], startLine: 2 }]);
    expect(parsed.truncatedRows).toBe(true);
    expect(parsed.truncatedColumns).toBe(true);
  });

  it("treats an empty file as an empty table", () => {
    expect(parseCsv("\uFEFF\n").headers).toEqual([]);
    expect(parseCsv("").rows).toEqual([]);
  });

  it("caps the default table size", () => {
    const lines = ["value", ...Array.from({ length: CSV_MAX_DATA_ROWS + 2 }, (_, index) => String(index))];
    const parsed = parseCsv(lines.join("\n"));
    expect(parsed.rows).toHaveLength(CSV_MAX_DATA_ROWS);
    expect(parsed.truncatedRows).toBe(true);
    expect(CSV_MAX_COLUMNS).toBe(100);
  });
});
