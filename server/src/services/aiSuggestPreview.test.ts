import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changeGroupCount,
  pickPreviewMode,
  previewFromHunk,
  tokensCoverSides,
  type SuggestLine,
} from "../../../client/src/components/aiSuggestPreview.ts";
import { computeHunks, condenseInline, inlineDiff, mergeInlineTokens } from "./textPatch.ts";

function linesFromSides(before: string, after: string): SuggestLine[] {
  const out: SuggestLine[] = [];
  if (before) for (const text of before.split("\n")) out.push({ kind: "del", text });
  if (after) for (const text of after.split("\n")) out.push({ kind: "add", text });
  return out;
}

function wordTokens(before: string, after: string) {
  return mergeInlineTokens(inlineDiff(before, after));
}

describe("pickPreviewMode", () => {
  it("chooses Google Docs / Grammarly for a single-word swap", () => {
    const before = "The quick brown fox jumps.";
    const after = "The slow brown fox jumps.";
    assert.equal(pickPreviewMode({ before, after, tokens: wordTokens(before, after) }), "suggest");
  });

  it("chooses split for a rewritten paragraph", () => {
    const before = `Bone marrow morphology remains the reference standard for diagnosing hematologic malignancies.
We present DeepHeme, a model that classifies cells from whole-slide images.`;
    const after = `Bone-marrow morphology is still regarded as the reference standard when diagnosing haematologic malignancy.
Here we introduce DeepHeme, a vision model that classifies hematopoietic cells on whole-slide images.`;
    assert.equal(pickPreviewMode({ before, after, tokens: wordTokens(before, after) }), "split");
  });

  it("chooses split when only one side exists", () => {
    assert.equal(pickPreviewMode({ before: "", after: "new sentence", tokens: [] }), "split");
    assert.equal(pickPreviewMode({ before: "gone", after: "", tokens: [] }), "split");
  });
});

describe("previewFromHunk", () => {
  it("keeps a single-word swap as inline suggestion markup", () => {
    const oldT = "The quick brown fox jumps.\n";
    const newT = "The slow brown fox jumps.\n";
    const hunk = computeHunks(oldT, newT)[0]!;
    const before = hunk.lines.filter((l) => l.kind === "del").map((l) => l.text).join("\n");
    const after = hunk.lines.filter((l) => l.kind === "add").map((l) => l.text).join("\n");
    const preview = previewFromHunk({ lines: hunk.lines, inline: wordTokens(before, after) });
    assert.equal(preview.mode, "suggest");
    if (preview.mode !== "suggest") return;
    const changed = preview.tokens.filter((t) => t.kind !== "eq").map((t) => `${t.kind}:${t.text}`);
    assert.deepEqual(changed, ["del:quick", "add:slow"]);
  });

  it("uses side-by-side before/after with word highlights for a rewrite", () => {
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
    const inline = wordTokens(before, after);
    assert.ok(changeGroupCount(inline) > 4);
    const preview = previewFromHunk({ lines: hunk.lines, inline });
    assert.equal(preview.mode, "split");
    if (preview.mode !== "split") return;
    assert.match(preview.before, /We present DeepHeme/);
    assert.match(preview.after, /Here we introduce DeepHeme/);
    assert.equal(preview.before.includes("Here we introduce"), false);
    assert.ok(preview.before.includes("\n"));
    assert.ok(preview.beforeTokens);
    assert.ok(preview.afterTokens);
    assert.equal(preview.beforeTokens!.some((t) => t.kind === "add"), false);
    assert.equal(preview.afterTokens!.some((t) => t.kind === "del"), false);
    assert.ok(preview.beforeTokens!.some((t) => t.kind === "del"));
    assert.ok(preview.afterTokens!.some((t) => t.kind === "add"));
  });

  it("does not highlight split panes when inline tokens were clipped", () => {
    const before = `Bone marrow morphology remains the reference.
We present DeepHeme.`;
    const after = `Bone-marrow morphology is still regarded as the reference.
Here we introduce DeepHeme.`;
    const clipped = condenseInline(wordTokens(before, after), 8);
    assert.equal(tokensCoverSides(clipped, before, after), false);
    const preview = previewFromHunk({
      lines: linesFromSides(before, after),
      inline: clipped,
    });
    assert.equal(preview.mode, "split");
    if (preview.mode !== "split") return;
    assert.equal(preview.before, before);
    assert.equal(preview.after, after);
    assert.equal(preview.beforeTokens, null);
    assert.equal(preview.afterTokens, null);
  });

  it("uses split for insert-only and delete-only changes", () => {
    const inserted = previewFromHunk({ lines: linesFromSides("", "a new sentence") });
    assert.equal(inserted.mode, "split");
    if (inserted.mode === "split") {
      assert.equal(inserted.before, "");
      assert.equal(inserted.after, "a new sentence");
      assert.deepEqual(inserted.afterTokens, [{ kind: "add", text: "a new sentence" }]);
    }
    const removed = previewFromHunk({ lines: linesFromSides("gone now", "") });
    assert.equal(removed.mode, "split");
    if (removed.mode === "split") {
      assert.equal(removed.before, "gone now");
      assert.equal(removed.after, "");
    }
  });
});
