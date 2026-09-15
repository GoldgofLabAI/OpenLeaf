export type PreviewToken = { kind: "eq" | "add" | "del"; text: string };

export type SuggestLine = { kind: "context" | "add" | "del"; text: string };

export type SuggestPreview =
  | { mode: "inline"; tokens: PreviewToken[] }
  | { mode: "blocks"; before: string; after: string };

function sides(lines: SuggestLine[]): { before: string; after: string } {
  return {
    before: lines.filter((l) => l.kind === "del").map((l) => l.text).join("\n"),
    after: lines.filter((l) => l.kind === "add").map((l) => l.text).join("\n"),
  };
}

export function mergePreviewTokens(tokens: PreviewToken[]): PreviewToken[] {
  const out: PreviewToken[] = [];
  for (const t of tokens) {
    if (!t.text) continue;
    const last = out[out.length - 1];
    if (last && last.kind === t.kind) last.text += t.text;
    else out.push({ kind: t.kind, text: t.text });
  }
  return out;
}

/** Consecutive add/del groups, ignoring unchanged text. One word swap → 2. */
export function changeGroupCount(tokens: PreviewToken[]): number {
  let n = 0;
  let prev: "add" | "del" | null = null;
  for (const t of tokens) {
    if (t.kind === "eq") continue;
    if (t.kind !== prev) {
      n += 1;
      prev = t.kind;
    }
  }
  return n;
}

/**
 * Word-level red/green is readable for a short phrase swap.
 * A rewritten sentence/paragraph becomes a Myers "ransom note" in one wrapping
 * <p> (adjacent del+add glue into remainsis / WeHere). Those use stacked blocks.
 */
export function previewFromHunk(hunk: { lines: SuggestLine[]; inline?: PreviewToken[] }): SuggestPreview {
  const { before, after } = sides(hunk.lines);
  const delCount = hunk.lines.filter((l) => l.kind === "del").length;
  const addCount = hunk.lines.filter((l) => l.kind === "add").length;
  const tokens = mergePreviewTokens(hunk.inline ?? []);
  const multiline = before.includes("\n") || after.includes("\n") || delCount > 1 || addCount > 1;
  const choppy = changeGroupCount(tokens) > 4;
  if (!before || !after || multiline || choppy || tokens.length === 0) {
    return { mode: "blocks", before, after };
  }
  return { mode: "inline", tokens };
}
