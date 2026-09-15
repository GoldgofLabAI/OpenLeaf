import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changeGroupCount,
  previewFromHunk,
  type SuggestLine,
} from "../../../client/src/components/aiSuggestPreview.ts";
import { computeHunks, condenseInline, inlineDiff } from "./textPatch.ts";

function linesFromSides(before: string, after: string): SuggestLine[] {
  const out: SuggestLine[] = [];
  if (before) for (const text of before.split("\n")) out.push({ kind: "del", text });
  if (after) for (const text of after.split("\n")) out.push({ kind: "add", text });
  return out;
}

describe("previewFromHunk", () => {
  it("keeps a single-word swap as inline red/green", () => {
    const oldT = "The quick brown fox jumps.\n";
    const newT = "The slow brown fox jumps.\n";
    const hunk = computeHunks(oldT, newT)[0]!;
    const inline = condenseInline(inlineDiff("The quick brown fox jumps.", "The slow brown fox jumps."));
    const preview = previewFromHunk({ lines: hunk.lines, inline });
    assert.equal(preview.mode, "inline");
    if (preview.mode !== "inline") return;
    const changed = preview.tokens.filter((t) => t.kind !== "eq").map((t) => `${t.kind}:${t.text}`);
    assert.deepEqual(changed, ["del:quick", "add:slow"]);
  });

  it("stacks a rewritten paragraph instead of a word-level soup", () => {
    const oldT = `Bone marrow morphology remains the reference standard for diagnosing hematologic malignancies.
We present DeepHeme, a model that classifies cells from whole-slide images.
Prior work has focused on single-cell crops rather than the full tissue context.
`;
    const newT = `Bone-marrow morphology is still regarded as the reference standard when diagnosing haematologic malignancy.
Here we introduce DeepHeme, a vision model that classifies hematopoietic cells on whole-slide images.
Earlier studies typically operated on isolated single-cell crops instead of the surrounding tissue context.
`;
    const hunk = computeHunks(oldT, newT)[0]!;
    const before = hunk.lines.filter((l) => l.kind === "del").map((l) => l.text).join("\n");
    const after = hunk.lines.filter((l) => l.kind === "add").map((l) => l.text).join("\n");
    const inline = condenseInline(inlineDiff(before, after));
    assert.ok(changeGroupCount(inline) > 4);
    const preview = previewFromHunk({ lines: hunk.lines, inline });
    assert.equal(preview.mode, "blocks");
    if (preview.mode !== "blocks") return;
    assert.match(preview.before, /We present DeepHeme/);
    assert.match(preview.after, /Here we introduce DeepHeme/);
    assert.equal(preview.before.includes("Here we introduce"), false);
    assert.ok(preview.before.includes("\n"));
  });

  it("stacks insert-only and delete-only changes", () => {
    const inserted = previewFromHunk({ lines: linesFromSides("", "a new sentence") });
    assert.equal(inserted.mode, "blocks");
    if (inserted.mode === "blocks") {
      assert.equal(inserted.before, "");
      assert.equal(inserted.after, "a new sentence");
    }
    const removed = previewFromHunk({ lines: linesFromSides("gone now", "") });
    assert.equal(removed.mode, "blocks");
    if (removed.mode === "blocks") {
      assert.equal(removed.before, "gone now");
      assert.equal(removed.after, "");
    }
  });
});
