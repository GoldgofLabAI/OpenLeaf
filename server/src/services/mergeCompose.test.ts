import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMergeTipPick, type MergeDraft } from "../../../client/src/components/mergeCompose.ts";

describe("applyMergeTipPick", () => {
  it("advances to Into after choosing From when Into was prefilled", () => {
    const draft: MergeDraft = { filling: "from", fromBranchId: null, intoBranchId: "main" };
    const next = applyMergeTipPick(draft, "methods");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.draft.fromBranchId, "methods");
    assert.equal(next.draft.intoBranchId, "main");
    assert.equal(next.draft.filling, "into");
  });

  it("rejects picking the same tip as Into while filling From", () => {
    const draft: MergeDraft = { filling: "from", fromBranchId: null, intoBranchId: "main" };
    const next = applyMergeTipPick(draft, "main");
    assert.equal(next.ok, false);
  });

  it("lets a later tap replace Into", () => {
    const draft: MergeDraft = { filling: "into", fromBranchId: "methods", intoBranchId: "main" };
    const next = applyMergeTipPick(draft, "results");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.draft.intoBranchId, "results");
    assert.equal(next.draft.fromBranchId, "methods");
    assert.equal(next.draft.filling, "into");
  });
});
