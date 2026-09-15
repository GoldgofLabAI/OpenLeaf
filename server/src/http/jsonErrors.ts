import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export function isInvalidJsonBodyError(err: unknown): boolean {
  return err instanceof SyntaxError && err instanceof Error && "body" in err;
}

export const invalidJsonMiddleware: ErrorRequestHandler = (err, _req, res, next) => {
  if (isInvalidJsonBodyError(err)) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  next(err);
};

/** User-facing API error text — first Zod issue, else Error.message. */
export function publicErrorMessage(err: unknown, fallback = "Failed"): string {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    if (issue) {
      const path = issue.path.filter((p) => p !== undefined && p !== "").join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    }
  }
  return err instanceof Error ? err.message : fallback;
}
