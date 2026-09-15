export type TimelineEscapeState = {
  deleteOpen: boolean;
  forkOpen: boolean;
  mergeDraft: boolean;
  dockOpen: boolean;
};

export type TimelineEscapeAction = "close-delete" | "close-fork" | "cancel-merge" | "dismiss-dock" | "close-panel";

/** Innermost timeline chrome first; a bare Escape closes the drawer. */
export function nextTimelineEscape(state: TimelineEscapeState): TimelineEscapeAction {
  if (state.deleteOpen) return "close-delete";
  if (state.forkOpen) return "close-fork";
  if (state.mergeDraft) return "cancel-merge";
  if (state.dockOpen) return "dismiss-dock";
  return "close-panel";
}
