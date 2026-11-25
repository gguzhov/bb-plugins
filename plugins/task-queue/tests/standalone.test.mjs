import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("background work is read from the thread's timeline, not from another plugin", () => {
  const server = read("../server.ts");
  const handler = server.slice(server.indexOf("activity: async"), server.indexOf("cli: async"));
  assert.match(handler, /activity\.read\(threadId\)/);
  assert.doesNotMatch(handler, /callRpc|LEGACY_PLUGIN/);
  assert.match(server, /bb\.sdk\.threads\.timeline\(/);
  // The only calls to the older companion plugin are the optional plan import.
  const calls = [...server.matchAll(/pluginId: (\w+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(calls)], ["LEGACY_PLUGIN"]);
  assert.equal([...server.matchAll(/method: "(\w+)"/g)].filter((match) => match[1] !== "exportPlans" && match[1] !== "agentNames").length, 0);
});

test("the names the older companion plugin calls stay: plan, cli and tool RPCs", () => {
  const server = read("../server.ts");
  for (const name of ["plan:", "cli:", "tool:", "activity:"]) assert.ok(server.includes(`  ${name}`), name);
});

test("the package declares no other plugin as a requirement", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.doesNotMatch(JSON.stringify(pkg), /background-peek/i);
});

test("every other banner above the plan card goes, except an item with a child's question", () => {
  const css = read("../app.css");
  const rule = css.match(/\[data-app-composer\]:has\(\[data-tqueue-card\]\) \[data-tqueue-aside\][^{]*\{[^}]*\}/);
  assert.ok(rule, "rule present");
  assert.match(rule[0], /display: none !important/);
  const app = read("../app.tsx");
  assert.match(app, /useDeckAside\(card, plan !== null\)/);
  assert.match(app, /if \(needsOwnerAnswer\(item\)\) continue/);
  assert.doesNotMatch(app.slice(app.indexOf("function useDeckAside")), /composer-predictions/);
});

test("an item the owner has to answer is never hidden; a plain pill is", async () => {
  const { JSDOM } = await import("jsdom");
  const { needsOwnerAnswer } = await import("../deck-aside.ts");
  const doc = new JSDOM("<body></body>").window.document;
  const item = (html) => {
    const el = doc.createElement("div");
    el.innerHTML = html;
    return el.firstElementChild;
  };
  const keep = {
    "question form": '<section data-testid="user-question-banner"><div data-question-form="true"><fieldset><input type="radio"></fieldset></div></section>',
    "question tabs": '<section><div data-question-tabs="true"></div></section>',
    "permission request": '<section data-testid="approval-banner"><button>Allow once</button><button>Deny</button></section>',
    "permission buttons by text only": "<section><button>Allow for session</button></section>",
    "text field": "<section><textarea></textarea></section>",
    "checkbox role": '<section><div role="checkbox"></div></section>',
    "dialog": '<section role="alertdialog"></section>',
    "needs input mark": '<section><svg aria-label="Needs input"></svg></section>',
    "child question row": "<section><div data-child-question-row></div></section>",
  };
  for (const [name, html] of Object.entries(keep)) assert.equal(needsOwnerAnswer(item(html)), true, name);
  const hide = {
    "suggestion pill": '<span class="sr-only" role="status" data-composer-prediction-bridge>Suggestion available. Press Tab</span>',
    "plain card": "<section><div>Uncommitted · 6 files</div><button>Open</button></section>",
    "hidden input only": '<section><input type="hidden"></section>',
  };
  for (const [name, html] of Object.entries(hide)) assert.equal(needsOwnerAnswer(item(html)), false, name);
});

test("bb's Child threads card goes while the plan card is up, but not while a child asks a question", () => {
  const css = read("../app.css");
  const rule = css.match(/\[data-app-composer\]:has\(\[data-tqueue-card\]\) section\[aria-label="Child threads"\][^{]*\{[^}]*\}/);
  assert.ok(rule, "rule present");
  assert.match(rule[0], /:not\(:has\(\[data-child-question-row\]\)\)/);
  assert.match(rule[0], /display: none !important/);
  const app = read("../app.tsx");
  assert.match(app, /useChildCardAside\(card, plan !== null\)/);
  assert.match(app, /CHILD_QUESTION = "\[data-child-question-row\]"/);
});
