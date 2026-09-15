import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFilePatch,
  applyFilePatches,
  applyHunks,
  applySingleHunk,
  computeHunks,
  countSubstrings,
  diffTokens,
  formatUnifiedDiff,
  hunkNewRanges,
  inlineDiff,
  newSide,
  oldSide,
  parseUnifiedDiff,
  PatchError,
  replaceAllSubstrings,
  replaceLineRange,
  replaceUnique,
  sliceLines,
} from "./textPatch.js";

function lcsOps(a: string[], b: string[]): Array<{ type: "eq" | "del" | "add"; text: string }> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]![j + 1]! + 1) : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Array<{ type: "eq" | "del" | "add"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", text: a[i]! });
      i += 1;
    } else {
      ops.push({ type: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: a[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", text: b[j]! });
    j += 1;
  }
  return ops;
}

function replay(a: string[], ops: Array<{ type: "eq" | "del" | "add"; text: string }>): string[] {
  const out: string[] = [];
  let i = 0;
  for (const op of ops) {
    if (op.type === "eq") {
      assert.equal(a[i], op.text);
      out.push(op.text);
      i += 1;
    } else if (op.type === "del") {
      assert.equal(a[i], op.text);
      i += 1;
    } else {
      out.push(op.text);
    }
  }
  assert.equal(i, a.length);
  return out;
}

describe("search-replace", () => {
  it("replaces a unique substring", () => {
    assert.equal(replaceUnique("aaa X bbb", "X", "Y"), "aaa Y bbb");
  });

  it("fails when old is missing or not unique", () => {
    assert.throws(() => replaceUnique("abc", "z", "q"), PatchError);
    assert.throws(() => replaceUnique("x x", "x", "y"), (e: PatchError) => e.code === "NOT_UNIQUE");
  });

  it("replace_all substitutes every non-overlapping match", () => {
    const r = replaceAllSubstrings("x x x", "x", "y");
    assert.equal(r.text, "y y y");
    assert.equal(r.count, 3);
  });

  it("empty old only on empty haystack", () => {
    assert.equal(replaceUnique("", "", "new\n"), "new\n");
    assert.throws(() => replaceUnique("keep", "", "x"), /Empty old/);
  });

  it("counts non-overlapping substrings", () => {
    assert.equal(countSubstrings("aaaa", "aa"), 2);
  });
});

describe("line range", () => {
  const src = "a\nb\nc\nd\n";

  it("replaces an inclusive span", () => {
    assert.equal(replaceLineRange(src, 2, 3, "B\nC\n"), "a\nB\nC\nd\n");
  });

  it("inserts before a line when endLine = startLine - 1", () => {
    assert.equal(replaceLineRange(src, 2, 1, "X\n"), "a\nX\nb\nc\nd\n");
  });

  it("replaces a single line", () => {
    assert.equal(replaceLineRange("only", 1, 1, "two"), "two");
  });

  it("rejects ranges past EOF", () => {
    assert.throws(() => replaceLineRange(src, 9, 9, "x"), PatchError);
  });
});

describe("sliceLines", () => {
  it("returns a 1-indexed inclusive window", () => {
    const s = sliceLines("a\nb\nc\nd\n", 2, 3);
    assert.equal(s.content, "b\nc");
    assert.equal(s.from, 2);
    assert.equal(s.to, 3);
    assert.equal(s.totalLines, 4);
    assert.equal(s.truncated, true);
  });
});

describe("Myers vs LCS", () => {
  it("replays to the new sequence on classic input", () => {
    const a = ["A", "B", "C", "A", "B", "B", "A"];
    const b = ["C", "B", "A", "B", "A", "C"];
    const ops = diffTokens(a, b);
    assert.deepEqual(replay(a, ops), b);
  });

  it("matches LCS reconstruction on random tokens", () => {
    for (let t = 0; t < 40; t += 1) {
      const n = 1 + (t % 12);
      const m = 1 + ((t * 3) % 12);
      const a = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + ((i * 3 + t) % 8)));
      const b = Array.from({ length: m }, (_, i) => String.fromCharCode(65 + ((i * 5 + t) % 8)));
      const myers = diffTokens(a, b);
      assert.deepEqual(replay(a, myers), b, `t=${t}`);
      const lcs = lcsOps(a, b);
      assert.deepEqual(replay(a, lcs), b);
    }
  });
});

describe("hunks + apply", () => {
  it("round-trips a mid-file edit", () => {
    const oldT = "alpha\nbeta\ngamma\ndelta\n";
    const newT = "alpha\nBETA\ngamma\ndelta\n";
    const hunks = computeHunks(oldT, newT);
    assert.equal(hunks.length, 1);
    assert.equal(applyHunks(oldT, hunks), newT);
    assert.equal(applyHunks(newT, hunks, true), oldT);
  });

  it("handles two separated edits", () => {
    const oldT = Array.from({ length: 24 }, (_, i) => String(i + 1)).join("\n") + "\n";
    const lines = oldT.split("\n");
    lines[1] = "X";
    lines[20] = "Y";
    const newT = lines.join("\n");
    const hunks = computeHunks(oldT, newT);
    assert.ok(hunks.length >= 2);
    assert.equal(applyHunks(oldT, hunks), newT);
    const afterRejectFirst = applySingleHunk(newT, hunks[0]!, true);
    assert.equal(afterRejectFirst.includes("X"), false);
    assert.equal(afterRejectFirst.includes("Y"), true);
  });

  it("creates a file from empty", () => {
    const hunks = computeHunks("", "hello\nworld\n");
    assert.equal(applyHunks("", hunks), "hello\nworld\n");
  });

  it("accepting the first separated hunk updates the old side only", () => {
    const oldT = Array.from({ length: 24 }, (_, i) => String(i + 1)).join("\n") + "\n";
    const lines = oldT.split("\n");
    lines[1] = "X";
    lines[20] = "Y";
    const newT = lines.join("\n");
    const hunks = computeHunks(oldT, newT);
    const mid = applySingleHunk(oldT, hunks[0]!, false);
    assert.equal(computeHunks(mid, newT).length, 1);
    assert.equal(applySingleHunk(mid, computeHunks(mid, newT)[0]!, false), newT);
  });

  it("inline-diffs a single word instead of the whole line", () => {
    const oldT = "The quick brown fox jumps.\n";
    const newT = "The slow brown fox jumps.\n";
    const hunks = computeHunks(oldT, newT);
    assert.equal(hunks.length, 1);
    const tokens = inlineDiff(oldSide(hunks[0]!).join("\n"), newSide(hunks[0]!).join("\n"));
    const changed = tokens.filter((t) => t.kind !== "eq").map((t) => `${t.kind}:${t.text}`);
    assert.deepEqual(changed, ["del:quick", "add:slow"]);
    const ranges = hunkNewRanges(hunks[0]!);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0]!.startLine, 1);
    assert.equal(ranges[0]!.endColumn - ranges[0]!.startColumn, "slow".length);
  });
});

describe("unified diff parse/apply", () => {
  it("applies a git-style patch", () => {
    const oldT = "foo\nbar\nbaz\n";
    const newT = "foo\nBAR\nbaz\n";
    const diff = formatUnifiedDiff("main.tex", oldT, newT);
    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.path, "main.tex");
    assert.equal(applyFilePatch(oldT, files[0]!), newT);
  });

  it("rejects a patch whose context does not match", () => {
    const diff = `--- a/main.tex
+++ b/main.tex
@@ -1,3 +1,3 @@
 foo
-bar
+BAR
 baz
`;
    const files = parseUnifiedDiff(diff);
    assert.throws(() => applyFilePatch("nope\n", files[0]!), (e: PatchError) => e.code === "CONTEXT_MISMATCH");
  });

  it("creates from /dev/null", () => {
    const diff = `--- /dev/null
+++ b/NEW.md
@@ -0,0 +1,2 @@
+hi
+there
`;
    const files = parseUnifiedDiff(diff);
    assert.equal(files[0]!.created, true);
    assert.equal(applyFilePatch(null, files[0]!), "hi\nthere\n");
  });

  it("round-trips an added line that starts with ++ (+++ in the patch)", () => {
    const oldT = "keep\n";
    const newT = "keep\n++ foo\n";
    const diff = formatUnifiedDiff("a.tex", oldT, newT);
    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.path, "a.tex");
    assert.equal(applyFilePatch(oldT, files[0]!), newT);
  });

  it("round-trips a deleted line that starts with -- (--- in the patch)", () => {
    const oldT = "keep\n-- foo\n";
    const newT = "keep\n";
    const diff = formatUnifiedDiff("a.tex", oldT, newT);
    assert.equal(applyFilePatch(oldT, parseUnifiedDiff(diff)[0]!), newT);
  });

  it("stacks two patches for the same path", () => {
    const oldT = "a\nb\nc\n";
    const mid = "a\nB\nc\n";
    const last = "a\nB\nC\n";
    const stacked = applyFilePatches(oldT, [
      ...parseUnifiedDiff(formatUnifiedDiff("f", oldT, mid)),
      ...parseUnifiedDiff(formatUnifiedDiff("f", mid, last)),
    ]);
    assert.equal(stacked, last);
  });
});
