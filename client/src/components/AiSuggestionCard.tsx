import { useCallback, useRef, type ReactNode } from "react";
import type { AiReviewHunk, AiReviewInline } from "../api/share";
import { previewFromHunk, type PreviewToken } from "./aiSuggestPreview";

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
  return [];
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

function renderGdocsTokens(tokens: PreviewToken[]): ReactNode {
  if (tokens.length === 0) {
    return <span className="ai-suggest-eq">Trailing newline change</span>;
  }
  return tokens.map((t, i) => (
    <span key={i} className={`ai-suggest-tok is-${t.kind}`}>
      {t.text}
    </span>
  ));
}

function renderPaneTokens(tokens: PreviewToken[], side: "before" | "after"): ReactNode {
  return tokens.map((t, i) => {
    const mark = t.kind !== "eq";
    return (
      <span key={i} className={mark ? `ai-suggest-hl is-${side}` : undefined}>
        {t.text}
      </span>
    );
  });
}

function SplitCompare({
  before,
  after,
  beforeTokens,
  afterTokens,
}: {
  before: string;
  after: string;
  beforeTokens: PreviewToken[] | null;
  afterTokens: PreviewToken[] | null;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);

  const sync = useCallback((from: "left" | "right") => {
    if (lock.current) return;
    const a = from === "left" ? leftRef.current : rightRef.current;
    const b = from === "left" ? rightRef.current : leftRef.current;
    if (!a || !b) return;
    const span = a.scrollHeight - a.clientHeight;
    const ratio = span <= 0 ? 0 : a.scrollTop / span;
    lock.current = true;
    const dest = b.scrollHeight - b.clientHeight;
    b.scrollTop = ratio * Math.max(0, dest);
    requestAnimationFrame(() => {
      lock.current = false;
    });
  }, []);

  return (
    <div className="ai-suggest-split">
      <section className="ai-suggest-pane is-before">
        <h3 className="ai-suggest-pane-label">Before</h3>
        <div
          ref={leftRef}
          className="ai-suggest-pane-body"
          onScroll={() => sync("left")}
        >
          {beforeTokens && beforeTokens.length > 0 ? (
            renderPaneTokens(beforeTokens, "before")
          ) : before ? (
            before
          ) : (
            <span className="ai-suggest-pane-empty">No previous text</span>
          )}
        </div>
      </section>
      <section className="ai-suggest-pane is-after">
        <h3 className="ai-suggest-pane-label">After</h3>
        <div
          ref={rightRef}
          className="ai-suggest-pane-body"
          onScroll={() => sync("right")}
        >
          {afterTokens && afterTokens.length > 0 ? (
            renderPaneTokens(afterTokens, "after")
          ) : after ? (
            after
          ) : (
            <span className="ai-suggest-pane-empty">No new text</span>
          )}
        </div>
      </section>
    </div>
  );
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
      className={`ai-suggest-card is-${preview.mode}${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}${nav ? " is-docked" : ""}`}
      data-hunk-id={hunk.id}
      data-preview-mode={preview.mode}
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
      {preview.mode === "suggest" ? (
        <p className="ai-suggest-copy is-gdocs">{renderGdocsTokens(preview.tokens)}</p>
      ) : (
        <SplitCompare
          before={preview.before}
          after={preview.after}
          beforeTokens={preview.beforeTokens}
          afterTokens={preview.afterTokens}
        />
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
