import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openleaf-review-"));
process.env.OPENLEAF_PROJECTS_ROOT = projectsRoot;

const { loadConfig } = await import("../config.js");
loadConfig(true);

const { ensureProjectGit } = await import("./projectGit.js");
const { intentionalCommit } = await import("./timeline.js");
const { writeFile, readFile } = await import("./projectFs.js");
const {
  acceptAiFile,
  acceptAiHunk,
  clearAiReview,
  listAiReview,
  rejectAiFile,
  rejectAiHunk,
  snapshotBeforeWrite,
} = await import("./aiReview.js");

async function seedProject(id: string): Promise<void> {
  const dir = path.join(projectsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.tex"), "alpha\nbeta\ngamma\n", "utf8");
  fs.writeFileSync(
    path.join(dir, "openleaf.json"),
    JSON.stringify({ mainFile: "main.tex", engine: "pdflatex" }),
    "utf8",
  );
  await ensureProjectGit(id);
  await intentionalCommit(id, { branchId: "main", message: "base" });
}

describe("AI hunk review", () => {
  const id = "ai-review-project";
  const ctx = {
    projectId: id,
    aiId: "ai-test",
    branchId: "main",
    slug: "test",
    branchName: "ai/test",
    parentBranchName: "main",
  };

  before(async () => {
    await seedProject(id);
  });

  after(() => {
    clearAiReview(ctx.aiId);
    fs.rmSync(projectsRoot, { recursive: true, force: true });
  });

  it("lists pending hunks, reject restores, accept keeps", async () => {
    const before = "alpha\nbeta\ngamma\n";
    snapshotBeforeWrite(ctx.aiId, "main.tex", before);
    await writeFile(id, "main.tex", "alpha\nBETA\ngamma\n");

    const listed = await listAiReview(ctx);
    assert.equal(listed.hunkCount, 1);
    assert.equal(listed.files[0]?.path, "main.tex");
    const hunk = listed.files[0]!.hunks[0]!;
    assert.equal(hunk.kind, "replace");
    assert.match(hunk.phraseBefore ?? "", /beta/i);
    assert.match(hunk.phraseAfter ?? "", /BETA/i);
    assert.ok((hunk.inline ?? []).some((t) => t.kind === "del"));
    assert.ok((hunk.inline ?? []).some((t) => t.kind === "add"));
    const hunkId = hunk.id;

    await rejectAiHunk(ctx, hunkId);
    const restored = await readFile(id, "main.tex", { forceText: true });
    assert.equal(restored.content, before);
    assert.equal((await listAiReview(ctx)).hunkCount, 0);

    snapshotBeforeWrite(ctx.aiId, "main.tex", before);
    await writeFile(id, "main.tex", "alpha\nBETA\ngamma\n");
    const again = await listAiReview(ctx);
    const keepId = again.files[0]!.hunks[0]!.id;
    await acceptAiHunk(ctx, keepId);
    const kept = await readFile(id, "main.tex", { forceText: true });
    assert.equal(kept.content, "alpha\nBETA\ngamma\n");
    assert.equal((await listAiReview(ctx)).hunkCount, 0);
  });

  it("accepts one of two separated hunks without dropping the other", async () => {
    clearAiReview(ctx.aiId);
    const oldT = Array.from({ length: 24 }, (_, i) => String(i + 1)).join("\n") + "\n";
    await writeFile(id, "main.tex", oldT);
    snapshotBeforeWrite(ctx.aiId, "main.tex", oldT);
    const lines = oldT.split("\n");
    lines[1] = "X";
    lines[20] = "Y";
    const newT = lines.join("\n");
    await writeFile(id, "main.tex", newT);

    const listed = await listAiReview(ctx);
    assert.ok(listed.files[0]!.hunks.length >= 2);
    const firstId = listed.files[0]!.hunks[0]!.id;
    await acceptAiHunk(ctx, firstId);
    const after = await listAiReview(ctx);
    assert.equal(after.hunkCount, 1);
    const disk = await readFile(id, "main.tex", { forceText: true });
    assert.equal(disk.content, newT);
    await acceptAiHunk(ctx, after.files[0]!.hunks[0]!.id);
    assert.equal((await listAiReview(ctx)).hunkCount, 0);
    assert.equal((await readFile(id, "main.tex", { forceText: true })).content, newT);
  });

  it("snaps baseline to disk so a new file without trailing newline has no phantom hunk", async () => {
    clearAiReview(ctx.aiId);
    snapshotBeforeWrite(ctx.aiId, "NOEOF.md", null);
    await writeFile(id, "NOEOF.md", "hello");
    const listed = await listAiReview(ctx);
    assert.ok(listed.hunkCount >= 1);
    await acceptAiHunk(ctx, listed.files[0]!.hunks[0]!.id);
    assert.equal((await listAiReview(ctx)).hunkCount, 0);
    assert.equal((await readFile(id, "NOEOF.md", { forceText: true })).content, "hello");
  });

  it("reject of a created file deletes it; reject of an emptied existing file restores empty", async () => {
    clearAiReview(ctx.aiId);
    snapshotBeforeWrite(ctx.aiId, "CREATED.md", null);
    await writeFile(id, "CREATED.md", "temp\n");
    await rejectAiFile(ctx, "CREATED.md");
    await assert.rejects(
      () => readFile(id, "CREATED.md", { forceText: true }),
      (err: { status?: number }) => err.status === 404,
    );

    await writeFile(id, "empty.tex", "");
    snapshotBeforeWrite(ctx.aiId, "empty.tex", "");
    await writeFile(id, "empty.tex", "nope\n");
    await rejectAiFile(ctx, "empty.tex");
    const empty = await readFile(id, "empty.tex", { forceText: true });
    assert.equal(empty.content, "");
  });

  it("CRLF files review as line hunks, not a whole-file rewrite", async () => {
    clearAiReview(ctx.aiId);
    const before = "alpha\r\nbeta\r\ngamma\r\n";
    await writeFile(id, "crlf.tex", before);
    snapshotBeforeWrite(ctx.aiId, "crlf.tex", before);
    await writeFile(id, "crlf.tex", "alpha\nBETA\ngamma\n");
    const listed = await listAiReview(ctx);
    assert.equal(listed.files[0]!.hunks.length, 1);
    assert.equal(listed.files[0]!.hunks[0]!.additions, 1);
    assert.equal(listed.files[0]!.hunks[0]!.deletions, 1);
    await rejectAiFile(ctx, "crlf.tex");
    const restored = await readFile(id, "crlf.tex", { forceText: true });
    assert.equal(restored.content, before);
  });
});
