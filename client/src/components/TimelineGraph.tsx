import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { BranchLeafStat } from "../api/client";
import type { TimelineBranch, TimelineNode, TimelineView } from "../api/types";
import {
  aiBranchLabel,
  emptyTimelineLayout,
  formatTickTime,
  layoutTimeline,
  mergePreviewGeometry,
  shortMsg,
  threadPathInset,
  type TimelineLayoutNode,
} from "./timelineLayout";
import {
  pastPanSlop,
  pinchCamera,
  timelineLabelFlags,
  timelineLabelLod,
  TIMELINE_ZOOM_STEP,
  wheelZoomFactor,
  worldTransform,
  zoomCameraAt,
  type TimelineCamera,
  type TimelineLabelLod,
} from "./timelinePan";

type SafariGestureEvent = Event & { scale: number; clientX: number; clientY: number };

const DEFAULT_CAM: TimelineCamera = { x: 36, y: 24, k: 1 };

type Props = {
  view: TimelineView | null;
  loading?: boolean;
  compact?: boolean;
  busy?: boolean;
  /** Currently active / selected leaf id. */
  selectedId?: string | null;
  /** Hover highlight id (viewer). */
  hotId?: string | null;
  leafByBranch?: Map<string, BranchLeafStat>;
  className?: string;
  emptyLabel?: string;
  onNodeClick: (node: TimelineNode, branch: TimelineBranch, layout: TimelineLayoutNode) => void;
  /** When set, orbs emit hover enter/leave (viewer). Omit for click-only pickers. */
  onHoverIdChange?: (id: string | null) => void;
  /** Overlay inside the surface (e.g. hover dock). */
  children?: ReactNode;
  /** Recenter when this bumps (e.g. after load). */
  recenterToken?: number | string;
  /** Compose a merge: highlight from/into tips and draw a blinking post-merge preview. */
  merging?: boolean;
  mergeFromId?: string | null;
  mergeIntoId?: string | null;
};

export function TimelineGraph({
  view,
  loading = false,
  compact = false,
  busy = false,
  selectedId = null,
  hotId = null,
  leafByBranch,
  className = "",
  emptyLabel = "No leaves yet — Commit to light the first thread.",
  onNodeClick,
  onHoverIdChange,
  children,
  recenterToken,
  merging = false,
  mergeFromId = null,
  mergeIntoId = null,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `tl-sacred-grad-${uid}`;
  const glowId = `tl-glow-${uid}`;
  const mergeArrowId = `tl-merge-arrow-${uid}`;

  const surfaceRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  const camRef = useRef<TimelineCamera>({ ...DEFAULT_CAM });
  const pendingCam = useRef<TimelineCamera | null>(null);
  const rafRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const hoverClearRef = useRef<number | null>(null);
  const lodRef = useRef<TimelineLabelLod>("full");
  const [lod, setLod] = useState<TimelineLabelLod>("full");

  const layout = useMemo(
    () =>
      view
        ? layoutTimeline(view, { compact })
        : emptyTimelineLayout(compact),
    [view, compact],
  );

  const preview = useMemo(
    () =>
      mergeFromId && mergeIntoId
        ? mergePreviewGeometry(layout.nodes, mergeFromId, mergeIntoId, compact)
        : null,
    [layout.nodes, mergeFromId, mergeIntoId, compact],
  );

  const worldW = Math.max(layout.width, preview ? preview.ghostX + (compact ? 64 : 88) : 0);
  const worldH = layout.height;

  const recenter = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const y = Math.round(el.clientHeight / 2 - layout.originY);
    let x = 36;
    if (layout.nodes.length > 0) {
      const xs = layout.nodes.map((n) => n.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const pad = compact ? 20 : 32;
      const span = maxX - minX;
      // Prefer showing the whole chain when it fits; otherwise pin the tip in view
      // without shoving older leaves unnecessarily far off-screen.
      if (span + pad * 2 <= el.clientWidth) {
        x = Math.round((el.clientWidth - span) / 2 - minX);
      } else {
        const focus =
          layout.nodes.find((l) => l.node.id === selectedId) ??
          layout.nodes.find((l) => l.isHead && l.isSacred) ??
          layout.nodes[layout.nodes.length - 1];
        x = Math.round(el.clientWidth * (compact ? 0.78 : 0.72) - (focus?.x ?? maxX));
        const leftEdge = minX + x;
        if (leftEdge > pad) x = pad - minX;
      }
    }
    const next: TimelineCamera = { x, y, k: 1 };
    camRef.current = next;
    pendingCam.current = next;
    lodRef.current = "full";
    setLod("full");
    if (worldRef.current) {
      worldRef.current.style.transform = worldTransform(next);
    }
  }, [layout, selectedId, compact]);

  useEffect(() => {
    if (loading && layout.nodes.length === 0) return;
    requestAnimationFrame(() => recenter());
  }, [recenterToken, layout.nodes.length, loading, recenter]);

  useEffect(() => {
    return () => {
      if (hoverClearRef.current != null) window.clearTimeout(hoverClearRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (worldRef.current) {
      worldRef.current.style.transform = worldTransform(camRef.current);
    }
  });

  const keepHover = useCallback(
    (id: string) => {
      if (!onHoverIdChange) return;
      if (hoverClearRef.current != null) {
        window.clearTimeout(hoverClearRef.current);
        hoverClearRef.current = null;
      }
      onHoverIdChange(id);
    },
    [onHoverIdChange],
  );

  const clearHoverSoon = useCallback(() => {
    if (!onHoverIdChange) return;
    if (hoverClearRef.current != null) window.clearTimeout(hoverClearRef.current);
    // Long enough to travel from an orb to the bottom dock; never clear while the dock is in use.
    hoverClearRef.current = window.setTimeout(() => {
      const surface = surfaceRef.current;
      if (
        surface?.querySelector(".tl-hover-dock:hover, .tl-hover-dock:focus-within, .tl-orb:hover")
      ) {
        hoverClearRef.current = null;
        return;
      }
      onHoverIdChange(null);
      hoverClearRef.current = null;
    }, 400);
  }, [onHoverIdChange]);

  const applyCamera = (next: TimelineCamera) => {
    camRef.current = next;
    pendingCam.current = next;
    const nextLod = timelineLabelLod(next.k);
    if (nextLod !== lodRef.current) {
      lodRef.current = nextLod;
      setLod(nextLod);
    }
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const queued = pendingCam.current ?? camRef.current;
      if (worldRef.current) {
        worldRef.current.style.transform = worldTransform(queued);
      }
    });
  };

  const zoomBy = (factor: number, origin?: { x: number; y: number }) => {
    const el = surfaceRef.current;
    const px = origin?.x ?? (el ? el.clientWidth / 2 : 0);
    const py = origin?.y ?? (el ? el.clientHeight / 2 : 0);
    applyCamera(zoomCameraAt(camRef.current, px, py, factor));
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const pointers = new Map<number, { id: number; cx: number; cy: number }>();
    const pinch = {
      active: false,
      dist0: 1,
      midX: 0,
      midY: 0,
      cam: { ...DEFAULT_CAM },
    };
    const gesture = { active: false, x: 0, y: 0, cam: { ...DEFAULT_CAM } };
    let listening = false;

    const ignoreTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          // Orbs must not start a surface pan/capture — that steals the click
          // and makes timeline leaves feel dead.
          ".tl-orb, .tl-hover-dock, .share-pick-prompt, .tl-fork-modal, .tl-zoom-ctrl, input, textarea",
        ),
      );

    const surfacePoint = (clientX: number, clientY: number) => {
      const r = surface.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const pairMetrics = () => {
      const pts = [...pointers.values()];
      if (pts.length < 2) return null;
      const a = pts[0];
      const b = pts[1];
      const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy) || 1;
      const mid = surfacePoint((a.cx + b.cx) / 2, (a.cy + b.cy) / 2);
      return { dist, mid };
    };

    const beginPinch = () => {
      const m = pairMetrics();
      if (!m) return;
      pinch.active = true;
      pinch.dist0 = m.dist;
      pinch.midX = m.mid.x;
      pinch.midY = m.mid.y;
      pinch.cam = { ...camRef.current };
      drag.current = null;
      suppressClickRef.current = true;
      surface.classList.add("is-panning", "is-zooming");
    };

    const applyPinch = () => {
      const m = pairMetrics();
      if (!m || !pinch.active) return;
      applyCamera(
        pinchCamera(pinch.cam, pinch.dist0, pinch.midX, pinch.midY, m.dist, m.mid.x, m.mid.y),
      );
    };

    const endPinch = () => {
      pinch.active = false;
      surface.classList.remove("is-zooming");
    };

    const releasePointer = (id: number) => {
      if (surface.hasPointerCapture(id)) {
        try {
          surface.releasePointerCapture(id);
        } catch {
          /* already released */
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const tracked = pointers.get(e.pointerId);
      if (tracked) {
        tracked.cx = e.clientX;
        tracked.cy = e.clientY;
      }
      if (pinch.active && pointers.size >= 2) {
        e.preventDefault();
        applyPinch();
        return;
      }
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved) {
        if (!pastPanSlop(dx, dy)) return;
        d.moved = true;
        suppressClickRef.current = true;
        surface.classList.add("is-panning");
      }
      e.preventDefault();
      applyCamera({ x: d.px + dx, y: d.py + dy, k: camRef.current.k });
    };

    const onTouchMove = (e: TouchEvent) => {
      if (drag.current || pinch.active || pointers.size > 0) e.preventDefault();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) {
        const d = drag.current;
        if (d && d.id === e.pointerId) {
          drag.current = null;
          surface.classList.remove("is-panning");
        }
        return;
      }
      pointers.delete(e.pointerId);
      releasePointer(e.pointerId);
      if (pinch.active && pointers.size < 2) {
        endPinch();
        const leftover = pointers.values().next().value as { id: number; cx: number; cy: number } | undefined;
        if (leftover) {
          drag.current = {
            id: leftover.id,
            x: leftover.cx,
            y: leftover.cy,
            px: camRef.current.x,
            py: camRef.current.y,
            moved: true,
          };
          surface.classList.add("is-panning");
        } else {
          surface.classList.remove("is-panning");
        }
        e.preventDefault();
      } else {
        const d = drag.current;
        if (d && d.id === e.pointerId) {
          drag.current = null;
          if (!pinch.active) surface.classList.remove("is-panning");
          if (d.moved) e.preventDefault();
        }
      }
      if (pointers.size > 0 || !listening) return;
      listening = false;
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("touchmove", onTouchMove, true);
    };

    const ensureListen = () => {
      if (listening) return;
      listening = true;
      window.addEventListener("pointermove", onPointerMove, { passive: false, capture: true });
      window.addEventListener("pointerup", onPointerUp, { capture: true });
      window.addEventListener("pointercancel", onPointerUp, { capture: true });
      window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (ignoreTarget(e.target)) return;
      pointers.set(e.pointerId, { id: e.pointerId, cx: e.clientX, cy: e.clientY });
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* child button targets can refuse capture; window listeners still pan */
      }
      ensureListen();
      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      suppressClickRef.current = false;
      drag.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        px: camRef.current.x,
        py: camRef.current.y,
        moved: false,
      };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const pt = surfacePoint(e.clientX, e.clientY);
        applyCamera(zoomCameraAt(camRef.current, pt.x, pt.y, wheelZoomFactor(e.deltaY, e.deltaMode)));
        return;
      }
      applyCamera({
        x: camRef.current.x - e.deltaX,
        y: camRef.current.y - e.deltaY,
        k: camRef.current.k,
      });
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (pointers.size >= 2) return;
      const ge = e as SafariGestureEvent;
      const pt = surfacePoint(ge.clientX, ge.clientY);
      gesture.active = true;
      gesture.x = pt.x;
      gesture.y = pt.y;
      gesture.cam = { ...camRef.current };
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pointers.size >= 2 || !gesture.active) return;
      const ge = e as SafariGestureEvent;
      applyCamera(zoomCameraAt(gesture.cam, gesture.x, gesture.y, ge.scale));
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gesture.active = false;
    };

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("wheel", onWheel, { passive: false });
    surface.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    surface.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    surface.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("wheel", onWheel);
      surface.removeEventListener("gesturestart", onGestureStart as EventListener);
      surface.removeEventListener("gesturechange", onGestureChange as EventListener);
      surface.removeEventListener("gestureend", onGestureEnd as EventListener);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  return (
    <div
      className={`timeline-surface${compact ? " is-compact" : ""}${merging ? " is-merging" : ""}${className ? ` ${className}` : ""}`}
      data-lod={lod}
      ref={surfaceRef}
    >
      <div className="timeline-aura" aria-hidden />
      <div
        className="timeline-world"
        ref={worldRef}
        style={{ width: worldW, height: worldH }}
      >
        <div className="tl-spine is-horizontal" style={{ top: layout.originY, width: worldW }} aria-hidden />

        <svg className="timeline-edges" width={worldW} height={worldH}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--tl-sacred)" stopOpacity="0.15" />
              <stop offset="40%" stopColor="var(--tl-sacred)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--tl-sacred)" stopOpacity="0.35" />
            </linearGradient>
            <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.2" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <marker
              id={mergeArrowId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
              markerUnits="strokeWidth"
            >
              <path d="M 0 1.2 L 9 5 L 0 8.8 Z" fill="currentColor" className="tl-merge-arrow-head" />
            </marker>
          </defs>
          {layout.edges.map((e) => {
            const short = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < 110;
            // Glow filters use the path bbox; flat same-lane strokes get a ~0
            // height box and the blur can eat the entire stroke — skip glow there.
            const glow = !e.merge && (e.sacred || (e.ai && e.fork)) && !short;
            return (
              <path
                key={e.id}
                d={threadPathInset(e, e.merge ? 11 : 9)}
                className={[
                  "tl-thread",
                  e.merge ? "is-merge" : "",
                  !e.merge && e.sacred ? "is-sacred" : "",
                  !e.merge && e.ai ? "is-ai" : "",
                  !e.merge && e.fork ? "is-fork" : "",
                  !e.merge && short ? "is-short" : "",
                  e.merge && e.ai ? "is-ai-merge" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                fill="none"
                markerEnd={e.merge ? `url(#${mergeArrowId})` : undefined}
                filter={glow ? `url(#${glowId})` : undefined}
              />
            );
          })}
          {preview && (
            <>
              <path
                d={threadPathInset(preview.stem, 9)}
                className={`tl-thread is-pending is-stem${preview.target.isSacred ? " is-sacred" : preview.target.isAi ? " is-ai" : ""}`}
                fill="none"
              />
              <path
                d={threadPathInset(preview.merge, 11)}
                className={`tl-thread is-merge is-pending${preview.merge.ai ? " is-ai-merge" : ""}`}
                fill="none"
                markerEnd={`url(#${mergeArrowId})`}
              />
            </>
          )}
        </svg>

        {layout.nodes.map((l) => {
          const selected = l.node.id === selectedId;
          const hot = l.node.id === hotId;
          const from = l.node.id === mergeFromId;
          const into = l.node.id === mergeIntoId;
          const leaf = l.isHead ? leafByBranch?.get(l.branch.id) : undefined;
          const tickPad = 2 + l.tickTier * 14;
          const labelPad = 10 + l.labelTier * 20;
          const flags = timelineLabelFlags(lod, { ...l, selected });
          return (
            <button
              key={l.node.id}
              type="button"
              className={[
                "tl-orb",
                l.isSacred ? "is-sacred" : l.isAi ? "is-ai" : "is-branch",
                l.isHead ? "is-head" : "",
                selected ? "is-selected" : "",
                l.node.legacy ? "is-legacy" : "",
                hot ? "is-hot" : "",
                from ? "is-merge-from" : "",
                into ? "is-merge-into" : "",
                leaf?.dirty ? "is-dirty" : "",
                l.tickAbove ? "tick-above" : "tick-below",
                l.labelAbove ? "label-above" : "label-below",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                {
                  left: l.x,
                  top: l.y,
                  ["--tl-tick-pad" as string]: `${tickPad}px`,
                  ["--tl-label-pad" as string]: `${labelPad}px`,
                } as CSSProperties
              }
              disabled={busy}
              aria-label={`${l.isAi ? "AI sandbox " : ""}${l.branch.name}: ${l.node.message}`}
              onMouseEnter={onHoverIdChange ? () => keepHover(l.node.id) : undefined}
              onMouseLeave={onHoverIdChange ? clearHoverSoon : undefined}
              onFocus={onHoverIdChange ? () => keepHover(l.node.id) : undefined}
              onBlur={onHoverIdChange ? clearHoverSoon : undefined}
              onPointerDown={(e) => {
                // Keep the surface pan handler from capturing this gesture.
                e.stopPropagation();
              }}
              onClick={(e) => {
                if (suppressClickRef.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  suppressClickRef.current = false;
                  return;
                }
                onNodeClick(l.node, l.branch, l);
              }}
            >
              {(flags.showTickStem || flags.showTickTime) && (
                <span
                  className={`tl-tick${l.tickAbove ? " is-above" : " is-below"}${flags.showTickTime ? "" : " is-stem"}`}
                  aria-hidden
                >
                  <span className="tl-tick-line" />
                  {flags.showTickTime && (
                    <span className="tl-tick-time">{formatTickTime(l.node.createdAt)}</span>
                  )}
                </span>
              )}
              <span className="tl-orb-core" />
              <span className="tl-orb-ring" />
              {l.isHead && <span className="tl-orb-pulse" aria-hidden />}
              {flags.showLabel && (
                <span
                  className={`tl-orb-label${flags.chip ? " is-chip" : " is-whisper"}${l.labelAbove ? " is-above" : " is-below"}`}
                >
                  {flags.chip ? (
                    <>
                      {l.isAi && !flags.sparse && (
                        <span className="tl-ai-tag" aria-hidden>
                          AI
                        </span>
                      )}
                      <span className="tl-orb-branch">{l.isAi ? aiBranchLabel(l.branch.name) : l.branch.name}</span>
                      {leaf?.dirty ? (
                        <span className="tl-orb-dirty-dot" title="Uncommitted changes" />
                      ) : null}
                    </>
                  ) : (
                    <span className="tl-orb-whisper">{shortMsg(l.node.message, l.labelMaxChars)}</span>
                  )}
                </span>
              )}
            </button>
          );
        })}

        {preview && (
          <span
            className="tl-orb is-pending is-head is-branch"
            style={{ left: preview.ghostX, top: preview.ghostY }}
            aria-hidden
          >
            <span className="tl-orb-core" />
            <span className="tl-orb-ring" />
            {lod !== "graph" && (
              <span className="tl-orb-label is-chip is-below">
                <span className="tl-orb-branch">merge</span>
              </span>
            )}
          </span>
        )}

        {layout.nodes.length === 0 && !loading && (
          <div className="timeline-empty" style={{ left: layout.padLeft, top: layout.originY }}>
            {emptyLabel}
          </div>
        )}
        {loading && layout.nodes.length === 0 && (
          <div className="timeline-empty" style={{ left: layout.padLeft, top: layout.originY }}>
            Aligning the timeline…
          </div>
        )}
      </div>

      {children}

      <div className="tl-zoom-ctrl" role="group" aria-label="Timeline zoom">
        <button
          type="button"
          aria-label="Zoom in"
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoomBy(TIMELINE_ZOOM_STEP)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => zoomBy(1 / TIMELINE_ZOOM_STEP)}
        >
          −
        </button>
      </div>
    </div>
  );
}

export type { TimelineLayoutNode };
