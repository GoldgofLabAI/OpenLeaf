/**
 * Cursor-style surgical text edits: unique search-replace, inclusive line
 * spans, unified-diff apply, and review hunks (Myers line diff).
 */

export type LineKind = "context" | "add" | "del";

export type PatchLine = { kind: LineKind; text: string };

export type TextHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PatchLine[];
};

export type FilePatch = {
  path: string;
  oldPath?: string;
  deleted?: boolean;
  created?: boolean;
  hunks: TextHunk[];
};

export class PatchError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function hasCrlf(text: string): boolean {
  return text.includes("\r\n");
}

export function toCrlf(text: string): string {
  return normalizeLf(text).replace(/\n/g, "\r\n");
}

export function toLines(text: string): { lines: string[]; eofNl: boolean } {
  if (text === "") return { lines: [], eofNl: false };
  const eofNl = text.endsWith("\n");
  const body = eofNl ? text.slice(0, -1) : text;
  return { lines: body.length === 0 ? [""] : body.split("\n"), eofNl };
}

export function fromLines(lines: string[], eofNl: boolean): string {
  if (lines.length === 0) return eofNl ? "\n" : "";
  return lines.join("\n") + (eofNl ? "\n" : "");
}

export function sliceLines(
  text: string,
  from?: number,
  to?: number,
): { content: string; from: number; to: number; totalLines: number; truncated: boolean } {
  const { lines, eofNl } = toLines(text);
  const totalLines = lines.length;
  const start = from == null || Number.isNaN(from) ? 1 : Math.max(1, Math.floor(from));
  const end = to == null || Number.isNaN(to) ? totalLines : Math.max(0, Math.floor(to));
  if (totalLines === 0) {
    return { content: "", from: 1, to: 0, totalLines: 0, truncated: false };
  }
  const lo = Math.min(start, totalLines);
  const hi = Math.min(Math.max(end, lo - 1), totalLines);
  const slice = lines.slice(lo - 1, hi);
  const content = slice.join("\n") + (hi === totalLines && eofNl && slice.length > 0 ? "\n" : "");
  return {
    content,
    from: lo,
    to: hi,
    totalLines,
    truncated: lo > 1 || hi < totalLines,
  };
}

/** Non-overlapping occurrences, same rule as String.replaceAll. */
export function countSubstrings(haystack: string, needle: string): number {
  if (needle === "") return haystack === "" ? 1 : 0;
  let n = 0;
  let i = 0;
  while (i <= haystack.length) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) break;
    n += 1;
    i = j + Math.max(needle.length, 1);
  }
  return n;
}

export function replaceUnique(haystack: string, oldStr: string, newStr: string): string {
  if (oldStr === "") {
    if (haystack !== "") {
      throw new PatchError(
        400,
        "Empty old text is only allowed when the file is missing or empty (create)",
        "EMPTY_OLD",
      );
    }
    return newStr;
  }
  const count = countSubstrings(haystack, oldStr);
  if (count === 0) {
    throw new PatchError(400, "old text not found in file", "NOT_FOUND");
  }
  if (count > 1) {
    throw new PatchError(
      409,
      `old text is not unique (${count} matches). Pass replace_all=true or include more context`,
      "NOT_UNIQUE",
      { count },
    );
  }
  const i = haystack.indexOf(oldStr);
  return haystack.slice(0, i) + newStr + haystack.slice(i + oldStr.length);
}

export function replaceAllSubstrings(haystack: string, oldStr: string, newStr: string): {
  text: string;
  count: number;
} {
  if (oldStr === "") {
    throw new PatchError(400, "replace_all requires a non-empty old string", "EMPTY_OLD");
  }
  const count = countSubstrings(haystack, oldStr);
  if (count === 0) {
    throw new PatchError(400, "old text not found in file", "NOT_FOUND");
  }
  return { text: haystack.split(oldStr).join(newStr), count };
}

/**
 * Replace an inclusive 1-indexed line span.
 * `endLine === startLine - 1` inserts `content` before `startLine`.
 */
export function replaceLineRange(
  text: string,
  startLine: number,
  endLine: number,
  content: string,
): string {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
    throw new PatchError(400, "startLine and endLine must be integers", "BAD_RANGE");
  }
  if (startLine < 1) {
    throw new PatchError(400, "startLine must be >= 1", "BAD_RANGE");
  }
  if (endLine < startLine - 1) {
    throw new PatchError(400, "endLine must be >= startLine - 1", "BAD_RANGE");
  }
  const { lines, eofNl } = toLines(text);
  if (startLine > lines.length + 1) {
    throw new PatchError(
      400,
      `startLine ${startLine} is past end of file (${lines.length} lines)`,
      "BAD_RANGE",
    );
  }
  if (endLine > lines.length) {
    throw new PatchError(
      400,
      `endLine ${endLine} is past end of file (${lines.length} lines)`,
      "BAD_RANGE",
    );
  }
  const startIdx = startLine - 1;
  const deleteCount = Math.max(0, endLine - startLine + 1);
  const { lines: insert, eofNl: insertEof } = content === "" ? { lines: [] as string[], eofNl: false } : toLines(content);
  const next = [...lines.slice(0, startIdx), ...insert, ...lines.slice(startIdx + deleteCount)];
  const replacedThroughEof = startIdx + deleteCount >= lines.length;
  const nextEof = replacedThroughEof ? (content === "" ? false : insertEof || content.endsWith("\n")) : eofNl;
  return fromLines(next, next.length === 0 ? nextEof : nextEof);
}

export type LineOp = { type: "eq" | "del" | "add"; text: string };

const MYERS_MIDDLE_CAP = 12_000;

/** Myers shortest-edit-script on tokens (typically lines). */
export function diffTokens(a: string[], b: string[]): LineOp[] {
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
  if (midA.length === 0 && midB.length === 0) return prefix;
  if (midA.length + midB.length > MYERS_MIDDLE_CAP) {
    return [
      ...prefix,
      ...midA.map((text) => ({ type: "del" as const, text })),
      ...midB.map((text) => ({ type: "add" as const, text })),
      ...suffix,
    ];
  }
  return [...prefix, ...myersTokens(midA, midB), ...suffix];
}

function myersTokens(a: string[], b: string[]): LineOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((text) => ({ type: "add" as const, text }));
  if (m === 0) return a.map((text) => ({ type: "del" as const, text }));

  const max = n + m;
  const v = new Map<number, number>();
  v.set(1, 0);
  const trace: Array<Map<number, number>> = [];
  let done = -1;

  outer: for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      const left = v.get(k - 1);
      const right = v.get(k + 1);
      if (k === -d || (k !== d && (left ?? Number.NEGATIVE_INFINITY) < (right ?? Number.NEGATIVE_INFINITY))) {
        x = right ?? 0;
      } else {
        x = (left ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        done = d;
        break outer;
      }
    }
  }
  if (done < 0) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }

  const ops: LineOp[] = [];
  let x = n;
  let y = m;
  for (let d = done; d > 0; d -= 1) {
    const prev = trace[d]!;
    const k = x - y;
    let prevK: number;
    const left = prev.get(k - 1);
    const right = prev.get(k + 1);
    if (k === -d || (k !== d && (left ?? Number.NEGATIVE_INFINITY) < (right ?? Number.NEGATIVE_INFINITY))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prev.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      ops.push({ type: "eq", text: a[x]! });
    }
    if (x === prevX) {
      y -= 1;
      ops.push({ type: "add", text: b[y]! });
    } else {
      x -= 1;
      ops.push({ type: "del", text: a[x]! });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    ops.push({ type: "eq", text: a[x]! });
  }
  while (x > 0) {
    x -= 1;
    ops.push({ type: "del", text: a[x]! });
  }
  while (y > 0) {
    y -= 1;
    ops.push({ type: "add", text: b[y]! });
  }
  ops.reverse();
  return ops;
}

export function hunksFromOps(ops: LineOp[], context = 3): TextHunk[] {
  const changeIdx: number[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i]!.type !== "eq") changeIdx.push(i);
  }
  if (changeIdx.length === 0) return [];

  const groups: Array<{ lo: number; hi: number }> = [];
  let lo = Math.max(0, changeIdx[0]! - context);
  let hi = Math.min(ops.length - 1, changeIdx[0]! + context);
  for (let i = 1; i < changeIdx.length; i += 1) {
    const c = changeIdx[i]!;
    if (c - context <= hi + 1) {
      hi = Math.min(ops.length - 1, c + context);
    } else {
      groups.push({ lo, hi });
      lo = Math.max(0, c - context);
      hi = Math.min(ops.length - 1, c + context);
    }
  }
  groups.push({ lo, hi });

  const hunks: TextHunk[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  let opIdx = 0;
  for (const g of groups) {
    while (opIdx < g.lo) {
      const op = ops[opIdx]!;
      if (op.type !== "add") oldCursor += 1;
      if (op.type !== "del") newCursor += 1;
      opIdx += 1;
    }
    const lines: PatchLine[] = [];
    let oldLines = 0;
    let newLines = 0;
    const oldStart = oldCursor;
    const newStart = newCursor;
    while (opIdx <= g.hi) {
      const op = ops[opIdx]!;
      if (op.type === "eq") {
        lines.push({ kind: "context", text: op.text });
        oldLines += 1;
        newLines += 1;
        oldCursor += 1;
        newCursor += 1;
      } else if (op.type === "del") {
        lines.push({ kind: "del", text: op.text });
        oldLines += 1;
        oldCursor += 1;
      } else {
        lines.push({ kind: "add", text: op.text });
        newLines += 1;
        newCursor += 1;
      }
      opIdx += 1;
    }
    hunks.push({ oldStart, oldLines, newStart, newLines, lines });
  }
  return hunks;
}

export function computeHunks(oldText: string, newText: string, context = 3): TextHunk[] {
  const a = toLines(oldText).lines;
  const b = toLines(newText).lines;
  return hunksFromOps(diffTokens(a, b), context);
}

export function hunkAdditions(h: TextHunk): number {
  return h.lines.filter((l) => l.kind === "add").length;
}

export function hunkDeletions(h: TextHunk): number {
  return h.lines.filter((l) => l.kind === "del").length;
}

export function oldSide(h: TextHunk): string[] {
  return h.lines.filter((l) => l.kind !== "add").map((l) => l.text);
}

export function newSide(h: TextHunk): string[] {
  return h.lines.filter((l) => l.kind !== "del").map((l) => l.text);
}

export type InlineToken = { kind: "eq" | "add" | "del"; text: string };

export type InlineRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

/** Words, whitespace, LaTeX commands, and punctuation — for Grammarly-style phrasing. */
export function tokenizeInline(text: string): string[] {
  if (text === "") return [];
  return text.match(/\\[A-Za-z]+\*?|[\p{L}\p{N}_]+|\s+|./gu) ?? [text];
}

export function inlineDiff(oldText: string, newText: string): InlineToken[] {
  return diffTokens(tokenizeInline(oldText), tokenizeInline(newText)).map((op) => ({
    kind: op.type === "eq" ? "eq" : op.type === "add" ? "add" : "del",
    text: op.text,
  }));
}

export function condenseInline(tokens: InlineToken[], maxEqChars = 36): InlineToken[] {
  const out: InlineToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.kind !== "eq") {
      out.push(t);
      continue;
    }
    const prevChange = i > 0 && tokens[i - 1]!.kind !== "eq";
    const nextChange = i < tokens.length - 1 && tokens[i + 1]!.kind !== "eq";
    if (!prevChange && !nextChange) continue;
    let text = t.text.replace(/\s+/g, " ");
    if (text.length > maxEqChars) {
      if (!prevChange && nextChange) text = `…${text.slice(-maxEqChars)}`;
      else if (prevChange && !nextChange) text = `${text.slice(0, maxEqChars)}…`;
      else {
        const half = Math.max(8, Math.floor(maxEqChars / 2));
        text = `${text.slice(0, half)}…${text.slice(-half)}`;
      }
    }
    if (!text) continue;
    out.push({ kind: "eq", text });
  }
  return out;
}

export function phraseFrom(tokens: InlineToken[], kind: "add" | "del"): string {
  return tokens
    .filter((t) => t.kind === kind)
    .map((t) => t.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Highlight ranges on the NEW file (1-based, Monaco-style exclusive end column). */
export function hunkNewRanges(h: TextHunk): InlineRange[] {
  const tokens = inlineDiff(oldSide(h).join("\n"), newSide(h).join("\n"));
  let line = Math.max(1, h.newStart);
  let col = 1;
  const ranges: InlineRange[] = [];
  let run: InlineRange | null = null;
  const flush = () => {
    if (run && (run.endLine !== run.startLine || run.endColumn > run.startColumn)) {
      ranges.push(run);
    }
    run = null;
  };
  const extend = (startLine: number, startCol: number, endLine: number, endCol: number) => {
    if (run && run.endLine === startLine && run.endColumn === startCol) {
      run.endLine = endLine;
      run.endColumn = endCol;
      return;
    }
    flush();
    run = { startLine, startColumn: startCol, endLine, endColumn: endCol };
  };

  for (const t of tokens) {
    if (t.kind === "del") {
      flush();
      continue;
    }
    const parts = t.text.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      const piece = parts[i]!;
      if (t.kind === "add" && piece.length > 0) {
        const startLine = line;
        const startCol = col;
        col += piece.length;
        extend(startLine, startCol, line, col);
      } else {
        flush();
        col += piece.length;
      }
      if (i < parts.length - 1) {
        flush();
        line += 1;
        col = 1;
      }
    }
  }
  flush();
  return ranges;
}

function findUniqueBlock(lines: string[], block: string[], hint: number): number {
  if (block.length === 0) {
    const idx = Math.max(0, Math.min(hint, lines.length));
    return idx;
  }
  const matches: number[] = [];
  const start = Math.max(0, hint);
  const order: number[] = [start];
  for (let d = 1; d < lines.length; d += 1) {
    if (start - d >= 0) order.push(start - d);
    if (start + d < lines.length) order.push(start + d);
  }
  if (!order.includes(0) && lines.length === 0) order.push(0);

  const tryAt = (i: number): boolean => {
    if (i < 0 || i + block.length > lines.length) return false;
    for (let k = 0; k < block.length; k += 1) {
      if (lines[i + k] !== block[k]) return false;
    }
    return true;
  };

  for (const i of order) {
    if (tryAt(i) && !matches.includes(i)) matches.push(i);
    if (matches.length > 1) break;
  }
  if (matches.length === 0) {
    for (let i = 0; i <= lines.length - block.length; i += 1) {
      if (tryAt(i)) matches.push(i);
      if (matches.length > 1) break;
    }
  }
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new PatchError(409, "Patch context does not match the current file", "CONTEXT_MISMATCH");
  }
  throw new PatchError(
    409,
    "Patch context matches more than once; add more unique context",
    "CONTEXT_AMBIGUOUS",
    { count: matches.length },
  );
}

function applyOne(lines: string[], hunk: TextHunk, reverse: boolean): string[] {
  const src = reverse ? newSide(hunk) : oldSide(hunk);
  const dest = reverse ? oldSide(hunk) : newSide(hunk);
  const hint = (reverse ? hunk.newStart : hunk.oldStart) - 1;
  const at = findUniqueBlock(lines, src, Math.max(0, hint));
  return [...lines.slice(0, at), ...dest, ...lines.slice(at + src.length)];
}

export function applyHunks(text: string, hunks: TextHunk[], reverse = false): string {
  if (hunks.length === 0) return text;
  const { lines, eofNl } = toLines(text);
  const ordered = [...hunks].sort((a, b) =>
    reverse ? b.newStart - a.newStart : b.oldStart - a.oldStart,
  );
  let next = lines;
  for (const h of ordered) {
    next = applyOne(next, h, reverse);
  }
  // New files (empty old text) get a trailing newline — POSIX / git apply.
  const nextEof = next.length === 0 ? false : lines.length === 0 ? true : eofNl;
  return fromLines(next, nextEof);
}

/** If two texts differ only by a final newline, prefer `sample`'s convention. */
export function alignEof(text: string, sample: string): string {
  if (text === "") return text;
  const want = sample.endsWith("\n");
  const has = text.endsWith("\n");
  if (want === has) return text;
  return want ? `${text}\n` : text.replace(/\n$/, "");
}

export function applySingleHunk(text: string, hunk: TextHunk, reverse = false): string {
  return applyHunks(text, [hunk], reverse);
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkLineCounts(h: TextHunk): { oldC: number; newC: number } {
  let oldC = 0;
  let newC = 0;
  for (const l of h.lines) {
    if (l.kind !== "add") oldC += 1;
    if (l.kind !== "del") newC += 1;
  }
  return { oldC, newC };
}

function hunkFilled(h: TextHunk): boolean {
  const { oldC, newC } = hunkLineCounts(h);
  return oldC >= h.oldLines && newC >= h.newLines;
}

export function parseUnifiedDiff(diff: string): FilePatch[] {
  const raw = diff.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!raw.trim()) throw new PatchError(400, "Empty diff", "BAD_DIFF");
  const lines = raw.split("\n");
  const files: FilePatch[] = [];
  let cur: FilePatch | null = null;
  let hunk: TextHunk | null = null;
  let pendingGitNew: string | null = null;
  let pendingGitOld: string | null = null;

  const flushHunk = () => {
    if (hunk && cur) {
      cur.hunks.push(hunk);
      hunk = null;
    }
  };

  const stripPrefix = (p: string): string => {
    if (p === "/dev/null") return "";
    return p.replace(/^[ab]\//, "").replace(/^\/+/, "");
  };

  const pushHunkLine = (line: string) => {
    if (!hunk) return;
    if (line.startsWith("\\")) return;
    // Trailing newline of the patch file is not a context line. Real empty
    // context is a single space, and empty add/del is "+" / "-".
    if (line === "") return;
    const sig = line.charAt(0);
    const text = sig === " " || sig === "+" || sig === "-" ? line.slice(1) : line;
    if (sig === "+") hunk.lines.push({ kind: "add", text });
    else if (sig === "-") hunk.lines.push({ kind: "del", text });
    else hunk.lines.push({ kind: "context", text });
    if (hunkFilled(hunk)) flushHunk();
  };

  for (const line of lines) {
    // A hunk that already has its declared line counts is done. Flush before
    // treating `---` / `+++` as the next file — otherwise an added line that
    // starts with `++ ` (`+++ foo` in the patch) is parsed as a file header.
    if (hunk && hunkFilled(hunk)) flushHunk();
    if (hunk && !hunkFilled(hunk)) {
      pushHunkLine(line);
      continue;
    }
    if (line.startsWith("diff --git ")) {
      flushHunk();
      cur = null;
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      pendingGitOld = m ? m[1] : null;
      pendingGitNew = m ? m[2] : null;
      continue;
    }
    if (line.startsWith("--- ")) {
      flushHunk();
      const rest = line.slice(4).trim();
      const oldPath = rest.split("\t")[0] ?? rest;
      const stripped = stripPrefix(oldPath);
      cur = {
        path: stripped,
        oldPath: stripped || pendingGitOld || "",
        created: oldPath === "/dev/null",
        hunks: [],
      };
      files.push(cur);
      continue;
    }
    if (line.startsWith("+++ ")) {
      const rest = line.slice(4).trim();
      const newPath = rest.split("\t")[0] ?? rest;
      const stripped = stripPrefix(newPath);
      if (!cur) {
        cur = { path: stripped, hunks: [] };
        files.push(cur);
      }
      if (newPath === "/dev/null") {
        cur.deleted = true;
        cur.path = cur.oldPath || cur.path;
      } else {
        cur.path = stripped || cur.path;
      }
      if (cur.created && stripped) cur.path = stripped;
      continue;
    }
    if (line.startsWith("@@")) {
      if (!cur) {
        if (pendingGitNew) {
          cur = { path: pendingGitNew, oldPath: pendingGitOld ?? pendingGitNew, hunks: [] };
          files.push(cur);
        } else {
          throw new PatchError(400, "Hunk without a file header", "BAD_DIFF");
        }
      }
      flushHunk();
      const m = line.match(HUNK_RE);
      if (!m) throw new PatchError(400, `Malformed hunk header: ${line}`, "BAD_DIFF");
      hunk = {
        oldStart: Number(m[1]),
        oldLines: m[2] == null ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] == null ? 1 : Number(m[4]),
        lines: [],
      };
      if (hunkFilled(hunk)) flushHunk();
      continue;
    }
  }
  flushHunk();
  if (files.length === 0) throw new PatchError(400, "Diff contained no file hunks", "BAD_DIFF");
  for (const f of files) {
    if (!f.path) throw new PatchError(400, "Diff file path missing", "BAD_DIFF");
  }
  return files;
}

export function formatUnifiedDiff(path: string, oldText: string, newText: string, context = 3): string {
  const hunks = computeHunks(oldText, newText, context);
  if (hunks.length === 0) return "";
  const created = oldText === "" && newText !== "";
  const deleted = newText === "" && oldText !== "";
  const lines = [
    `diff --git a/${path} b/${path}`,
    created ? "--- /dev/null" : `--- a/${path}`,
    deleted ? "+++ /dev/null" : `+++ b/${path}`,
  ];
  for (const h of hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      const p = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
      lines.push(p + l.text);
    }
  }
  return lines.join("\n") + "\n";
}

export function applyFilePatch(oldText: string | null, file: FilePatch): string | null {
  if (file.deleted) return null;
  const base = oldText ?? "";
  if (file.created && base !== "") {
    throw new PatchError(409, `Cannot create ${file.path}: file already exists`, "EXISTS");
  }
  if (file.hunks.length === 0) {
    return file.created ? "" : base;
  }
  return applyHunks(base, file.hunks, false);
}

/** Apply several patches to the same path in order (concatenated diffs). */
export function applyFilePatches(oldText: string | null, files: FilePatch[]): string | null {
  let cur = oldText;
  for (const file of files) {
    cur = applyFilePatch(cur, file);
  }
  return cur;
}

export function hashHunk(path: string, h: TextHunk): string {
  const payload = `${path}:${h.oldStart}:${h.newStart}:${h.lines.map((l) => `${l.kind[0]}${l.text}`).join("\n")}`;
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
