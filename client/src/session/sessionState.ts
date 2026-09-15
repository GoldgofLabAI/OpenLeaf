/** Minimal session shape for the /api/guest/me failure fallback. */
export type SessionKind =
  | "loading"
  | "host"
  | "host-login"
  | "guest-inactive"
  | "guest-login"
  | "guest";

export type SessionLike = { kind: SessionKind };

/** Keep an established session if /api/guest/me fails; only first load may fall back to local host. */
export function sessionAfterMeFailure<T extends SessionLike>(prev: T): T | { kind: "host"; remote: false } {
  return prev.kind === "loading" ? { kind: "host", remote: false } : prev;
}
