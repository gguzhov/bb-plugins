import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

function setup(html: string) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: "http://localhost/", pretendToBeVisual: true });
  const w = dom.window;
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
    MutationObserver: w.MutationObserver,
    requestAnimationFrame: w.requestAnimationFrame.bind(w),
    cancelAnimationFrame: w.cancelAnimationFrame.bind(w),
  });
  return dom;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const MENU = `
  <div data-sidebar-project-id="p1"><button aria-haspopup="menu" aria-controls="m1" aria-expanded="true">…</button></div>
  <div role="menu" id="m1">
    <div role="menuitem" data-radix-collection-item>Filter</div>
    <div role="menuitem" data-radix-collection-item>Project settings</div>
    <div role="menuitem" data-radix-collection-item>Rename</div>
  </div>`;

function colourSurface(): HTMLElement {
  const surface = document.createElement("div");
  surface.className = "pc-menu-surface";
  surface.innerHTML = '<div class="pc-menu-anchor"><button role="menuitem">Colour</button></div>';
  return surface;
}

const order = () =>
  Array.from(document.querySelector('[role="menu"]')!.children).map((node) =>
    node.classList.contains("pi-menu-host") ? "Icon" : node.classList.contains("pc-menu-surface") ? "Colour" : node.textContent!.trim(),
  );

test("Icon goes above Project settings, then right below Colour whichever mounts first", async () => {
  const { watchProjectMenus } = await import("./menu-watch");
  const { menuTarget } = await import("./store");

  // Icon first, Colour later.
  let dom = setup(MENU);
  let control = new AbortController();
  watchProjectMenus(control.signal);
  await settle();
  assert.deepEqual(order(), ["Filter", "Icon", "Project settings", "Rename"]);
  assert.equal(menuTarget.get()?.projectId, "p1");
  const settings = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) => n.textContent === "Project settings")!;
  settings.before(colourSurface());
  await settle();
  assert.deepEqual(order(), ["Filter", "Colour", "Icon", "Project settings", "Rename"]);
  control.abort();
  assert.equal(document.querySelector(".pi-menu-host"), null);
  assert.equal(menuTarget.get(), null);
  dom.window.close();

  // Colour first, Icon later.
  dom = setup(MENU);
  const firstSettings = Array.from(document.querySelectorAll('[role="menuitem"]')).find((n) => n.textContent === "Project settings")!;
  firstSettings.before(colourSurface());
  control = new AbortController();
  watchProjectMenus(control.signal);
  await settle();
  assert.deepEqual(order(), ["Filter", "Colour", "Icon", "Project settings", "Rename"]);

  // Colour plugin disabled: its surface goes away, Icon stays above Project settings.
  document.querySelector(".pc-menu-surface")!.remove();
  await settle();
  assert.deepEqual(order(), ["Filter", "Icon", "Project settings", "Rename"]);

  // Menu closes: host disappears.
  document.querySelector('[role="menu"]')!.remove();
  await settle();
  assert.equal(menuTarget.get(), null);
  control.abort();
  dom.window.close();
});

test("sidebar icon sits before the name, follows the store and cleans up", async () => {
  const { decorateSidebar } = await import("./decoration");
  const { sidebarIcons } = await import("./store");
  const row = `<span class="flex"><span class="truncate pc-project-label">Очень длинное название проекта</span><button data-sidebar-rename-anchor aria-expanded="true">v</button></span>`;
  const dom = setup(`<div data-sidebar-project-id="p1">${row}</div><div data-sidebar-project-id="p2">${row}</div>`);
  const control = new AbortController();
  decorateSidebar(control.signal);
  sidebarIcons.set(new Map([["p1", { url: "/api/x?id=a", name: "A" }]]));
  await settle();
  const icons = document.querySelectorAll(".pi-project-icon");
  assert.equal(icons.length, 1);
  const label = document.querySelector('[data-sidebar-project-id="p1"] .truncate')!;
  assert.equal(label.previousElementSibling, icons[0]);
  assert.equal(label.classList.contains("pc-project-label"), true);
  assert.equal(document.querySelector('[data-sidebar-project-id="p2"] .pi-project-icon'), null);

  // Rename: the label becomes an input, the icon stays in front of it.
  const input = document.createElement("input");
  label.replaceWith(input);
  await settle();
  assert.equal(input.previousElementSibling?.classList.contains("pi-project-icon"), true);

  sidebarIcons.set(new Map());
  await settle();
  assert.equal(document.querySelectorAll(".pi-project-icon").length, 0);

  sidebarIcons.set(new Map([["p2", { url: "/api/x?id=b", name: "B" }]]));
  await settle();
  assert.equal(document.querySelectorAll(".pi-project-icon").length, 1);
  control.abort();
  assert.equal(document.querySelectorAll(".pi-project-icon").length, 0);
  sidebarIcons.set(new Map());
  dom.window.close();
});

test("the observer ignores changes inside the chat timeline", async () => {
  const { watchDocument } = await import("./scoped-observer");
  const dom = setup('<main><div data-panel-id="thread-detail-timeline-panel"><p>token</p></div></main><nav></nav>');
  let calls = 0;
  const control = new AbortController();
  watchDocument(() => calls++, control.signal);
  const timeline = document.querySelector('[data-panel-id="thread-detail-timeline-panel"]')!;
  for (let i = 0; i < 20; i += 1) timeline.append(document.createElement("span"));
  await settle();
  assert.equal(calls, 0);
  document.querySelector("nav")!.append(document.createElement("div"));
  await settle();
  assert.equal(calls, 1);
  control.abort();
  dom.window.close();
});

test("sidebar icon frames follow the project state; frames only load while not idle", async () => {
  const { decorateSidebar } = await import("./decoration");
  const { sidebarIcons } = await import("./store");
  const row = `<span class="flex"><span class="truncate pc-project-label">Проект</span><button data-sidebar-rename-anchor aria-expanded="true">v</button></span>`;
  const dom = setup(`<div data-sidebar-project-id="p1">${row}</div><div data-sidebar-project-id="p2">${row}</div>`);
  const control = new AbortController();
  decorateSidebar(control.signal);
  const frames = { left: "/i?id=a&frame=left", right: "/i?id=a&frame=right", puzzled: "/i?id=a&frame=puzzled", alert: "/i?id=a&frame=alert", happy: "/i?id=a&frame=happy" };
  const icon = (state: "idle" | "working" | "waiting" | "error" | "done", extra: object = {}) => ({ url: "/i?id=a", name: "A", frames, state, ...extra });
  const badgeOf = (id: string) => document.querySelector(`[data-sidebar-project-id="${id}"] .pi-badge`)?.className.replace("pi-badge ", "") ?? null;
  const badgeText = (id: string) => document.querySelector(`[data-sidebar-project-id="${id}"] .pi-badge`)?.textContent ?? null;
  const look = (id: string) => {
    const span = document.querySelector<HTMLElement>(`[data-sidebar-project-id="${id}"] .pi-project-icon`)!;
    const imgs = Array.from(span.querySelectorAll("img")).map((img) => img.className.replace("pi-frame pi-frame-", ""));
    return { anim: span.dataset.piAnim ?? null, imgs, badge: badgeOf(id) };
  };

  sidebarIcons.set(new Map<string, any>([["p1", icon("idle")], ["p2", { url: "/i?id=c", name: "C", state: "idle" as const }]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: null, imgs: ["base"], badge: null }, "idle: main frame only, no frame requests");

  sidebarIcons.set(new Map<string, any>([["p1", icon("working")], ["p2", { url: "/i?id=c", name: "C", state: "working" as const }]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "eyes", imgs: ["base", "left", "right"], badge: null });
  assert.deepEqual(look("p2"), { anim: "wiggle", imgs: ["base"], badge: null }, "no left/right: the icon itself moves");

  sidebarIcons.set(new Map<string, any>([["p1", icon("waiting")], ["p2", { url: "/i?id=c", name: "C", state: "waiting" as const }]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "puzzled", imgs: ["base", "puzzled"], badge: "pi-badge-wait" }, "puzzled frame and the yellow badge");
  assert.deepEqual(look("p2"), { anim: "badge", imgs: ["base"], badge: "pi-badge-wait" }, "no puzzled frame: main picture and the same badge");
  assert.equal(badgeText("p1"), "?");

  // Error: scared frame (or the main one) and the red «!»; done: happy frame (or the main one) and the green dot.
  sidebarIcons.set(new Map<string, any>([["p1", icon("error")], ["p2", { url: "/i?id=c", name: "C", state: "error" as const }]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "alert", imgs: ["base", "alert"], badge: "pi-badge-error" });
  assert.deepEqual(look("p2"), { anim: "shake", imgs: ["base"], badge: "pi-badge-error" }, "no alert frame: the main picture twitches");
  assert.equal(badgeText("p1"), "!");
  sidebarIcons.set(new Map<string, any>([["p1", icon("done")], ["p2", { url: "/i?id=c", name: "C", state: "done" as const }]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "happy", imgs: ["base", "happy"], badge: "pi-badge-done" });
  assert.deepEqual(look("p2"), { anim: "badge", imgs: ["base"], badge: "pi-badge-done" }, "no happy frame: main picture, green dot");
  assert.equal(badgeText("p1"), "");
  // Only a half-set of frames: error uses alert when it exists, whatever else is missing.
  sidebarIcons.set(new Map<string, any>([["p1", icon("error", { frames: { alert: "/i?id=a&frame=alert" } })]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "alert", imgs: ["base", "alert"], badge: "pi-badge-error" });

  // The badge changes with the state and goes away with it.
  sidebarIcons.set(new Map<string, any>([["p1", icon("waiting")]]));
  await settle();
  assert.equal(badgeOf("p1"), "pi-badge-wait");
  sidebarIcons.set(new Map<string, any>([["p1", icon("error")]]));
  await settle();
  assert.equal(document.querySelectorAll('[data-sidebar-project-id="p1"] .pi-badge').length, 1);
  assert.equal(badgeOf("p1"), "pi-badge-error");

  // Setting «Анимация иконок» off: still icons, the waiting badge stays.
  sidebarIcons.set(new Map<string, any>([["p1", icon("waiting", { animate: false })], ["p2", { url: "/i?id=c", name: "C", state: "working" as const, animate: false }]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "badge", imgs: ["base"], badge: "pi-badge-wait" });
  assert.deepEqual(look("p2"), { anim: "still", imgs: ["base"], badge: null });
  // Animation off: no motion and no expression frames, but every badge stays.
  sidebarIcons.set(new Map<string, any>([["p1", icon("error", { animate: false })], ["p2", icon("done", { animate: false })]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: "badge", imgs: ["base"], badge: "pi-badge-error" });
  assert.deepEqual(look("p2"), { anim: "badge", imgs: ["base"], badge: "pi-badge-done" });

  sidebarIcons.set(new Map<string, any>([["p1", icon("idle")]]));
  await settle();
  assert.deepEqual(look("p1"), { anim: null, imgs: ["base"], badge: null });
  // The underline rule needs the icon right before the coloured label.
  assert.equal(document.querySelector('[data-sidebar-project-id="p1"] .pc-project-label')!.previousElementSibling?.classList.contains("pi-project-icon"), true);
  control.abort();
  assert.equal(document.querySelectorAll(".pi-project-icon, .pi-frame, .pi-badge").length, 0);
  sidebarIcons.set(new Map());
  dom.window.close();
});

test("project state from threads: five states and their order", async () => {
  const { projectStates, threadState, parseDebugStates, withOverrides, strongest, STATE_NAMES } = await import("./project-state");
  const t = (projectId: string, extra: object = {}) => ({
    projectId,
    status: "idle",
    indicator: "none",
    isUnread: false,
    hasPendingInteraction: false,
    isHidden: false,
    isArchived: false,
    ...extra,
  });
  // One thread each.
  assert.equal(threadState(t("a")), "idle");
  assert.equal(threadState(t("a", { status: "active" })), "working");
  assert.equal(threadState(t("a", { status: "starting" })), "working");
  assert.equal(threadState(t("a", { status: "stopping" })), "working");
  assert.equal(threadState(t("a", { status: "pending" })), "idle");
  assert.equal(threadState(t("a", { status: "active", hasPendingInteraction: true })), "waiting");
  assert.equal(threadState(t("a", { indicator: "waiting-for-input" })), "waiting");
  assert.equal(threadState(t("a", { indicator: "unread-error", status: "error" })), "error");
  assert.equal(threadState(t("a", { indicator: "unread-success" })), "done");
  // Read results (status error, but the indicator is gone) and other indicators are not states.
  assert.equal(threadState(t("a", { status: "error", isUnread: true })), "error", "live data: status error, unread, indicator none");
  assert.equal(threadState(t("a", { status: "error" })), "idle", "an error the owner already opened");
  assert.equal(threadState(t("a", { status: "idle", isUnread: true })), "idle", "unread alone is not a state");
  assert.equal(threadState(t("a", { status: "error", isUnread: true, isArchived: true })), "idle");
  for (const indicator of ["queued-failed", "queued-waiting", "plan-mode", "runtime", "workflow", "background-agent", "draft", "none"]) {
    assert.equal(threadState(t("a", { indicator })), "idle", indicator);
  }
  assert.equal(threadState(t("a", { status: "active", isHidden: true })), "idle");
  assert.equal(threadState(t("a", { indicator: "unread-error", isArchived: true })), "idle");
  assert.equal(threadState(t("a", { indicator: "unread-success", isHidden: true })), "idle");
  // Within one thread the order holds too: unread error > waiting > running > unread success.
  assert.equal(threadState(t("a", { status: "active", indicator: "unread-success" })), "working");
  assert.equal(threadState(t("a", { hasPendingInteraction: true, indicator: "unread-success" })), "waiting");
  assert.equal(threadState(t("a", { status: "active", hasPendingInteraction: true, indicator: "unread-error" })), "error");

  // Every pair of states in one project: the older in the order wins, in either thread order.
  const sample = {
    idle: t("x"),
    done: t("x", { indicator: "unread-success" }),
    working: t("x", { status: "active" }),
    waiting: t("x", { hasPendingInteraction: true }),
    error: t("x", { indicator: "unread-error", status: "error" }),
  } as const;
  const order = ["idle", "done", "working", "waiting", "error"] as const;
  assert.deepEqual([...STATE_NAMES], [...order]);
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) {
      const winner = order[Math.max(i, j)];
      const forward = projectStates([sample[order[i]], sample[order[j]]]).get("x") ?? "idle";
      const backward = projectStates([sample[order[j]], sample[order[i]]]).get("x") ?? "idle";
      assert.equal(forward, winner, `${order[i]} + ${order[j]}`);
      assert.equal(backward, winner, `${order[j]} + ${order[i]}`);
      assert.equal(strongest([order[i], order[j]]), winner);
    }
  }
  // All five at once.
  assert.equal(projectStates(order.map((state) => sample[state])).get("x"), "error");
  assert.equal(projectStates(order.slice(0, 4).map((state) => sample[state])).get("x"), "waiting");
  assert.equal(projectStates(order.slice(0, 3).map((state) => sample[state])).get("x"), "working");
  assert.equal(projectStates(order.slice(0, 2).map((state) => sample[state])).get("x"), "done");
  assert.equal(strongest([]), "idle");

  const states = projectStates([
    t("both", { status: "active" }),
    t("both", { hasPendingInteraction: true }),
    t("both", { status: "active" }),
    t("work", { status: "active" }),
    t("work", { indicator: "unread-success" }),
    t("calm", { indicator: "unread-success" }),
    t("oops", { indicator: "unread-error" }),
    t("quiet", { status: "error" }),
  ]);
  assert.deepEqual(Object.fromEntries(states), { both: "waiting", work: "working", calm: "done", oops: "error" });

  // Debug switch: off without the key, ignores junk, takes all five states, "idle" forces idle.
  assert.equal(parseDebugStates(null).size, 0);
  assert.equal(parseDebugStates("{oops").size, 0);
  assert.equal(parseDebugStates("[1,2]").size, 0);
  const debug = parseDebugStates('{"calm":"waiting","work":"idle","x":"dance","e":"error","d":"done","w":"working"}');
  assert.deepEqual(Object.fromEntries(debug), { calm: "waiting", work: "idle", e: "error", d: "done", w: "working" });
  assert.equal(parseDebugStates('{"p":"toString","q":"__proto__"}').size, 0, "names from Object.prototype are not states");
  assert.deepEqual(Object.fromEntries(withOverrides(states, debug)), { both: "waiting", calm: "waiting", oops: "error", e: "error", d: "done", w: "working" });
  assert.equal(withOverrides(states, new Map()), states);
});

test("picker: one list — none, bundled, custom, plus", async () => {
  const { pickerCells, previewMode, previewPhases, PHASE_CAPTION } = await import("./cells");
  const icon = (id: string, kind: "builtin" | "custom", frames: object = {}) => ({ id, name: id, kind, url: `/i?id=${id}`, frames });
  const cells = pickerCells([icon("cat", "builtin"), icon("custom-1", "custom"), icon("dog", "builtin"), icon("custom-2", "custom")]);
  assert.deepEqual(
    cells.map((cell) => (cell.kind === "icon" ? cell.icon.id : cell.kind)),
    ["none", "cat", "dog", "custom-1", "custom-2", "add"],
  );
  assert.deepEqual(pickerCells([]).map((cell) => cell.kind), ["none", "add"]);
  const phases = (frames: object) => previewPhases(icon("a", "builtin", frames) as any);
  assert.deepEqual(phases({ left: "l", right: "r", puzzled: "p", alert: "a", happy: "h" }), ["work", "wait", "error", "done"], "six frames: the whole loop");
  assert.deepEqual(phases({ left: "l", right: "r", puzzled: "p" }), ["work", "wait"], "three frames: eyes and puzzled");
  assert.deepEqual(phases({ left: "l", right: "r" }), ["work"]);
  assert.deepEqual(phases({ left: "l" }), ["work"], "one eye frame is enough for the eyes");
  assert.deepEqual(phases({ puzzled: "p" }), ["wait"]);
  assert.deepEqual(phases({ alert: "a", happy: "h" }), ["error", "done"]);
  assert.deepEqual(phases({ happy: "h", puzzled: "p" }), ["wait", "done"], "fixed order, not the order of the keys");
  assert.deepEqual(phases({}), [], "no frames: nothing to play");
  assert.equal(previewMode(icon("a", "builtin", { left: "l", right: "r", puzzled: "p" }) as any), "preview");
  assert.equal(previewMode(icon("a", "builtin", { alert: "a" }) as any), "preview");
  assert.equal(previewMode(icon("a", "builtin", { left: "l" }) as any), "preview");
  assert.equal(previewMode(icon("a", "custom") as any), null);
  assert.deepEqual(["work", "wait", "error", "done"].map((phase) => PHASE_CAPTION[phase as keyof typeof PHASE_CAPTION]), ["в работе", "ждёт вас", "ошибка", "готово"]);
});

test("custom picture encoding: WebP at 0.92, PNG when the browser cannot write WebP", async () => {
  const { encodeIcon, toBase64, WEBP_QUALITY } = await import("./client-image");
  const calls: [string | undefined, number | undefined][] = [];
  const canvas = (supportsWebp: boolean) => ({
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number) {
      calls.push([type, quality]);
      // Browsers without a WebP encoder hand back PNG instead.
      const out = type === "image/webp" && !supportsWebp ? "image/png" : type ?? "image/png";
      callback(new Blob([new Uint8Array([1, 2, 3])], { type: out }));
    },
  });
  const webp = await encodeIcon(canvas(true));
  assert.equal(webp.type, "image/webp");
  assert.deepEqual(calls, [["image/webp", WEBP_QUALITY]]);
  assert.equal(WEBP_QUALITY, 0.92);
  calls.length = 0;
  const png = await encodeIcon(canvas(false));
  assert.equal(png.type, "image/png");
  assert.deepEqual(calls, [["image/webp", 0.92]], "the PNG the browser returned is used as is");
  await assert.rejects(() => encodeIcon({ toBlob: (callback) => callback(null) }));
  assert.equal(toBase64(new Uint8Array([0x52, 0x49, 0x46, 0x46])), "UklGRg==");
});

test("underline rule: the last action wins, all combinations of moments", async () => {
  const { hidesUnderline, chosenAt } = await import("./decoration");
  // [assignedAt, colour chosen at, hidden?]
  const cases: [number | undefined, number, boolean][] = [
    [0, 0, true], // old assignment, no mark: the current behaviour stays
    [undefined, 0, true], // no moment at all counts as 0
    [500, 0, true], // icon set, colour never picked by hand
    [500, 400, true], // colour first, icon later
    [500, 500, true], // equal moments
    [500, 600, false], // colour later than icon
    [0, 600, false], // old assignment, colour picked now
  ];
  for (const [assigned, chosen, hidden] of cases) assert.equal(hidesUnderline(assigned, chosen), hidden, `${assigned} / ${chosen}`);
  const label = document.createElement("span");
  assert.equal(chosenAt(label), 0, "no attribute");
  label.setAttribute("data-pc-chosen-at", "abc");
  assert.equal(chosenAt(label), 0, "garbage");
  label.setAttribute("data-pc-chosen-at", "1700000000000");
  assert.equal(chosenAt(label), 1700000000000);
  assert.equal(chosenAt(null), 0);
});

test("underline class on the icon follows the icon moment and the label attribute", async () => {
  const { decorateSidebar } = await import("./decoration");
  const { sidebarIcons } = await import("./store");
  const row = `<span class="flex"><span class="truncate pc-project-label">Проект</span><button data-sidebar-rename-anchor aria-expanded="true">v</button></span>`;
  const dom = setup(`<div data-sidebar-project-id="p1">${row}</div>`);
  const control = new AbortController();
  decorateSidebar(control.signal);
  const hidden = () => document.querySelector(".pi-project-icon")!.classList.contains("pi-no-underline");
  const label = () => document.querySelector<HTMLElement>(".pc-project-label")!;
  const icon = (assignedAt?: number) => new Map<string, any>([["p1", { url: "/i?id=a", name: "A", state: "idle", ...(assignedAt === undefined ? {} : { assignedAt }) }]]);

  sidebarIcons.set(icon(1000));
  await settle();
  assert.equal(hidden(), true, "no attribute: hidden");

  label().setAttribute("data-pc-chosen-at", "2000");
  await settle();
  assert.equal(hidden(), false, "colour chosen after the icon: underline shows");

  sidebarIcons.set(icon(3000));
  await settle();
  assert.equal(hidden(), true, "icon assigned again later: hidden");

  label().setAttribute("data-pc-chosen-at", "4000");
  await settle();
  assert.equal(hidden(), false);
  label().removeAttribute("data-pc-chosen-at");
  await settle();
  assert.equal(hidden(), true, "mark gone: back to the current behaviour");

  sidebarIcons.set(icon());
  label().setAttribute("data-pc-chosen-at", "5");
  await settle();
  assert.equal(hidden(), false, "assignment without a moment counts as 0");
  control.abort();
  assert.equal(document.querySelectorAll(".pi-project-icon").length, 0);
  sidebarIcons.set(new Map());
  dom.window.close();
});

test("removing the icon brings the colour underline back at once (real stylesheet, the whole chain)", async () => {
  const { readFileSync } = await import("node:fs");
  const { decorateSidebar } = await import("./decoration");
  const { sidebarIcons } = await import("./store");
  const row = `<span class="flex"><span class="truncate pc-project-label" style="--pc-color: #3cca18">Проект</span><button data-sidebar-rename-anchor aria-expanded="true">v</button></span>`;
  const dom = setup(`<div data-sidebar-project-id="p1">${row}</div>`);
  // The two real stylesheets: ours and the one «Цвета проектов» ships.
  const style = document.createElement("style");
  style.textContent = `${readFileSync(new URL("./style.css", import.meta.url), "utf8")}\n.pc-project-label{box-shadow:inset 0 -2px var(--pc-color);padding-bottom:3px;}`;
  document.head.append(style);
  const control = new AbortController();
  decorateSidebar(control.signal);
  const label = () => document.querySelector<HTMLElement>(".pc-project-label")!;
  const shadow = () => dom.window.getComputedStyle(label()).boxShadow;
  const icon = (assignedAt?: number) => new Map<string, any>([["p1", { url: "/i?id=a", name: "A", state: "idle", ...(assignedAt === undefined ? {} : { assignedAt }) }]]);
  const iconCount = () => document.querySelectorAll(".pi-project-icon").length;

  assert.match(shadow(), /inset/, "no icon: the underline is there");

  // 1. Icon, then «Без иконки» (the picker and the command give the same store update).
  sidebarIcons.set(icon(1000));
  await settle();
  assert.equal(shadow(), "none", "icon set: underline hidden");
  sidebarIcons.set(new Map());
  await settle();
  assert.equal(iconCount(), 0);
  assert.match(shadow(), /inset/, "icon removed: underline is back");
  assert.ok(!document.querySelector(".pi-no-underline"), "no leftover class");

  // 2. Icon, then colour picked by hand (later), then the icon removed.
  sidebarIcons.set(icon(2000));
  await settle();
  assert.equal(shadow(), "none");
  label().setAttribute("data-pc-chosen-at", "3000");
  await settle();
  assert.match(shadow(), /inset/, "colour picked after the icon: underline shows");
  sidebarIcons.set(new Map());
  await settle();
  assert.match(shadow(), /inset/, "icon removed after the colour: underline stays");
  assert.equal(label().getAttribute("style")?.includes("--pc-color"), true, "the colour variable is untouched");

  // 3. Icon assigned after the colour (hidden), removed (back), re-assigned and removed again.
  sidebarIcons.set(icon(4000));
  await settle();
  assert.equal(shadow(), "none");
  sidebarIcons.set(new Map());
  await settle();
  assert.match(shadow(), /inset/);
  sidebarIcons.set(icon(5000));
  await settle();
  assert.equal(shadow(), "none");
  sidebarIcons.set(new Map());
  await settle();
  assert.match(shadow(), /inset/);

  // 4. The row is redrawn by the app (a new label element) while the icon is on, then the icon is removed.
  sidebarIcons.set(icon(6000));
  await settle();
  const old = label();
  const fresh = old.cloneNode(true) as HTMLElement;
  fresh.setAttribute("data-pc-chosen-at", "3000");
  old.replaceWith(fresh);
  await settle();
  assert.equal(document.querySelectorAll(".pi-project-icon").length, 1, "one icon, not two");
  assert.equal(fresh.previousElementSibling?.classList.contains("pi-project-icon"), true);
  sidebarIcons.set(new Map());
  await settle();
  assert.equal(iconCount(), 0);
  assert.match(dom.window.getComputedStyle(fresh).boxShadow, /inset/, "new label: underline is back");

  // 5. Page reload with the icon already removed: a fresh decorator draws nothing and hides nothing.
  control.abort();
  const again = new AbortController();
  decorateSidebar(again.signal);
  sidebarIcons.set(new Map());
  await settle();
  assert.equal(iconCount(), 0);
  assert.match(dom.window.getComputedStyle(fresh).boxShadow, /inset/);
  again.abort();
  sidebarIcons.set(new Map());
  dom.window.close();
});
