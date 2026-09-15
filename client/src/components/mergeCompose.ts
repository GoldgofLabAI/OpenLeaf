export type MergeDraft = {
  filling: "from" | "into";
  fromBranchId: string | null;
  intoBranchId: string | null;
};

export type MergeTipPick =
  | { ok: true; draft: MergeDraft }
  | { ok: false; error: string };

/**
 * After From is chosen, always advance filling to Into — even when Into was
 * prefilled with the current editable tip. Otherwise a second tap replaces From.
 */
export function applyMergeTipPick(draft: MergeDraft, tipId: string): MergeTipPick {
  if (draft.filling === "from") {
    if (tipId === draft.intoBranchId) {
      return { ok: false, error: "Bring in a different tip than the one you land on" };
    }
    return {
      ok: true,
      draft: {
        filling: "into",
        fromBranchId: tipId,
        intoBranchId: draft.intoBranchId,
      },
    };
  }
  if (tipId === draft.fromBranchId) {
    return { ok: false, error: "Land on a different tip than the one you bring in" };
  }
  return {
    ok: true,
    draft: {
      filling: "into",
      fromBranchId: draft.fromBranchId,
      intoBranchId: tipId,
    },
  };
}
