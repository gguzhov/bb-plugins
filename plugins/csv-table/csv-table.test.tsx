// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { CsvTable, TOUCH_HEIGHT } from "./csv-table";
import { parseCsv } from "./csv";

const show = (text: string) =>
  render(<CsvTable parsed={parseCsv(text)} lineRange={null} fileName="t.csv" />);

describe("CsvTable", () => {
  afterEach(cleanup);
  beforeAll(() => {
    installTestPluginRuntime();
  });

  it("says 1 row, not 1 rows", () => {
    const view = show("a\nx\n");
    expect(view.getByText(/^1 row ·/u)).toBeTruthy();
  });

  it("shows a header-only file as a table with zero rows", () => {
    const view = show("a,b\n");
    expect(view.getByText(/^0 rows ·/u)).toBeTruthy();
    expect(view.getByText("No rows match the filter.")).toBeTruthy();
  });

  it("gives every control a 44 px touch height on phones", () => {
    const view = show("a,b\n1,2\n");
    for (const name of ["Filter rows"]) {
      expect(view.getByRole("textbox", { name }).className).toContain(TOUCH_HEIGHT);
    }
    expect(view.getByRole("button", { name: "Columns" }).className).toContain(TOUCH_HEIGHT);
    expect(view.getByRole("button", { name: "Sort by a" }).className).toContain("pointer-coarse:min-h-11");
  });
});
