import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitChanges, parseNumstat } from "./git-stats.ts";

const roots: string[] = [];
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString();
const lines = (n: number, prefix = "line") => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}\n`).join("");

/** A clone of a bare "server" repo with a.txt (10 lines) and b.txt (5 lines) pushed. */
function repo(): string {
 const root = mkdtempSync(join(tmpdir(), "tm-git-test-"));
 roots.push(root);
 const server = join(root, "server.git"), work = join(root, "work");
 sh(root, "init", "-q", "--bare", "-b", "main", server);
 sh(root, "clone", "-q", server, work);
 sh(work, "checkout", "-q", "-b", "main");
 writeFileSync(join(work, "a.txt"), lines(10));
 writeFileSync(join(work, "b.txt"), lines(5));
 writeFileSync(join(work, ".gitignore"), "ignored.log\n");
 sh(work, "add", ".");
 sh(work, "commit", "-q", "-m", "init");
 sh(work, "push", "-q", "-u", "origin", "main");
 return work;
}
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const ok = async (cwd: string) => { const r = await gitChanges(cwd); assert.equal(r.kind, "ok"); return r as Extract<typeof r, { kind: "ok" }>; };

test("clean repository has no changes", async () => {
 const r = await ok(repo());
 assert.deepEqual([r.added, r.removed, r.files, r.unpushedCommits, r.base], [0, 0, 0, 0, "upstream"]);
 assert.equal(r.branch, "main");
});

test("edit in a tracked file: 2 lines changed, 1 added", async () => {
 const w = repo();
 writeFileSync(join(w, "a.txt"), lines(10).replace("line 2\n", "two\n").replace("line 5\n", "five\n") + "extra\n");
 const r = await ok(w);
 assert.deepEqual([r.added, r.removed, r.files], [3, 2, 1]);
 assert.deepEqual(r.uncommitted, { added: 3, removed: 2, files: 1 });
});

test("new untracked text file counts its lines; ignored files do not count", async () => {
 const w = repo();
 writeFileSync(join(w, "new.md"), lines(7));
 writeFileSync(join(w, "tail.md"), "one\ntwo");
 writeFileSync(join(w, "ignored.log"), lines(50));
 const r = await ok(w);
 assert.deepEqual([r.added, r.removed, r.files], [9, 0, 2]);
});

test("binary and oversized untracked files count only as files", async () => {
 const w = repo();
 writeFileSync(join(w, "pic.bin"), Buffer.from([0, 1, 2, 3, 0, 10, 10]));
 writeFileSync(join(w, "big.txt"), lines(120000));
 const r = await ok(w);
 assert.deepEqual([r.added, r.removed, r.files], [0, 0, 2]);
});

test("deleted file counts its removed lines", async () => {
 const w = repo();
 unlinkSync(join(w, "b.txt"));
 const r = await ok(w);
 assert.deepEqual([r.added, r.removed, r.files], [0, 5, 1]);
});

test("staged change is counted", async () => {
 const w = repo();
 writeFileSync(join(w, "b.txt"), lines(5) + lines(3, "more"));
 sh(w, "add", "b.txt");
 const r = await ok(w);
 assert.deepEqual([r.added, r.removed, r.files], [3, 0, 1]);
});

test("unpushed commit plus uncommitted edit of the same file is counted once", async () => {
 const w = repo();
 writeFileSync(join(w, "a.txt"), lines(10) + lines(4, "c"));
 sh(w, "commit", "-q", "-am", "four more");
 // Rewrite two of the committed lines on disk: final state vs server = +4 lines (2 of them edited), 0 removed.
 writeFileSync(join(w, "a.txt"), lines(10) + "c 1\nc 2\nX\nY\n");
 const r = await ok(w);
 assert.equal(r.unpushedCommits, 1);
 assert.deepEqual([r.added, r.removed, r.files], [4, 0, 1]);
 assert.deepEqual(r.uncommitted, { added: 2, removed: 2, files: 1 });
});

test("no upstream: falls back to the merge-base with origin/HEAD", async () => {
 const w = repo();
 sh(w, "remote", "set-head", "origin", "main");
 sh(w, "checkout", "-q", "-b", "feature");
 writeFileSync(join(w, "c.txt"), lines(6));
 sh(w, "add", "c.txt");
 sh(w, "commit", "-q", "-m", "feature");
 writeFileSync(join(w, "b.txt"), lines(4));
 const r = await ok(w);
 assert.equal(r.base, "merge-base");
 assert.equal(r.branch, "feature");
 assert.equal(r.unpushedCommits, 1);
 assert.deepEqual([r.added, r.removed, r.files], [6, 1, 2]);
});

test("no upstream and no remote: only uncommitted work counts", async () => {
 const root = mkdtempSync(join(tmpdir(), "tm-git-test-")); roots.push(root);
 sh(root, "init", "-q", "-b", "main");
 writeFileSync(join(root, "a.txt"), lines(3));
 sh(root, "add", "."); sh(root, "commit", "-q", "-m", "x");
 writeFileSync(join(root, "a.txt"), lines(4));
 const r = await ok(root);
 assert.equal(r.base, "head");
 assert.deepEqual([r.added, r.removed, r.files, r.unpushedCommits], [1, 0, 1, 0]);
});

test("a folder outside git is reported as not a repository", async () => {
 const root = mkdtempSync(join(tmpdir(), "tm-nogit-")); roots.push(root);
 mkdirSync(join(root, "x"));
 assert.deepEqual(await gitChanges(join(root, "x")), { kind: "not-git" });
});

test("untracked limit marks the result truncated", async () => {
 const w = repo();
 for (let i = 0; i < 5; i++) writeFileSync(join(w, `n${i}.txt`), "a\n");
 const r = await gitChanges(w, { untrackedLimit: 3 });
 assert.equal(r.kind === "ok" && r.truncated, true);
 assert.equal(r.kind === "ok" && r.added, 3);
});

test("numstat parser keeps binary files without line counts", () => {
 const m = parseNumstat("3\t1\ta.txt\0-\t-\tpic.png\0");
 assert.deepEqual(m.get("a.txt"), { added: 3, removed: 1 });
 assert.deepEqual(m.get("pic.png"), { added: null, removed: null });
});

import { topFiles } from "./git-stats.ts";

test("top files: most changed lines first, binary last, at most five", () => {
 const tracked = new Map<string, { added: number | null; removed: number | null }>([["a.ts", { added: 3, removed: 1 }], ["b.ts", { added: 40, removed: 2 }], ["pic.png", { added: null, removed: null }], ["c.ts", { added: 0, removed: 9 }]]);
 const top = topFiles(tracked, [["new.md", 12], ["blob.bin", null], ["x.md", 1]]);
 assert.deepEqual(top.map(f => f.path), ["b.ts", "new.md", "c.ts", "a.ts", "x.md"]);
 assert.deepEqual(top[1], { path: "new.md", added: 12, removed: 0 });
 assert.equal(topFiles(tracked, [], 2).length, 2);
});

test("gitChanges reports the top files of an edited repository", async () => {
 const w = repo();
 writeFileSync(join(w, "a.txt"), lines(10) + "x\ny\n");
 writeFileSync(join(w, "note.md"), lines(3));
 const r = await ok(w);
 assert.deepEqual(r.top?.map(f => [f.path, f.added, f.removed]), [["note.md", 3, 0], ["a.txt", 2, 0]]);
});

test("recent branch commits preserve subjects and include pushed and local commits", async () => {
 const w = repo();
 sh(w, "commit", "-q", "--allow-empty", "-m", "Обновить вкладку Git");
 const r = await ok(w);
 assert.equal(r.unpushedCommits, 1);
 assert.deepEqual(r.recentCommits, [
  { hash: sh(w, "rev-parse", "--short", "HEAD").trim(), subject: "Обновить вкладку Git" },
  { hash: sh(w, "rev-parse", "--short", "HEAD^").trim(), subject: "init" },
 ]);
});

test("recent history is bounded and an unborn branch reports no commits", async () => {
 const root = mkdtempSync(join(tmpdir(), "tm-unborn-test-"));
 roots.push(root);
 sh(root, "init", "-q", "-b", "empty");
 assert.deepEqual((await ok(root)).recentCommits, []);
 for (let i = 1; i <= 21; i++) sh(root, "commit", "-q", "--allow-empty", "-m", "commit " + i);
 const history = (await ok(root)).recentCommits;
 assert.equal(history?.length, 20);
 assert.equal(history?.[0]?.subject, "commit 21");
 assert.equal(history?.at(-1)?.subject, "commit 2");
});
