import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("imported candidates are muted, labelled and have no checkbox; new candidates remain selectable", () => {
  const source = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");
  const panel = source.slice(source.indexOf("function ImportPanel("), source.indexOf("function AgentDialog("));
  // Render the real panel JSX, replacing only the visual primitives.
  const code = ts.transpileModule(`${panel}\nmodule.exports = ImportPanel;`, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: null as unknown };
  const checkbox = (props: Record<string, unknown>) => React.createElement("input", { type: "checkbox", disabled: props.disabled, checked: props.checked, "aria-label": props["aria-label"], readOnly: true });
  new Function("React", "module", "require", "Card", "Checkbox", "Button", "TOUCH", code)(React, module, createRequire(import.meta.url), "section", checkbox, "button", "min-h-11");
  const Panel = module.exports as React.ComponentType<any>;
  const row = { host: "203.0.113.1", port: 22, configUser: "root", notice: "SSH notice", error: null };
  const html = renderToStaticMarkup(React.createElement(Panel, { candidates: [{ ...row, alias: "existing", already: true }, { ...row, alias: "new", already: false }], picked: [], importing: false, onPick() {}, onCommit() {}, onCancel() {} }));
  assert.match(html, /opacity-50/);
  assert.match(html, /Импортировано/);
  assert.doesNotMatch(html, /aria-label="existing"/);
  assert.match(html, /aria-label="new"/);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 1);
  assert.doesNotMatch(html, /SSH|~\/.ssh|IdentityFile|Host/);
});
