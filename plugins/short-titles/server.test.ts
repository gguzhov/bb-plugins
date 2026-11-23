import test from "node:test";
import assert from "node:assert/strict";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { shortenTitle } from "./server";

// The behaviour before maxWords existed: cut to four words, drop trailing punctuation.
const oldShorten = (title: string) => {
  const words = title.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 4) return null;
  return words.slice(0, 4).join(" ").replace(/[\s,.:;!?…—–-]+$/u, "");
};

test("default cut equals the old behaviour when the cut does not end on a short word", () => {
  for (const title of [
    "Fix the broken login form today",
    "Refactor database migration scripts for production",
    "Исправить ошибку авторизации пользователей сегодня",
    "Add retry logic, then log failures, finally ship",
    "One two three four.. five",
  ]) {
    assert.equal(shortenTitle(title), oldShorten(title), title);
  }
});

test("titles that fit are never touched, even when they end on a short word", () => {
  assert.equal(shortenTitle("Fix the login and"), null);
  assert.equal(shortenTitle("Что делать с"), null);
  assert.equal(shortenTitle(""), null);
  assert.equal(shortenTitle("   "), null);
});

test("dangling English words are dropped after the cut", () => {
  assert.equal(shortenTitle("Update docs for the new API"), "Update docs");
  assert.equal(shortenTitle("Move config to the shared package"), "Move config");
  assert.equal(shortenTitle("Build and test the whole thing"), "Build and test");
  assert.equal(shortenTitle("Read it and the rest later"), "Read it");
});

test("dangling Russian words are dropped after the cut", () => {
  assert.equal(shortenTitle("Починить новую сборку в окружении"), "Починить новую сборку");
  assert.equal(shortenTitle("Добавить тесты плагина и документацию"), "Добавить тесты плагина");
  assert.equal(shortenTitle("Проверка ЦВЕТОВ ПРОЕКТОВ в меню"), "Проверка ЦВЕТОВ ПРОЕКТОВ");
});

test("trailing punctuation goes together with the short word", () => {
  assert.equal(shortenTitle("Fix the login, and then more words"), "Fix the login");
  assert.equal(shortenTitle("Deploy it now - the end of it all"), "Deploy it now");
});

test("a title never becomes empty", () => {
  assert.equal(shortenTitle("the and of in on at by", 2), "the");
});

test("maxWords sets the cut, and is clamped to 2-12", () => {
  const title = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi";
  assert.equal(shortenTitle(title, 6), "alpha beta gamma delta epsilon zeta");
  assert.equal(shortenTitle(title, 1), "alpha beta");
  assert.equal(shortenTitle(title, 99), "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu");
  assert.equal(shortenTitle("one two three four five", 5), null);
});

function setup(settings: Record<string, unknown> = {}) {
  const updates: { threadId: string; title: string }[] = [];
  const made = createFakePluginHost({
    pluginId: "short-titles",
    settings,
    sdk: { threads: { update: async (a: any) => { updates.push(a); return {} as any; } } },
  } as any);
  return { ...made, updates };
}

const emit = async (made: ReturnType<typeof setup>, title: string) => {
  await (made.harness as any).emitThreadEvent("thread.idle", { thread: { id: "t1", title } });
};

test("plugin: unset maxWords behaves as four words", async () => {
  const made = setup();
  await plugin(made.bb);
  await emit(made, "Fix the broken login form today");
  assert.deepEqual(made.updates, [{ threadId: "t1", title: "Fix the broken login" }]);
  await made.harness.lifecycle.dispose();
});

test("plugin: maxWords 6 cuts to six", async () => {
  const made = setup({ maxWords: 6 });
  await plugin(made.bb);
  await emit(made, "Fix the broken login form today please now");
  assert.deepEqual(made.updates, [{ threadId: "t1", title: "Fix the broken login form today" }]);
  await emit(made, "Four words only here");
  assert.equal(made.updates.length, 1);
  await made.harness.lifecycle.dispose();
});

test("plugin: maxWords outside 2-12 or not whole is rejected by the setting", async () => {
  const made = setup();
  await plugin(made.bb);
  await assert.rejects(() => (made.harness as any).behavior.setSettings({ maxWords: 1 }));
  await assert.rejects(() => (made.harness as any).behavior.setSettings({ maxWords: 13 }));
  await assert.rejects(() => (made.harness as any).behavior.setSettings({ maxWords: 3.5 }));
  await (made.harness as any).behavior.setSettings({ maxWords: 3 });
  await emit(made, "Fix the broken login form today");
  assert.deepEqual(made.updates, [{ threadId: "t1", title: "Fix the broken" }]);
  await made.harness.lifecycle.dispose();
});
