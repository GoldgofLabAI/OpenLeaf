import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { describe, it } from "node:test";
import { invalidJsonMiddleware, isInvalidJsonBodyError } from "../http/jsonErrors.ts";
import { sessionAfterMeFailure } from "../../../client/src/session/sessionState.ts";

describe("isInvalidJsonBodyError", () => {
  it("detects body-parser syntax errors", () => {
    const err = Object.assign(new SyntaxError("Unexpected token"), { body: "{" });
    assert.equal(isInvalidJsonBodyError(err), true);
    assert.equal(isInvalidJsonBodyError(new Error("nope")), false);
  });
});

describe("publicErrorMessage", () => {
  it("formats the first Zod issue as a short message", async () => {
    const { publicErrorMessage } = await import("../http/jsonErrors.ts");
    const { z } = await import("zod");
    try {
      z.object({ content: z.string() }).parse({});
      assert.fail("expected throw");
    } catch (err) {
      assert.equal(publicErrorMessage(err), "content: Required");
    }
  });
});

describe("invalidJsonMiddleware HTTP", () => {
  it("returns 400 for malformed JSON instead of 500", async () => {
    const app = express();
    app.use(express.json());
    app.use(invalidJsonMiddleware);
    app.post("/echo", (req, res) => res.json({ ok: true, body: req.body }));
    app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const url = `http://127.0.0.1:${addr.port}/echo`;
    try {
      const bad = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      assert.equal(bad.status, 400);
      const payload = (await bad.json()) as { error: string };
      assert.equal(payload.error, "Invalid JSON");

      const good = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      });
      assert.equal(good.status, 200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});

describe("sessionAfterMeFailure", () => {
  it("falls back to local host only while loading", () => {
    assert.deepEqual(sessionAfterMeFailure({ kind: "loading" }), { kind: "host", remote: false });
  });

  it("keeps guest and host-login sessions", () => {
    const guest = { kind: "guest" as const };
    const login = { kind: "host-login" as const };
    assert.equal(sessionAfterMeFailure(guest), guest);
    assert.equal(sessionAfterMeFailure(login), login);
  });

  it("keeps guest-inactive and guest-login sessions", () => {
    const inactive = { kind: "guest-inactive" as const };
    const join = { kind: "guest-login" as const };
    assert.equal(sessionAfterMeFailure(inactive), inactive);
    assert.equal(sessionAfterMeFailure(join), join);
  });
});
