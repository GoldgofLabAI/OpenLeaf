import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { THEMES, useTheme, type ThemeId } from "../theme";

type Props = {
  className?: string;
  /** Compact trigger for tight chrome (toolbar / topbar). */
  compact?: boolean;
};

export function ThemePicker({ className = "", compact = false }: Props) {
  const { theme, definition, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [menuBox, setMenuBox] = useState<{ top: number; right: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null);
      return;
    }
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.bottom + 8;
      setMenuBox({
        top,
        right: Math.max(8, window.innerWidth - r.right),
        maxHeight: Math.max(220, window.innerHeight - top - 12),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const classic = THEMES.filter((t) => t.group === "classic");
  const signature = THEMES.filter((t) => t.group === "signature");

  const pick = (id: ThemeId) => {
    setTheme(id);
    setOpen(false);
  };

  return (
    <div className={`theme-picker${compact ? " is-compact" : ""} ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost theme-picker-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={`Theme: ${definition.name}`}
        title={`Theme · ${definition.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="theme-swatch" aria-hidden>
          {definition.swatches.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
        </span>
        {!compact && (
          <span className="theme-picker-label">
            <span className="theme-picker-name">{definition.name}</span>
            <span className="theme-picker-tag">{definition.tagline}</span>
          </span>
        )}
        <span className="theme-picker-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open &&
        menuBox &&
        createPortal(
          <div
            ref={menuRef}
            className="theme-picker-menu is-floating"
            id={listId}
            role="listbox"
            aria-label="Choose theme"
            style={{
              top: menuBox.top,
              right: menuBox.right,
              maxHeight: menuBox.maxHeight,
            }}
          >
            <div className="theme-picker-lede">
              <span className="theme-picker-lede-kicker">Atmosphere</span>
              <span className="theme-picker-lede-copy">Ten curated looks for long writing sessions</span>
            </div>
            <div className="theme-picker-section">
              <div className="theme-picker-heading">Classic</div>
              <div className="theme-picker-grid">
                {classic.map((t) => (
                  <ThemeOption
                    key={t.id}
                    id={t.id}
                    name={t.name}
                    tagline={t.tagline}
                    swatches={t.swatches}
                    selected={theme === t.id}
                    onSelect={pick}
                  />
                ))}
              </div>
            </div>
            <div className="theme-picker-section">
              <div className="theme-picker-heading">Signature</div>
              <div className="theme-picker-grid">
                {signature.map((t) => (
                  <ThemeOption
                    key={t.id}
                    id={t.id}
                    name={t.name}
                    tagline={t.tagline}
                    swatches={t.swatches}
                    selected={theme === t.id}
                    onSelect={pick}
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ThemeOption({
  id,
  name,
  tagline,
  swatches,
  selected,
  onSelect,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatches: [string, string, string];
  selected: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`theme-option${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(id)}
    >
      <span className="theme-option-preview" style={{ background: swatches[0] }} aria-hidden>
        <span className="theme-option-bar" style={{ background: swatches[1] }} />
        <span className="theme-option-line" style={{ background: swatches[2] }} />
        <span className="theme-option-line is-muted" style={{ background: swatches[2] }} />
      </span>
      <span className="theme-option-meta">
        <span className="theme-option-name">{name}</span>
        <span className="theme-option-tag">{tagline}</span>
      </span>
    </button>
  );
}

/** Back-compat alias — prefer ThemePicker. */
export function ThemeToggle(props: { className?: string; iconOnly?: boolean; compact?: boolean }) {
  return <ThemePicker className={props.className} compact={props.compact ?? props.iconOnly} />;
}
