import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMergeCompare,
  collapseUnchanged,
  intraLineHighlights,
  mergeCompareStats,
  splitMergeLines,
  type MergeDiffRow,
} from "../../../client/src/components/mergeDiff.ts";

describe("buildMergeCompare", () => {
  it("highlights the changed word on a paired line", () => {
    const rows = buildMergeCompare("The quick brown fox\n", "The slow brown fox\n", { context: 3 });
    const change = rows.find((r) => r.type === "change");
    assert.ok(change && change.type === "change");
    const leftMarks = change.leftToks.filter((t) => t.kind === "mark").map((t) => t.text);
    const rightMarks = change.rightToks.filter((t) => t.kind === "mark").map((t) => t.text);
    assert.deepEqual(leftMarks, ["quick"]);
    assert.deepEqual(rightMarks, ["slow"]);
  });

  it("shows an added line only on incoming", () => {
    const rows = buildMergeCompare("alpha\ngamma\n", "alpha\nbeta\ngamma\n", { context: 2 });
    const add = rows.find((r) => r.type === "add");
    assert.ok(add && add.type === "add");
    assert.equal(add.right, "beta");
  });

  it("folds a long unchanged run so the edit is visible", () => {
    const left = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join("\n") + "\n";
    const rightLines = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`);
    rightLines[19] = "line-20-CHANGED";
    const rows = buildMergeCompare(left, rightLines.join("\n") + "\n", { context: 2 });
    const stats = mergeCompareStats(rows);
    assert.ok(stats.gaps >= 1);
    assert.ok(stats.changes >= 1);
    const visibleEq = rows.filter((r) => r.type === "eq").length;
    assert.ok(visibleEq < 40);
  });

  it("reports no changes for identical files", () => {
    const rows = buildMergeCompare("same\nfile\n", "same\nfile\n");
    assert.equal(mergeCompareStats(rows).changes, 0);
    assert.ok(rows.every((r) => r.type === "eq" || r.type === "gap"));
  });
});

describe("intraLineHighlights", () => {
  it("marks only the swapped token", () => {
    const { leftToks, rightToks } = intraLineHighlights("keep foo end", "keep bar end");
    assert.deepEqual(
      leftToks.filter((t) => t.kind === "mark").map((t) => t.text),
      ["foo"],
    );
    assert.deepEqual(
      rightToks.filter((t) => t.kind === "mark").map((t) => t.text),
      ["bar"],
    );
  });
});

describe("collapseUnchanged", () => {
  it("keeps context around an edit", () => {
    const rows: MergeDiffRow[] = [
      { type: "eq", left: "a", right: "a", leftNo: 1, rightNo: 1 },
      { type: "eq", left: "b", right: "b", leftNo: 2, rightNo: 2 },
      { type: "eq", left: "c", right: "c", leftNo: 3, rightNo: 3 },
      { type: "del", left: "gone", leftNo: 4 },
      { type: "eq", left: "e", right: "e", leftNo: 5, rightNo: 4 },
      { type: "eq", left: "f", right: "f", leftNo: 6, rightNo: 5 },
      { type: "eq", left: "g", right: "g", leftNo: 7, rightNo: 6 },
    ];
    const out = collapseUnchanged(rows, 1);
    const types = out.map((r) => r.type);
    assert.deepEqual(types, ["gap", "eq", "del", "eq", "gap"]);
  });
});

describe("splitMergeLines", () => {
  it("does not invent a trailing empty line", () => {
    assert.deepEqual(splitMergeLines("a\nb\n"), ["a", "b"]);
    assert.deepEqual(splitMergeLines(""), []);
  });
});
