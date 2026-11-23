// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginFileOpenerProps,
  PluginFileOpenerRegistration,
} from "@get-bb/plugin-sdk/app";

const source: PluginFileOpenerProps["source"] = {
  kind: "workspace",
  threadId: null,
  environmentId: "env_1",
  projectId: "proj_1",
};

function Original() {
  return <div>Built-in preview</div>;
}

const csv = "name,score\nAda,10\nBea,2\n";

describe("CSV file opener", () => {
  let opener: PluginFileOpenerRegistration;

  beforeAll(async () => {
    const app = await loadPluginApp(() => import("./app"));
    const registration = app.fileOpeners[0];
    if (registration === undefined) throw new Error("missing file opener");
    opener = registration;
  });

  it("registers a csv opener", () => {
    expect(opener.id).toBe("csv-table");
    expect(opener.title).toBe("CSV table");
    expect(opener.extensions).toEqual(["csv"]);
  });

  it("sorts and filters the loaded table", async () => {
    const slot = renderSlot(
      opener,
      { path: "reports/people.csv", source, Original },
      { rpc: { readCsv: () => ({ content: csv, sizeBytes: csv.length }) } },
    );
    await slot.findByRole("cell", { name: "Ada" });

    fireEvent.click(slot.getByRole("button", { name: "Sort by score" }));
    const ascending = slot.getAllByRole("row");
    expect(ascending[1]?.textContent).toContain("Bea");
    expect(ascending[2]?.textContent).toContain("Ada");

    fireEvent.click(slot.getByRole("button", { name: "Sort by score" }));
    const descending = slot.getAllByRole("row");
    expect(descending[1]?.textContent).toContain("Ada");
    expect(descending[2]?.textContent).toContain("Bea");

    fireEvent.change(slot.getByRole("textbox", { name: "Filter rows" }), {
      target: { value: "bea" },
    });
    expect(slot.queryByRole("cell", { name: "Ada" })).toBeNull();
    expect(slot.getByRole("cell", { name: "Bea" })).toBeTruthy();

    fireEvent.click(slot.getByRole("button", { name: "Columns" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Filter rows" }), {
      target: { value: "" },
    });
    fireEvent.change(slot.getByRole("textbox", { name: "Filter score" }), {
      target: { value: "10" },
    });
    expect(slot.getByRole("cell", { name: "Ada" })).toBeTruthy();
    expect(slot.queryByRole("cell", { name: "Bea" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows an empty file and can fall back to the built-in preview", async () => {
    const slot = renderSlot(
      opener,
      { path: "empty.csv", source, Original },
      { rpc: { readCsv: () => ({ content: "", sizeBytes: 0 }) } },
    );
    await slot.findByText("This CSV file is empty.");
    expect(slot.queryByRole("button", { name: "Built-in preview" })).toBeNull();
    slot.lifecycle.unmount();

    const filled = renderSlot(
      opener,
      { path: "reports/people.csv", source, Original },
      { rpc: { readCsv: () => ({ content: csv, sizeBytes: csv.length }) } },
    );
    await filled.findByRole("cell", { name: "Ada" });
    fireEvent.click(filled.getByRole("button", { name: "Built-in preview" }));
    expect(filled.getByText("Built-in preview")).toBeTruthy();
    fireEvent.click(filled.getByRole("button", { name: "Show table" }));
    await filled.findByRole("cell", { name: "Ada" });
    filled.lifecycle.unmount();
  });

  it("reports a read failure and retries", async () => {
    let attempts = 0;
    const slot = renderSlot(
      opener,
      { path: "reports/people.csv", source, Original },
      {
        rpc: {
          readCsv: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("disk offline");
            return { content: csv, sizeBytes: csv.length };
          },
        },
      },
    );
    await slot.findByRole("alert");
    expect(slot.getByRole("alert").textContent).toContain("disk offline");
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    await slot.findByRole("cell", { name: "Ada" });
    slot.lifecycle.unmount();
  });
});
