import { Router } from "express";
import { z, ZodError } from "zod";
import {
  clearHostCookieHeader,
  hostCookieHeader,
  hostLogin,
  verifyHostCookie,
} from "../services/hostAuth.js";
import { hostGatewayPublicView } from "../services/hostGateway.js";
import { clientIp } from "../services/shareAuth.js";

function statusOf(err: unknown): number {
  if (err instanceof ZodError) return 400;
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return 500;
}

export const hostRouter = Router();

hostRouter.get("/me", (req, res) => {
  const session = verifyHostCookie(req);
  if (!session) {
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: session.username });
});

hostRouter.get("/gateway", (_req, res) => {
  res.json(hostGatewayPublicView());
});

hostRouter.post("/login", (req, res) => {
  const schema = z.object({
    username: z.string().min(1).max(80),
    password: z.string().min(1).max(200),
  });
  try {
    const body = schema.parse(req.body);
    const { username, token } = hostLogin(body, clientIp(req));
    res.setHeader("Set-Cookie", hostCookieHeader(token));
    res.json({ ok: true, username });
  } catch (err) {
    res.status(statusOf(err)).json({ error: err instanceof Error ? err.message : "Sign-in failed" });
  }
});

hostRouter.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", clearHostCookieHeader());
  res.json({ ok: true });
});
