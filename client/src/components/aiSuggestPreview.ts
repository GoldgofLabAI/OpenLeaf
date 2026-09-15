export type PreviewToken = { kind: "eq" | "add" | "del"; text: string };

export type SuggestLine = { kind: "context" | "add" | "del"; text: string };

export type SuggestPreview =
  | { mode: "suggest"; tokens: PreviewToken[] }
  | {
      mode: "split";
      before: string;
      after: string;
      beforeTokens: PreviewToken[] | null;
      afterTokens: PreviewToken[] | null;
    };

/** One or two substitutions on a short line stay in the sentence. */
export const SUGGEST_MAX_CHANGE_GROUPS = 4;
/** Beyond this, a single line is easier to read as two columns. */
export const SUGGEST_MAX_CHARS = 280;
/** If almost none of the original words survive, treat it as a rewrite. */
export const SUGGEST_MIN_EQ_RATIO = 0.25;

function sides(lines: SuggestLine[]): { before: string; after: string; delCount: number; addCount: number } {
  const del = lines.filter((l) => l.kind === "del").map((l) => l.text);
  const add = lines.filter((l) => l.kind === "add").map((l) => l.text);
  return { before: del.join("\n"), after: add.join("\n"), delCount: del.length, addCount: add.length };
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

function nonSpaceLen(text: string): number {
  return text.replace(/\s+/g, "").length;
}

export function joinSide(tokens: PreviewToken[], skip: "add" | "del"): string {
  return tokens.filter((t) => t.kind !== skip).map((t) => t.text).join("");
}

/** True when the word-diff reconstructs both sides (not a clipped/condensed soup). */
export function tokensCoverSides(tokens: PreviewToken[], before: string, after: string): boolean {
  if (tokens.length === 0) return false;
  return joinSide(tokens, "add") === before && joinSide(tokens, "del") === after;
}

export function splitHighlightTokens(tokens: PreviewToken[]): {
  beforeTokens: PreviewToken[];
  afterTokens: PreviewToken[];
} {
  return {
    beforeTokens: tokens.filter((t) => t.kind !== "add"),
    afterTokens: tokens.filter((t) => t.kind !== "del"),
  };
}

export type PreviewModeGuess = {
  before: string;
  after: string;
  tokens: PreviewToken[];
};

/**
 * Google Docs / Grammarly when the change is still a phrase in one sentence.
 * Side-by-side when it is a rewrite, multi-line, insert/delete-only, or too choppy.
 */
export function pickPreviewMode(guess: PreviewModeGuess): "suggest" | "split" {
  const { before, after, tokens } = guess;
  if (!before || !after) return "split";
  if (before.includes("\n") || after.includes("\n")) return "split";
  if (Math.max(before.length, after.length) > SUGGEST_MAX_CHARS) return "split";
  const groups = changeGroupCount(tokens);
  if (groups === 0 || groups > SUGGEST_MAX_CHANGE_GROUPS) return "split";
  const eqChars = tokens.filter((t) => t.kind === "eq").reduce((n, t) => n + nonSpaceLen(t.text), 0);
  const basis = Math.min(nonSpaceLen(before), nonSpaceLen(after));
  if (basis > 0 && eqChars / basis < SUGGEST_MIN_EQ_RATIO) return "split";
  return "suggest";
}

function syntheticLineSwap(before: string, after: string): PreviewToken[] {
  return [
    { kind: "del", text: before },
    { kind: "add", text: after },
  ];
}

/**
 * Auto-pick display: `suggest` is inline strike + insert; `split` is before/after
 * columns with optional word highlights (no strikethrough).
 */
export function previewFromHunk(hunk: { lines: SuggestLine[]; inline?: PreviewToken[] }): SuggestPreview {
  const { before, after } = sides(hunk.lines);
  let tokens = mergePreviewTokens(hunk.inline ?? []);
  if (tokens.length === 0 && before && after && !before.includes("\n") && !after.includes("\n")) {
    tokens = syntheticLineSwap(before, after);
  }
  const mode = pickPreviewMode({ before, after, tokens });
  if (mode === "suggest") {
    return { mode: "suggest", tokens };
  }
  if (!before && after) {
    return {
      mode: "split",
      before,
      after,
      beforeTokens: null,
      afterTokens: [{ kind: "add", text: after }],
    };
  }
  if (before && !after) {
    return {
      mode: "split",
      before,
      after,
      beforeTokens: [{ kind: "del", text: before }],
      afterTokens: null,
    };
  }
  const cover = tokensCoverSides(tokens, before, after);
  const split = cover ? splitHighlightTokens(tokens) : { beforeTokens: null, afterTokens: null };
  return {
    mode: "split",
    before,
    after,
    beforeTokens: split.beforeTokens,
    afterTokens: split.afterTokens,
  };
}
