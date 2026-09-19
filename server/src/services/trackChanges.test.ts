import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";

const execFileAsync = promisify(execFile);

const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openleaf-track-changes-"));
process.env.OPENLEAF_PROJECTS_ROOT = projectsRoot;

const { loadConfig } = await import("../config.js");
loadConfig(true);

const { ensureProjectGit } = await import("./projectGit.js");
const {
  expandChangedMetricsMacros,
  flattenTexFile,
  generateTrackChanges,
  hasLatexdiff,
  parseNoArgNewcommands,
  setLatexdiffAvailableForTests,
} = await import("./trackChanges.js");
const { ensureSnapshotRoot, snapshotRootIfPresent } = await import("./timeline.js");

const latexdiffInstalled = await hasLatexdiff();

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

function write(dir: string, rel: string, content: string): void {
  const dest = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, "utf8");
}

function listSource(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (rel: string) => {
    const abs = rel ? path.join(dir, rel) : dir;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === ".git" || ent.name === ".openleaf") continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(r);
      else out.set(r, fs.readFileSync(path.join(dir, r)));
    }
  };
  walk("");
  return out;
}

function assertMapsEqual(a: Map<string, Buffer>, b: Map<string, Buffer>, label: string): void {
  assert.equal(a.size, b.size, `${label} file count`);
  for (const [k, v] of a) {
    const other = b.get(k);
    assert.ok(other, `${label} missing ${k}`);
    assert.ok(v.equals(other!), `${label} changed ${k}`);
  }
}

async function twoCommitProject(
  id: string,
  oldFiles: Record<string, string>,
  newFiles: Record<string, string>,
): Promise<{ dir: string; oldHash: string; newHash: string }> {
  const dir = path.join(projectsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(oldFiles)) write(dir, rel, content);
  if (!oldFiles["openleaf.json"]) {
    write(dir, "openleaf.json", JSON.stringify({ mainFile: "main.tex", engine: "pdflatex" }));
  }
  await ensureProjectGit(id);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "old", "--no-gpg-sign"]);
  const oldHash = await git(dir, ["rev-parse", "HEAD"]);
  for (const [rel, content] of Object.entries(newFiles)) write(dir, rel, content);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-m", "new", "--no-gpg-sign"]);
  const newHash = await git(dir, ["rev-parse", "HEAD"]);
  return { dir, oldHash, newHash };
}

const ARTICLE_OLD = `\\documentclass{article}
\\begin{document}
The cat sat.
\\end{document}
`;
const ARTICLE_NEW = `\\documentclass{article}
\\begin{document}
The cat sat on the mat.
\\end{document}
`;

describe("flattenTexFile / metrics expand", () => {
  it("inlines \\input and leaves misc/ alone", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ol-flat-"));
    write(root, "main.tex", "\\input{metrics}\n\\input{sections/body}\n\\input{misc/notes}\n");
    write(root, "metrics.tex", "\\newcommand{\\Score}{1}\n");
    write(root, "sections/body.tex", "Hello body.\n");
    write(root, "misc/notes.tex", "secret draft\n");
    const flat = flattenTexFile(root, path.join(root, "main.tex"));
    assert.match(flat, /\\newcommand\{\\Score\}\{1\}/);
    assert.match(flat, /Hello body\./);
    assert.match(flat, /\\input\{misc\/notes\}/);
    assert.doesNotMatch(flat, /secret draft/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("parses no-arg newcommands and expands changed metrics in the body", () => {
    const cmds = parseNoArgNewcommands("\\newcommand{\\Score}{0.91}\\newcommand{\\N}[1]{x}");
    assert.equal(cmds.get("Score"), "0.91");
    assert.equal(cmds.has("N"), false);

    const oldTex =
      "\\newcommand{\\Score}{0.91}\\newcommand{\\Keep}{ok}\\begin{document}AUC was \\Score{}.\\end{document}";
    const newTex =
      "\\newcommand{\\Score}{0.93}\\newcommand{\\Keep}{ok}\\begin{document}AUC was \\Score{}.\\end{document}";
    const r = expandChangedMetricsMacros(oldTex, newTex);
    assert.deepEqual(r.expanded, ["Score"]);
    assert.match(r.old, /AUC was \{0\.91\}\./);
    assert.match(r.new, /AUC was \{0\.93\}\./);
    assert.match(r.old, /\\newcommand\{\\Score\}\{0\.91\}/);
    assert.match(r.new, /\\newcommand\{\\Score\}\{0\.93\}/);
  });
});

describe("generateTrackChanges", () => {
  after(() => {
    setLatexdiffAvailableForTests(null);
    fs.rmSync(projectsRoot, { recursive: true, force: true });
  });

  it("rejects unknown hash, same commit, and missing latexdiff", async () => {
    const { oldHash, newHash } = await twoCommitProject("tc-errors", { "main.tex": ARTICLE_OLD }, {
      "main.tex": ARTICLE_NEW,
    });

    await assert.rejects(
      () => generateTrackChanges("tc-errors", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", newHash),
      (e: unknown) => {
        assert.equal((e as { status?: number }).status, 404);
        return true;
      },
    );
    await assert.rejects(
      () => generateTrackChanges("tc-errors", oldHash, oldHash),
      (e: unknown) => {
        assert.equal((e as { status?: number }).status, 400);
        assert.match((e as Error).message, /same commit/i);
        return true;
      },
    );

    setLatexdiffAvailableForTests(false);
    await assert.rejects(
      () => generateTrackChanges("tc-errors", oldHash, newHash),
      (e: unknown) => {
        assert.equal((e as { status?: number }).status, 501);
        assert.match((e as Error).message, /latexdiff/i);
        return true;
      },
    );
    setLatexdiffAvailableForTests(null);
  });

  it("marks prose insert/delete/replace and does not touch live or snapshot source", { skip: !latexdiffInstalled }, async () => {
    const { dir, oldHash, newHash } = await twoCommitProject(
      "tc-prose",
      { "main.tex": ARTICLE_OLD },
      { "main.tex": ARTICLE_NEW },
    );

    const oldSnap = await ensureSnapshotRoot("tc-prose", oldHash);
    const newSnap = await ensureSnapshotRoot("tc-prose", newHash);
    const liveBefore = listSource(dir);
    const oldBefore = listSource(oldSnap);
    const newBefore = listSource(newSnap);

    const result = await generateTrackChanges("tc-prose", oldHash, newHash);
    assert.equal(result.ok, true, result.log.slice(-800));
    assert.equal(result.cached, false);
    assert.ok(result.pdfRelative);
    assert.ok(fs.existsSync(path.join(dir, result.scratchRelative, result.pdfRelative)));

    const marked = fs.readFileSync(path.join(dir, result.scratchRelative, "main.tex"), "utf8");
    assert.match(marked, /\\DIF(add|addbegin)/i);
    assert.match(marked, /mat/);

    assertMapsEqual(liveBefore, listSource(dir), "live worktree");
    assertMapsEqual(oldBefore, listSource(oldSnap), "old snapshot");
    assertMapsEqual(newBefore, listSource(newSnap), "new snapshot");
    assert.equal(snapshotRootIfPresent("tc-prose", oldHash), oldSnap);

    const again = await generateTrackChanges("tc-prose", oldHash, newHash);
    assert.equal(again.ok, true);
    assert.equal(again.cached, true);
  });

  it("flattens multi-file \\input so section edits are marked", { skip: !latexdiffInstalled }, async () => {
    const { dir, oldHash, newHash } = await twoCommitProject(
      "tc-input",
      {
        "main.tex": "\\documentclass{article}\\begin{document}\\input{sections/body}\\end{document}\n",
        "sections/body.tex": "Alpha paragraph.\n",
      },
      {
        "main.tex": "\\documentclass{article}\\begin{document}\\input{sections/body}\\end{document}\n",
        "sections/body.tex": "Alpha paragraph with extra words.\n",
      },
    );

    const result = await generateTrackChanges("tc-input", oldHash, newHash);
    assert.equal(result.ok, true, result.log.slice(-800));
    const marked = fs.readFileSync(path.join(dir, result.scratchRelative, "main.tex"), "utf8");
    assert.match(marked, /extra words/);
    assert.match(marked, /\\DIF(add|addbegin)/i);
  });

  it("shows metrics macro value changes in the body markup", { skip: !latexdiffInstalled }, async () => {
    const { dir, oldHash, newHash } = await twoCommitProject(
      "tc-metrics",
      {
        "main.tex":
          "\\documentclass{article}\\input{metrics}\\begin{document}AUC was \\Score{}.\\end{document}\n",
        "metrics.tex": "\\newcommand{\\Score}{0.91}\n",
      },
      {
        "main.tex":
          "\\documentclass{article}\\input{metrics}\\begin{document}AUC was \\Score{}.\\end{document}\n",
        "metrics.tex": "\\newcommand{\\Score}{0.93}\n",
      },
    );

    const result = await generateTrackChanges("tc-metrics", oldHash, newHash);
    assert.equal(result.ok, true, result.log.slice(-800));
    assert.ok(result.expandedMacros.includes("Score"));
    const marked = fs.readFileSync(path.join(dir, result.scratchRelative, "main.tex"), "utf8");
    assert.match(marked, /0\.91/);
    assert.match(marked, /0\.93/);
    assert.match(marked, /\\DIF(add|addbegin|del|delbegin)/i);
  });

  it("still compiles when a tabular cell changes (atomic table replace)", { skip: !latexdiffInstalled }, async () => {
    const oldTex = `\\documentclass{article}
\\usepackage{array}
\\begin{document}
\\begin{tabular}{ll}
a & 1 \\\\
\\end{tabular}
\\end{document}
`;
    const newTex = `\\documentclass{article}
\\usepackage{array}
\\begin{document}
\\begin{tabular}{ll}
a & 2 \\\\
\\end{tabular}
\\end{document}
`;
    const { oldHash, newHash } = await twoCommitProject(
      "tc-table",
      { "main.tex": oldTex },
      { "main.tex": newTex },
    );
    const result = await generateTrackChanges("tc-table", oldHash, newHash);
    assert.equal(result.ok, true, result.log.slice(-800));
    assert.ok(result.pdfRelative);
  });
});
