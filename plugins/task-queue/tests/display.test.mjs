import test from "node:test";
import assert from "node:assert/strict";
import { legacyTitle, ownerLabel, queueName, ticketView } from "../format.ts";
import { applyOp, describe, parseOp, stepCode, withMetrics } from "../plan.ts";
import { planMetrics } from "../metrics.ts";

// ── QN: "Очередь" instead of "Волна" ───────────────────────────────────────

test("queueName: a leading Волна reads Очередь, any case, with or without a number", () => {
  assert.equal(queueName("Волна 1: исследования"), "Очередь 1: исследования");
  assert.equal(queueName("волна v5"), "Очередь v5");
  assert.equal(queueName("ВОЛНА 2"), "Очередь 2");
  assert.equal(queueName("Волна v5: 60 тикетов"), "Очередь v5: 60 тикетов");
  assert.equal(queueName("Волна"), "Очередь");
  assert.equal(queueName("Волна: финал"), "Очередь: финал");
});

test("queueName: волна in the middle, or a longer word, stays", () => {
  assert.equal(queueName("Первая волна пациентов"), "Первая волна пациентов");
  assert.equal(queueName("Релиз, волна 2"), "Релиз, волна 2");
  assert.equal(queueName("Волнами по очереди"), "Волнами по очереди");
  assert.equal(queueName("Сервер"), "Сервер");
});

test("Волна is only display: stored names stay, plan show prints Очередь, json carries both", () => {
  const create = {
    id: "w",
    title: "Волна v5: 3 тикета",
    epics: [
      { name: "Волна 1: исследования", tickets: [{ title: "Сбор данных", code: "SD" }, { title: "Интервью" }] },
      { name: "волна 2", tickets: [{ title: "Отчёт" }] },
    ],
  };
  let { plans, plan } = applyOp([], parseOp(create), 1000);
  assert.equal(plan.title, "Волна v5: 3 тикета");
  assert.equal(plan.stages[0].name, "Волна 1: исследования");
  const text = describe(plan, 2000);
  assert.match(text, /^Очередь v5: 3 тикета \(w: 0\/3/);
  assert.match(text, /^  Очередь 1: исследования$/m);
  assert.match(text, /^  Очередь 2$/m);
  assert.doesNotMatch(text, /Волна|волна/);
  const json = withMetrics(plan, 2000);
  assert.equal(json.title, "Волна v5: 3 тикета");
  assert.equal(json.displayTitle, "Очередь v5: 3 тикета");
  assert.equal(json.stages[0].name, "Волна 1: исследования");
  assert.equal(json.stages[0].displayName, "Очередь 1: исследования");

  // Addressing by the old names still works: a resend under "Волна 1" keeps the ticket's state.
  ({ plans } = applyOp(plans, parseOp({ id: "w", done: ["SD"] }), 3000));
  ({ plans, plan } = applyOp(
    plans,
    parseOp({ id: "w", epics: [{ name: "Волна 1: исследования", tickets: ["Сбор данных", "Интервью"] }, { name: "волна 2", tickets: ["Отчёт"] }] }),
    4000,
  ));
  assert.equal(plan.stages[0].name, "Волна 1: исследования");
  assert.equal(plan.stages[0].steps[0].status, "done");
  assert.equal(plan.stages[0].steps[0].code, "SD");
  // A ticket whose title holds the word is addressed by that title as stored.
  ({ plan } = applyOp([], parseOp({ id: "t", title: "T", tickets: ["Волна 1 сбор", "Другое"] }), 1000));
  ({ plan } = applyOp([plan], parseOp({ id: "t", done: ["волна 1 сбор"] }), 2000));
  assert.equal(plan.stages[0].steps[0].status, "done");
});

// ── FL: the owner pill in full ─────────────────────────────────────────────

test("ownerLabel keeps the owner whole; lead alone reads Lead", () => {
  assert.equal(ownerLabel("Lead: Fable 5.2"), "Lead: Fable 5.2");
  assert.equal(ownerLabel("Sonnet 5.5"), "Sonnet 5.5");
  assert.equal(ownerLabel("Opus 5.5"), "Opus 5.5");
  assert.equal(ownerLabel("lead"), "Lead");
  assert.equal(ownerLabel("ведущий"), "Lead");
  assert.equal(ownerLabel("Ведущий"), "Lead");
  assert.equal(ownerLabel("ведущий Fable 5.2"), "Lead: Fable 5.2");
  assert.equal(ownerLabel("lead Opus 5.5"), "Lead: Opus 5.5");
  assert.equal(ownerLabel("Leader board team"), "Leader board team");
  assert.equal(ownerLabel("Claude Sonnet 5.5 (thinking)"), "Claude Sonnet 5.5 (thinking)");
});

// ── PR: old-style titles ───────────────────────────────────────────────────

test("legacy titles: the four live examples", () => {
  assert.deepEqual(legacyTitle("RH вместимость участка 10 га и корпуса, 3 б., Sonnet 5.5, 7 критериев"), {
    code: "RH",
    extra: [],
    name: "вместимость участка 10 га и корпуса",
    points: 3,
    criteria: 7,
    owner: "Sonnet 5.5",
  });
  assert.deepEqual(legacyTitle("MQ стройка 6 кварталов параметром, 8 б., Opus 5.5, 4 критерия"), {
    code: "MQ",
    extra: [],
    name: "стройка 6 кварталов параметром",
    points: 8,
    criteria: 4,
    owner: "Opus 5.5",
  });
  assert.deepEqual(legacyTitle("RP документы и отчёт владельцу, ведущий Fable 5.2"), {
    code: "RP",
    extra: [],
    name: "документы и отчёт владельцу",
    owner: "Lead: Fable 5.2",
  });
  // The comma inside the name is not a tail: nothing after it is cut.
  assert.deepEqual(legacyTitle("LD решения ведущего по домам, ФОТ и выручке"), {
    code: "LD",
    extra: [],
    name: "решения ведущего по домам, ФОТ и выручке",
  });
});

test("legacy titles: other tails, no tails, a comma inside, points off the scale", () => {
  assert.deepEqual(legacyTitle("Карточка пациента"), { code: null, extra: [], name: "Карточка пациента" });
  assert.deepEqual(legacyTitle("Справочники DI DP"), { code: "DI", extra: ["DP"], name: "Справочники" });
  assert.equal(legacyTitle("AB итоги, выводы, 2 pt").name, "итоги, выводы");
  assert.equal(legacyTitle("AB итоги, выводы, 2 pt").points, 2);
  assert.equal(legacyTitle("Сводка, 1 критерий").criteria, 1);
  assert.equal(legacyTitle("Сводка, lead Opus 5.5").owner, "Lead: Opus 5.5");
  assert.equal(legacyTitle("Сводка, haiku 5.5").owner, "Haiku 5.5");
  // Off the 1-2-3-5-8-13 scale: still read, it is what the lead wrote.
  assert.equal(legacyTitle("QA проверка, 4 б.").points, 4);
  assert.equal(legacyTitle("QA проверка, 4 б.").name, "проверка");
  // Not a size: 0, or over 100, stays in the name.
  assert.equal(legacyTitle("QA проверка, 0 б.").name, "проверка, 0 б.");
  assert.equal(legacyTitle("QA проверка, 500 б.").points, undefined);
  // A well-known acronym at the start is not a code; a title that is only a tail stays whole.
  assert.equal(legacyTitle("API ключи").code, null);
  assert.equal(legacyTitle("Sonnet 5.5").name, "Sonnet 5.5");
  // "RH · вместимость": the separator goes with the code.
  assert.equal(legacyTitle("RH · вместимость").name, "вместимость");
});

test("legacy titles: fields set explicitly win, and the title is not parsed then", () => {
  const view = ticketView({ title: "RH вместимость, 3 б., Sonnet 5.5, 7 критериев", owner: "Opus 5.5" });
  assert.equal(view.name, "RH вместимость, 3 б., Sonnet 5.5, 7 критериев");
  assert.equal(view.owner, "Opus 5.5");
  assert.equal(view.points, undefined);
  assert.equal(view.criteria, undefined);
  assert.equal(view.code, null);
  const coded = ticketView({ title: "Карточка", code: "CS", points: 3 });
  assert.deepEqual(coded, { code: "CS", extra: [], name: "Карточка", points: 3 });
  // Without fields, the old title is read.
  assert.deepEqual(ticketView({ title: "MQ стройка, 8 б., Opus 5.5" }), {
    code: "MQ",
    extra: [],
    name: "стройка",
    points: 8,
    owner: "Opus 5.5",
  });
});

test("legacy titles feed the figures and addressing by code", () => {
  const { plan } = applyOp(
    [],
    parseOp({
      id: "l",
      title: "L",
      tickets: [
        { title: "RH вместимость, 3 б., Sonnet 5.5", status: "done" },
        { title: "MQ стройка, 8 б., Opus 5.5" },
        { title: "LD решения ведущего по домам, ФОТ и выручке" },
      ],
    }),
    1000,
  );
  const m = planMetrics(plan, 2000);
  assert.equal(m.pointsTotal, 3 + 8 + 1);
  assert.equal(m.pointsDone, 3);
  assert.equal(stepCode(plan.stages[0].steps[1]), "MQ");
  const { plan: moved } = applyOp([plan], parseOp({ id: "l", start: ["mq"] }), 3000);
  assert.equal(moved.stages[0].steps[1].status, "active");
  // The stored title never changes.
  assert.equal(moved.stages[0].steps[1].title, "MQ стройка, 8 б., Opus 5.5");
});
