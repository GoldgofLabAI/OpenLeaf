import type { AiReviewHunk, AiReviewInline } from "../api/share";
import { previewFromHunk } from "./aiSuggestPreview";

type Props = {
  hunk: AiReviewHunk;
  selected?: boolean;
  busy?: boolean;
  compact?: boolean;
  onSelect?: () => void;
  onAccept: () => void;
  onReject: () => void;
  nav?: {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
    onList?: () => void;
    onClose?: () => void;
  };
};

function fallbackInline(hunk: AiReviewHunk): AiReviewInline[] {
  if (hunk.inline?.length) return hunk.inline;
  const out: AiReviewInline[] = [];
  for (const line of hunk.lines) {
    if (line.kind === "context") out.push({ kind: "eq", text: `${line.text} ` });
    else if (line.kind === "del") out.push({ kind: "del", text: line.text });
    else out.push({ kind: "add", text: line.text });
  }
  return out;
}

function kindOf(hunk: AiReviewHunk): "replace" | "insert" | "delete" {
  if (hunk.kind) return hunk.kind;
  const before = hunk.phraseBefore ?? "";
  const after = hunk.phraseAfter ?? "";
  if (before && after) return "replace";
  if (after) return "insert";
  return "delete";
}

function verb(kind: "replace" | "insert" | "delete"): string {
  if (kind === "insert") return "Add";
  if (kind === "delete") return "Remove";
  return "Replace";
}

function renderTokens(tokens: AiReviewInline[]) {
  if (tokens.length === 0) {
    return <span className="ai-suggest-eq">Trailing newline change</span>;
  }
  return tokens.map((t, i) => (
    <span key={i} className={`ai-suggest-tok is-${t.kind}`}>
      {t.text}
    </span>
  ));
}

export function AiSuggestionCard({
  hunk,
  selected = false,
  busy = false,
  compact = false,
  onSelect,
  onAccept,
  onReject,
  nav,
}: Props) {
  const kind = kindOf(hunk);
  const preview = previewFromHunk({
    lines: hunk.lines,
    inline: fallbackInline(hunk),
  });
  const line = Math.max(1, hunk.newStart || hunk.oldStart || 1);

  return (
    <article
      className={`ai-suggest-card${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}${nav ? " is-docked" : ""}`}
      data-hunk-id={hunk.id}
      onClick={onSelect}
    >
      {nav && (
        <header className="ai-suggest-nav" onClick={(e) => e.stopPropagation()}>
          {nav.onClose && (
            <button type="button" className="btn btn-ghost btn-quiet" onClick={nav.onClose}>
              Done
            </button>
          )}
          <span className="ai-suggest-nav-count">
            {nav.index + 1} / {nav.total}
          </span>
          <span className="ai-suggest-nav-btns">
            <button type="button" className="btn btn-ghost" disabled={nav.index <= 0} onClick={nav.onPrev}>
              Prev
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={nav.index >= nav.total - 1}
              onClick={nav.onNext}
            >
              Next
            </button>
            {nav.onList && (
              <button type="button" className="btn btn-ghost" onClick={nav.onList}>
                List
              </button>
            )}
          </span>
        </header>
      )}
      {(!compact || nav) && (
        <header className="ai-suggest-card-meta">
          <span className="ai-suggest-verb">{verb(kind)}</span>
          <span className="ai-suggest-loc">
            {hunk.path}:{line}
          </span>
        </header>
      )}
      {preview.mode === "inline" ? (
        <p className="ai-suggest-copy">{renderTokens(preview.tokens)}</p>
      ) : (
        <div className="ai-suggest-compare">
          {preview.before ? (
            <figure className="ai-suggest-block is-del">
              <figcaption>Removed</figcaption>
              <pre>{preview.before}</pre>
            </figure>
          ) : null}
          {preview.after ? (
            <figure className="ai-suggest-block is-add">
              <figcaption>Added</figcaption>
              <pre>{preview.after}</pre>
            </figure>
          ) : null}
          {!preview.before && !preview.after ? (
            <p className="ai-suggest-copy">
              <span className="ai-suggest-eq">Trailing newline change</span>
            </p>
          ) : null}
        </div>
      )}
      <div className="ai-suggest-actions">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onReject();
          }}
        >
          Dismiss
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onAccept();
          }}
        >
          Accept
        </button>
      </div>
    </article>
  );
}
