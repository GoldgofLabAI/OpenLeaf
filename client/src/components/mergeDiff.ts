export type MergeHlTok = { kind: "eq" | "mark"; text: string };

export type MergeDiffRow =
  | {
      type: "eq";
      left: string;
      right: string;
      leftNo: number;
      rightNo: number;
    }
  | {
      type: "del";
      left: string;
      leftNo: number;
    }
  | {
      type: "add";
      right: string;
      rightNo: number;
    }
  | {
      type: "change";
      left: string;
      right: string;
      leftNo: number;
      rightNo: number;
      leftToks: MergeHlTok[];
      rightToks: MergeHlTok[];
    };

export type MergeDisplayRow =
  | MergeDiffRow
  | { type: "gap"; skipped: number; rows: MergeDiffRow[] };

const DP_CELL_CAP = 2_000_000;
const WORD_LINE_CAP = 4000;
export const MERGE_CONTEXT_LINES = 3;

export function splitMergeLines(text: string): string[] {
  if (text === "") return [];
  const eofNl = text.endsWith("\n");
  const body = eofNl ? text.slice(0, -1) : text;
  return body.length === 0 ? [""] : body.split("\n");
}

type LineOp = { type: "eq" | "del" | "add"; text: string };

function diffLines(a: string[], b: string[]): LineOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const prefix: LineOp[] = a.slice(0, start).map((text) => ({ type: "eq", text }));
  const suffix: LineOp[] = a.slice(endA).map((text) => ({ type: "eq", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length === 0 && midB.length === 0) return prefix.concat(suffix);
  return prefix.concat(lcsMiddle(midA, midB), suffix);
}

function lcsMiddle(a: string[], b: string[]): LineOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ type: "del" as const, text }));
  if (n * m > DP_CELL_CAP) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
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

function tokenizeWords(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [text];
}

function wordOps(a: string[], b: string[]): LineOp[] {
  if (a.length * b.length > 80_000) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  return diffLines(a, b);
}

export function intraLineHighlights(left: string, right: string): {
  leftToks: MergeHlTok[];
  rightToks: MergeHlTok[];
} {
  if (left === right) {
    return {
      leftToks: [{ kind: "eq", text: left }],
      rightToks: [{ kind: "eq", text: right }],
    };
  }
  if (left.length > WORD_LINE_CAP || right.length > WORD_LINE_CAP) {
    return {
      leftToks: [{ kind: "mark", text: left }],
      rightToks: [{ kind: "mark", text: right }],
    };
  }
  const ops = wordOps(tokenizeWords(left), tokenizeWords(right));
  const leftToks: MergeHlTok[] = [];
  const rightToks: MergeHlTok[] = [];
  for (const op of ops) {
    if (op.type === "eq") {
      leftToks.push({ kind: "eq", text: op.text });
      rightToks.push({ kind: "eq", text: op.text });
    } else if (op.type === "del") {
      leftToks.push({ kind: "mark", text: op.text });
    } else {
      rightToks.push({ kind: "mark", text: op.text });
    }
  }
  return { leftToks, rightToks };
}

function alignRows(ops: LineOp[]): MergeDiffRow[] {
  const rows: MergeDiffRow[] = [];
  let leftNo = 1;
  let rightNo = 1;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.type === "eq") {
      rows.push({ type: "eq", left: op.text, right: op.text, leftNo, rightNo });
      leftNo += 1;
      rightNo += 1;
      i += 1;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i]!.type === "del") {
      dels.push(ops[i]!.text);
      i += 1;
    }
    while (i < ops.length && ops[i]!.type === "add") {
      adds.push(ops[i]!.text);
      i += 1;
    }
    const paired = Math.min(dels.length, adds.length);
    for (let k = 0; k < paired; k += 1) {
      const left = dels[k]!;
      const right = adds[k]!;
      const { leftToks, rightToks } = intraLineHighlights(left, right);
      rows.push({ type: "change", left, right, leftNo, rightNo, leftToks, rightToks });
      leftNo += 1;
      rightNo += 1;
    }
    for (let k = paired; k < dels.length; k += 1) {
      rows.push({ type: "del", left: dels[k]!, leftNo });
      leftNo += 1;
    }
    for (let k = paired; k < adds.length; k += 1) {
      rows.push({ type: "add", right: adds[k]!, rightNo });
      rightNo += 1;
    }
  }
  return rows;
}

/** Keep `context` unchanged lines around each edit; fold the rest into a gap. */
export function collapseUnchanged(rows: MergeDiffRow[], context = MERGE_CONTEXT_LINES): MergeDisplayRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i]!.type === "eq") continue;
    keep[i] = true;
    for (let k = 1; k <= context; k += 1) {
      if (i - k >= 0) keep[i - k] = true;
      if (i + k < rows.length) keep[i + k] = true;
    }
  }
  if (rows.length > 0 && rows.every((r) => r.type === "eq")) {
    const head = Math.min(rows.length, context * 2);
    for (let i = 0; i < head; i += 1) keep[i] = true;
  }
  const out: MergeDisplayRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i]!);
      i += 1;
      continue;
    }
    const start = i;
    while (i < rows.length && !keep[i]) i += 1;
    out.push({ type: "gap", skipped: i - start, rows: rows.slice(start, i) });
  }
  return out;
}

export function buildMergeCompare(
  ours: string | null,
  theirs: string | null,
  opts?: { context?: number },
): MergeDisplayRow[] {
  const left = splitMergeLines(ours ?? "");
  const right = splitMergeLines(theirs ?? "");
  const rows = alignRows(diffLines(left, right));
  return collapseUnchanged(rows, opts?.context ?? MERGE_CONTEXT_LINES);
}

export function mergeCompareStats(rows: MergeDisplayRow[]): { changes: number; gaps: number } {
  let changes = 0;
  let gaps = 0;
  for (const row of rows) {
    if (row.type === "gap") gaps += 1;
    else if (row.type !== "eq") changes += 1;
  }
  return { changes, gaps };
}
