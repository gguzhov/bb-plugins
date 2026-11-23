import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv edge cases", () => {
  it("empty and whitespace-only files give an empty table", () => {
    for (const text of ["", "\n", "\r\n\r\n", "   \n", "﻿"]) {
      const parsed = parseCsv(text);
      expect(parsed.headers, JSON.stringify(text)).toEqual([]);
      expect(parsed.rows).toEqual([]);
    }
  });

  it("header only, with and without a final line break", () => {
    for (const text of ["a,b,c", "a,b,c\n", "a,b,c\r\n"]) {
      const parsed = parseCsv(text);
      expect(parsed.headers, JSON.stringify(text)).toEqual(["a", "b", "c"]);
      expect(parsed.rows).toEqual([]);
    }
  });

  it("keeps delimiters and line breaks inside quoted fields", () => {
    const parsed = parseCsv('id,note\n1,"a, b; c"\n2,"two\r\nlines, still one cell"\n3,plain\n');
    expect(parsed.rows.map((row) => row.cells)).toEqual([
      ["1", "a, b; c"],
      ["2", "two\nlines, still one cell"],
      ["3", "plain"],
    ]);
    expect(parsed.rows[2]?.startLine).toBe(5);
  });

  it("handles a BOM together with CRLF and a quoted header", () => {
    const parsed = parseCsv('﻿"name","city"\r\n"Ada","Paris"\r\n');
    expect(parsed.headers).toEqual(["name", "city"]);
    expect(parsed.rows.map((row) => row.cells)).toEqual([["Ada", "Paris"]]);
  });

  it("accepts old-Mac lone CR line ends", () => {
    const parsed = parseCsv("a,b\r1,2\r3,4");
    expect(parsed.rows.map((row) => row.cells)).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("pads short rows and widens the table for long rows", () => {
    const parsed = parseCsv("a,b\n1\n2,3,4\n");
    expect(parsed.headers).toEqual(["a", "b", "Column 3"]);
    expect(parsed.rows.map((row) => row.cells)).toEqual([["1", "", ""], ["2", "3", "4"]]);
  });

  it("skips blank lines between and after records but keeps real empty cells", () => {
    const parsed = parseCsv("a,b\n1,2\n\n3,4\n\n\n,\n");
    expect(parsed.rows.map((row) => row.cells)).toEqual([["1", "2"], ["3", "4"], ["", ""]]);
    expect(parsed.rows.map((row) => row.startLine)).toEqual([2, 4, 7]);
  });

  it("keeps a quoted empty single cell as a row", () => {
    const parsed = parseCsv('a\n""\nx\n');
    expect(parsed.rows.map((row) => row.cells)).toEqual([[""], ["x"]]);
  });
});
