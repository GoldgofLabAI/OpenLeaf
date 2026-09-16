import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMergeTipPick,
  mergeStartAllowed,
  type MergeDraft,
} from "../../../client/src/components/mergeCompose.ts";
import { nextTimelineEscape } from "../../../client/src/components/timelineEscape.ts";
import { layoutTimeline } from "../../../client/src/components/timelineLayout.ts";
import type { TimelineBranch, TimelineNode, TimelineView } from "../../../client/src/api/types.ts";
import {
  clampZoom,
  pastPanSlop,
  pinchCamera,
  timelineLabelFlags,
  timelineLabelLod,
  TIMELINE_PAN_SLOP_PX,
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
  wheelZoomFactor,
  zoomCameraAt,
} from "../../../client/src/components/timelinePan.ts";

describe("applyMergeTipPick", () => {
  it("advances to Into after choosing From when Into was prefilled", () => {
    const draft: MergeDraft = { filling: "from", fromBranchId: null, intoBranchId: "main" };
    const next = applyMergeTipPick(draft, "methods");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.draft.fromBranchId, "methods");
    assert.equal(next.draft.intoBranchId, "main");
    assert.equal(next.draft.filling, "into");
  });

  it("rejects picking the same tip as Into while filling From", () => {
    const draft: MergeDraft = { filling: "from", fromBranchId: null, intoBranchId: "main" };
    const next = applyMergeTipPick(draft, "main");
    assert.equal(next.ok, false);
  });

  it("lets a later tap replace Into", () => {
    const draft: MergeDraft = { filling: "into", fromBranchId: "methods", intoBranchId: "main" };
    const next = applyMergeTipPick(draft, "results");
    assert.equal(next.ok, true);
    if (!next.ok) return;
    assert.equal(next.draft.intoBranchId, "results");
    assert.equal(next.draft.fromBranchId, "methods");
    assert.equal(next.draft.filling, "into");
  });
});

describe("mergeStartAllowed", () => {
  it("blocks start while the landing tip is dirty unless committing it", () => {
    const ready = { fromSet: true, intoSet: true, distinct: true, intoDirty: false, commitDirtyTarget: false };
    assert.equal(mergeStartAllowed(ready), true);
    assert.equal(mergeStartAllowed({ ...ready, intoDirty: true, commitDirtyTarget: false }), false);
    assert.equal(mergeStartAllowed({ ...ready, intoDirty: true, commitDirtyTarget: true }), true);
    assert.equal(mergeStartAllowed({ ...ready, fromSet: false, distinct: false }), false);
  });
});

describe("nextTimelineEscape", () => {
  const idle = { deleteOpen: false, forkOpen: false, mergeDraft: false, dockOpen: false };

  it("closes the drawer when no inner chrome is open", () => {
    assert.equal(nextTimelineEscape(idle), "close-panel");
  });

  it("peels innermost chrome before the drawer", () => {
    assert.equal(nextTimelineEscape({ ...idle, deleteOpen: true, forkOpen: true, mergeDraft: true, dockOpen: true }), "close-delete");
    assert.equal(nextTimelineEscape({ ...idle, forkOpen: true, mergeDraft: true }), "close-fork");
    assert.equal(nextTimelineEscape({ ...idle, mergeDraft: true, dockOpen: true }), "cancel-merge");
    assert.equal(nextTimelineEscape({ ...idle, dockOpen: true }), "dismiss-dock");
  });
});

describe("pastPanSlop", () => {
  it("waits until the finger has clearly moved", () => {
    assert.equal(pastPanSlop(0, 0), false);
    assert.equal(pastPanSlop(TIMELINE_PAN_SLOP_PX - 1, 0), false);
    assert.equal(pastPanSlop(TIMELINE_PAN_SLOP_PX, 0), true);
    assert.equal(pastPanSlop(6, 8), true);
  });
});

describe("timeline zoom camera", () => {
  it("clamps scale and keeps the focus point fixed", () => {
    assert.equal(clampZoom(0.01), TIMELINE_ZOOM_MIN);
    assert.equal(clampZoom(9), TIMELINE_ZOOM_MAX);
    const cam = { x: 10, y: 20, k: 1 };
    const next = zoomCameraAt(cam, 100, 80, 2);
    assert.equal(next.k, 2);
    assert.equal((100 - next.x) / next.k, (100 - cam.x) / cam.k);
    assert.equal((80 - next.y) / next.k, (80 - cam.y) / cam.k);
    const pinched = pinchCamera(cam, 100, 40, 40, 200, 50, 55);
    assert.equal(pinched.k, 2);
    assert.equal(pinched.x, 50 - ((40 - 10) / 1) * 2);
    assert.equal(pinched.y, 55 - ((40 - 20) / 1) * 2);
    assert.ok(wheelZoomFactor(-100) > 1);
    assert.ok(wheelZoomFactor(100) < 1);
  });
});

describe("timelineLabelLod", () => {
  it("drops text as the view shrinks", () => {
    assert.equal(timelineLabelLod(1), "full");
    assert.equal(timelineLabelLod(0.79), "tips");
    assert.equal(timelineLabelLod(0.54), "minimal");
    assert.equal(timelineLabelLod(0.3), "graph");
    const head = {
      isHead: true,
      showTickStem: true,
      showTickTime: true,
      showLabel: true,
      labelMaxChars: 0,
    };
    const whisper = {
      isHead: false,
      showTickStem: true,
      showTickTime: true,
      showLabel: true,
      labelMaxChars: 22,
    };
    const fullHead = timelineLabelFlags("full", head);
    assert.equal(fullHead.showLabel, true);
    assert.equal(fullHead.showTickTime, true);
    assert.equal(fullHead.chip, true);
    const tipsWhisper = timelineLabelFlags("tips", whisper);
    assert.equal(tipsWhisper.showLabel, false);
    assert.equal(tipsWhisper.showTickTime, false);
    assert.equal(tipsWhisper.showTickStem, true);
    const minimalHead = timelineLabelFlags("minimal", head);
    assert.equal(minimalHead.showLabel, true);
    assert.equal(minimalHead.sparse, true);
    assert.equal(minimalHead.showTickStem, false);
    const graphHead = timelineLabelFlags("graph", head);
    assert.equal(graphHead.showLabel, false);
    assert.equal(graphHead.showTickStem, false);
    const selected = timelineLabelFlags("minimal", { ...whisper, selected: true });
    assert.equal(selected.showLabel, true);
    assert.equal(selected.chip, true);
  });
});

function leaf(
  id: string,
  branchId: string,
  createdAt: string,
  extra: Partial<TimelineNode> = {},
): TimelineNode {
  return {
    id,
    branchId,
    parentId: extra.parentId ?? null,
    gitHash: id,
    message: id,
    author: "a",
    createdAt,
    ...extra,
  };
}

function branch(id: string, head: string, extra: Partial<TimelineBranch> = {}): TimelineBranch {
  return {
    id,
    name: id,
    sacred: extra.sacred ?? id === "main",
    headNodeId: head,
    createdAt: extra.createdAt ?? "2026-01-01T00:00:00.000Z",
    gitRef: extra.gitRef ?? `refs/heads/${id}`,
    ...extra,
  };
}

function viewOf(branches: TimelineBranch[], nodes: TimelineNode[]): TimelineView {
  const active = branches[0]!;
  const head = nodes.find((n) => n.id === active.headNodeId) ?? null;
  return {
    version: 1,
    activeBranchId: active.id,
    viewingNodeId: head?.id ?? null,
    branches,
    nodes,
    dirty: false,
    canEdit: true,
    activeBranch: active,
    headNode: head,
    viewingNode: head,
    viewingGitHash: null,
  };
}

describe("layoutTimeline packing", () => {
  it("keeps a parent left of its child and stacks a parallel fork in the same column", () => {
    const nodes = [
      leaf("a", "main", "2026-01-01T00:00:00.000Z"),
      leaf("b", "main", "2026-01-01T01:00:00.000Z", { parentId: "a" }),
      leaf("d", "feat", "2026-01-01T01:05:00.000Z", { parentId: "a" }),
      leaf("c", "main", "2026-01-01T02:00:00.000Z", { parentId: "b" }),
    ];
    const layout = layoutTimeline(
      viewOf(
        [branch("main", "c", { sacred: true }), branch("feat", "d", { createdAt: "2026-01-01T01:05:00.000Z" })],
        nodes,
      ),
    );
    const at = (id: string) => layout.nodes.find((n) => n.node.id === id)!;
    assert.ok(at("b").x > at("a").x);
    assert.ok(at("d").x > at("a").x);
    assert.ok(at("c").x > at("b").x);
    assert.ok(Math.abs(at("b").x - at("d").x) < 8);
    const span = Math.max(...layout.nodes.map((n) => n.x)) - Math.min(...layout.nodes.map((n) => n.x));
    assert.ok(span < 200, `span ${span}`);
    assert.notEqual(at("b").y, at("d").y);
  });

  it("does not put two same-lane leaves on one x", () => {
    const nodes = [
      leaf("a", "main", "2026-01-01T00:00:00.000Z"),
      leaf("b", "main", "2026-01-01T00:01:00.000Z", { parentId: "a" }),
      leaf("c", "main", "2026-01-01T00:02:00.000Z", { parentId: "b" }),
    ];
    const layout = layoutTimeline(viewOf([branch("main", "c", { sacred: true })], nodes));
    const xs = layout.nodes.map((n) => n.x);
    assert.equal(new Set(xs).size, 3);
    assert.ok(layout.height < 280);
  });
});

