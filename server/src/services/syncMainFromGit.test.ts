import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";

const execFileAsync = promisify(execFile);

const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openleaf-sync-git-"));
process.env.OPENLEAF_PROJECTS_ROOT = projectsRoot;

const { loadConfig } = await import("../config.js");
loadConfig(true);

const { ensureProjectGit } = await import("./projectGit.js");
const { forkBranch, getBranch, loadTimeline } = await import("./timeline.js");

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return String(stdout).trim();
}

async function seedRawGitProject(id: string): Promise<{ hashes: string[]; dir: string }> {
  const dir = path.join(projectsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.tex"), "v1\n", "utf8");
  await ensureProjectGit(id);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "first", "--no-gpg-sign"]);
  const h1 = await git(dir, ["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(dir, "main.tex"), "v2\n", "utf8");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "second", "--no-gpg-sign"]);
  const h2 = await git(dir, ["rev-parse", "HEAD"]);

  fs.writeFileSync(path.join(dir, "main.tex"), "v3\n", "utf8");
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "third", "--no-gpg-sign"]);
  const h3 = await git(dir, ["rev-parse", "HEAD"]);

  return { hashes: [h1, h2, h3], dir };
}

describe("syncMainFromGit", () => {
  const id = "sync-demo";
  let hashes: string[] = [];

  before(async () => {
    const seeded = await seedRawGitProject(id);
    hashes = seeded.hashes;

    // Stale timeline: only the first commit, head stuck in the past.
    const openleaf = path.join(seeded.dir, ".openleaf");
    fs.mkdirSync(openleaf, { recursive: true });
    fs.writeFileSync(
      path.join(openleaf, "timeline.json"),
      JSON.stringify(
        {
          version: 1,
          activeBranchId: "main",
          viewingNodeId: null,
          branches: [
            {
              id: "main",
              name: "main",
              sacred: true,
              headNodeId: "legacy-stale",
              createdAt: new Date().toISOString(),
              gitRef: "main",
            },
          ],
          nodes: [
            {
              id: "legacy-stale",
              branchId: "main",
              parentId: null,
              gitHash: hashes[0],
              message: "first",
              author: "Test",
              createdAt: new Date().toISOString(),
              legacy: true,
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  });

  after(() => {
    fs.rmSync(projectsRoot, { recursive: true, force: true });
  });

  it("rebuilds main chain from git and advances head", async () => {
    const tl = await loadTimeline(id);
    const mainNodes = tl.nodes.filter((n) => n.branchId === "main");
    assert.equal(mainNodes.length, 3);
    assert.deepEqual(
      mainNodes.map((n) => n.gitHash),
      hashes,
    );
    assert.equal(mainNodes[0]!.parentId, null);
    assert.equal(mainNodes[1]!.parentId, mainNodes[0]!.id);
    assert.equal(mainNodes[2]!.parentId, mainNodes[1]!.id);
    assert.equal(getBranch(tl, "main").headNodeId, mainNodes[2]!.id);
    // First hash keeps the pre-existing node id
    assert.equal(mainNodes[0]!.id, "legacy-stale");
    assert.equal(mainNodes[0]!.message, "first");
    assert.equal(mainNodes[2]!.message, "third");
  });

  it("second load is stable (same ids / head)", async () => {
    const a = await loadTimeline(id);
    const b = await loadTimeline(id);
    assert.deepEqual(
      a.nodes.filter((n) => n.branchId === "main").map((n) => n.id),
      b.nodes.filter((n) => n.branchId === "main").map((n) => n.id),
    );
    assert.equal(getBranch(a, "main").headNodeId, getBranch(b, "main").headNodeId);
  });

  it("preserves OpenLeaf fork nodes across sync", async () => {
    const tl = await loadTimeline(id);
    const main = getBranch(tl, "main");
    const forked = await forkBranch(id, {
      fromNodeId: main.headNodeId!,
      name: "side-feature",
      activate: false,
    });

    // External commit on main after the fork
    const dir = path.join(projectsRoot, id);
    fs.writeFileSync(path.join(dir, "main.tex"), "v4\n", "utf8");
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-m", "fourth", "--no-gpg-sign"]);
    const h4 = await git(dir, ["rev-parse", "HEAD"]);

    const after = await loadTimeline(id);
    assert.ok(after.branches.some((b) => b.id === forked.branch.id));
    assert.ok(after.nodes.some((n) => n.branchId === forked.branch.id));
    const mainNodes = after.nodes.filter((n) => n.branchId === "main");
    assert.equal(mainNodes.length, 4);
    assert.equal(mainNodes[3]!.gitHash, h4);
    assert.equal(getBranch(after, "main").headNodeId, mainNodes[3]!.id);
  });
});
