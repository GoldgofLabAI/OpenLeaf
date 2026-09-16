/** Pixel movement before a timeline press becomes a pan (maps-style). */
export const TIMELINE_PAN_SLOP_PX = 10;
export const TIMELINE_ZOOM_MIN = 0.22;
export const TIMELINE_ZOOM_MAX = 2.8;
export const TIMELINE_ZOOM_STEP = 1.25;

export type TimelineCamera = { x: number; y: number; k: number };

export type TimelineLabelLod = "full" | "tips" | "minimal" | "graph";

export type TimelineLabelFlags = {
  showTickStem: boolean;
  showTickTime: boolean;
  showLabel: boolean;
  /** Head/branch chip vs commit whisper. */
  chip: boolean;
  /** Drop extra chip chrome when the view is tight. */
  sparse: boolean;
};

export function pastPanSlop(dx: number, dy: number, slop = TIMELINE_PAN_SLOP_PX): boolean {
  return dx * dx + dy * dy >= slop * slop;
}

export function clampZoom(k: number): number {
  if (!Number.isFinite(k)) return 1;
  return Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, k));
}

export function worldTransform({ x, y, k }: TimelineCamera): string {
  return `translate3d(${x}px, ${y}px, 0) scale(${k})`;
}

/** Keep the world point under (px, py) fixed while changing scale. */
export function zoomCameraAt(cam: TimelineCamera, px: number, py: number, factor: number): TimelineCamera {
  const k = clampZoom(cam.k * factor);
  const denom = cam.k || 1;
  const wx = (px - cam.x) / denom;
  const wy = (py - cam.y) / denom;
  return { x: px - wx * k, y: py - wy * k, k };
}

/** Two-finger pinch: the world point that started under the midpoint follows the live midpoint. */
export function pinchCamera(
  start: TimelineCamera,
  startDist: number,
  startMidX: number,
  startMidY: number,
  dist: number,
  midX: number,
  midY: number,
): TimelineCamera {
  const k = clampZoom(start.k * (dist / (startDist || 1)));
  const wx = (startMidX - start.x) / (start.k || 1);
  const wy = (startMidY - start.y) / (start.k || 1);
  return { x: midX - wx * k, y: midY - wy * k, k };
}

export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const dy = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY;
  return Math.exp(-dy * 0.0018);
}

export function timelineLabelLod(k: number): TimelineLabelLod {
  if (k < 0.34) return "graph";
  if (k < 0.55) return "minimal";
  if (k < 0.8) return "tips";
  return "full";
}

export function timelineLabelFlags(
  lod: TimelineLabelLod,
  n: {
    isHead: boolean;
    showTickStem: boolean;
    showTickTime: boolean;
    showLabel: boolean;
    labelMaxChars: number;
    selected?: boolean;
  },
): TimelineLabelFlags {
  if (lod === "graph") {
    return { showTickStem: false, showTickTime: false, showLabel: false, chip: false, sparse: true };
  }
  if (lod === "minimal") {
    const show = n.isHead || Boolean(n.selected);
    return { showTickStem: false, showTickTime: false, showLabel: show, chip: true, sparse: true };
  }
  if (lod === "tips") {
    const chip = n.showLabel && (n.isHead || n.labelMaxChars === 0);
    return {
      showTickStem: n.showTickStem || n.showTickTime,
      showTickTime: false,
      showLabel: chip,
      chip: true,
      sparse: true,
    };
  }
  return {
    showTickStem: n.showTickStem,
    showTickTime: n.showTickTime,
    showLabel: n.showLabel,
    chip: n.isHead || n.labelMaxChars === 0,
    sparse: false,
  };
}
