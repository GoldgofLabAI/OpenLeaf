import { useMemo, useState } from "react";
import {
  buildMergeCompare,
  mergeCompareStats,
  type MergeDisplayRow,
  type MergeHlTok,
} from "./mergeDiff";

type Props = {
  ours: string | null;
  theirs: string | null;
  oursLabel: string;
  theirsLabel: string;
};

function renderToks(toks: MergeHlTok[], side: "ours" | "theirs") {
  return toks.map((t, i) => (
    <span key={i} className={t.kind === "mark" ? `merge-hl is-${side}` : undefined}>
      {t.text}
    </span>
  ));
}

function cellText(text: string) {
  return text.length === 0 ? " " : text;
}

function DiffRowView({ row }: { row: Exclude<MergeDisplayRow, { type: "gap" }> }) {
  if (row.type === "eq") {
    return (
      <div className="merge-diff-row is-eq">
        <div className="merge-diff-gutter">{row.leftNo}</div>
        <div className="merge-diff-cell is-ours">{cellText(row.left)}</div>
        <div className="merge-diff-gutter">{row.rightNo}</div>
        <div className="merge-diff-cell is-theirs">{cellText(row.right)}</div>
      </div>
    );
  }
  if (row.type === "change") {
    return (
      <div className="merge-diff-row is-change">
        <div className="merge-diff-gutter is-ours">{row.leftNo}</div>
        <div className="merge-diff-cell is-ours is-mark">{renderToks(row.leftToks, "ours")}</div>
        <div className="merge-diff-gutter is-theirs">{row.rightNo}</div>
        <div className="merge-diff-cell is-theirs is-mark">{renderToks(row.rightToks, "theirs")}</div>
      </div>
    );
  }
  if (row.type === "del") {
    return (
      <div className="merge-diff-row is-del">
        <div className="merge-diff-gutter is-ours">{row.leftNo}</div>
        <div className="merge-diff-cell is-ours is-mark">{cellText(row.left)}</div>
        <div className="merge-diff-gutter" />
        <div className="merge-diff-cell is-theirs is-empty" />
      </div>
    );
  }
  return (
    <div className="merge-diff-row is-add">
      <div className="merge-diff-gutter" />
      <div className="merge-diff-cell is-ours is-empty" />
      <div className="merge-diff-gutter is-theirs">{row.rightNo}</div>
      <div className="merge-diff-cell is-theirs is-mark">{cellText(row.right)}</div>
    </div>
  );
}

export function MergeCompareView({ ours, theirs, oursLabel, theirsLabel }: Props) {
  const rows = useMemo(() => buildMergeCompare(ours, theirs), [ours, theirs]);
  const stats = useMemo(() => mergeCompareStats(rows), [rows]);
  const [openGaps, setOpenGaps] = useState<Set<number>>(() => new Set());

  const toggleGap = (idx: number) => {
    setOpenGaps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="merge-compare">
      <div className="merge-compare-head">
        <div className="merge-compare-pane-label is-ours">
          <span>Current</span>
          <em>{oursLabel}</em>
        </div>
        <div className="merge-compare-pane-label is-theirs">
          <span>Incoming</span>
          <em>{theirsLabel}</em>
        </div>
      </div>
      <div className="merge-diff-meta">
        {stats.changes === 0
          ? "No textual differences"
          : `${stats.changes} changed line${stats.changes === 1 ? "" : "s"} · word highlights on edited lines`}
      </div>
      <div className="merge-diff" role="table" aria-label="Current versus incoming">
        {rows.map((row, idx) => {
          if (row.type !== "gap") {
            return <DiffRowView key={idx} row={row} />;
          }
          if (openGaps.has(idx)) {
            return (
              <div key={idx} className="merge-diff-gap is-open">
                <button type="button" className="merge-diff-gap-btn" onClick={() => toggleGap(idx)}>
                  Hide {row.skipped} unchanged line{row.skipped === 1 ? "" : "s"}
                </button>
                {row.rows.map((inner, j) => (
                  <DiffRowView key={j} row={inner} />
                ))}
              </div>
            );
          }
          return (
            <button
              key={idx}
              type="button"
              className="merge-diff-gap-btn"
              onClick={() => toggleGap(idx)}
            >
              ··· {row.skipped} unchanged line{row.skipped === 1 ? "" : "s"} ···
            </button>
          );
        })}
      </div>
    </div>
  );
}
