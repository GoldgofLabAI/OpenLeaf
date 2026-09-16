import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openleaf-mcp-"));
process.env.OPENLEAF_PROJECTS_ROOT = projectsRoot;
process.env.OPENLEAF_AI_GATEWAY = "local";

const { loadConfig } = await import("../config.js");
loadConfig(true);

const { ensureProjectGit } = await import("./projectGit.js");
const { intentionalCommit, ensureBranchRoot } = await import("./timeline.js");
const { mintAiCollaborator, resolveAiToken } = await import("./aiShare.js");
const { stopAiGateway } = await import("./aiGateway.js");
const { buildMcpConfigJson, mcpUrlFromApiBase } = await import("./aiPrompt.js");
const { aiApiRouter } = await import("../routes/ai.js");
const {
  clearMcpSessionsForTests,
  handleMcpHttp,
  mcpToolNames,
} = await import("./aiMcp.js");

async function seedProject(id: string): Promise<void> {
  const dir = path.join(projectsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "main.tex"), "base\n", "utf8");
  fs.writeFileSync(
    path.join(dir, "openleaf.json"),
    JSON.stringify({ mainFile: "main.tex", engine: "pdflatex" }),
    "utf8",
  );
  await ensureProjectGit(id);
  await intentionalCommit(id, { branchId: "main", message: "base" });
}

describe("MCP config snippet", () => {
  it("emits a Cursor-style remote server with Bearer header", () => {
    const json = buildMcpConfigJson({
      mcpUrl: "https://example.test/api/ai/v1/mcp",
      token: "secret-token",
      slug: "chatgpt-pass1",
    });
    const parsed = JSON.parse(json) as {
      mcpServers: Record<string, { url: string; headers: { Authorization: string } }>;
    };
    const server = parsed.mcpServers["openleaf-ai-chatgpt-pass1"];
    assert.ok(server);
    assert.equal(server.url, "https://example.test/api/ai/v1/mcp");
    assert.equal(server.headers.Authorization, "Bearer secret-token");
    assert.equal(mcpUrlFromApiBase("https://example.test/api/ai/v1"), "https://example.test/api/ai/v1/mcp");
  });
});

describe("AI MCP JSON-RPC", { concurrency: false }, () => {
  const id = "mcp-ai-project";
  let token = "";

  before(async () => {
    await seedProject(id);
    const minted = await mintAiCollaborator(id, "main", { slug: "mcp-pass" });
    token = minted.ai.token;
    assert.match(minted.mcpUrl, /\/api\/ai\/v1\/mcp$/);
    assert.match(minted.mcpConfig, /Bearer /);
    clearMcpSessionsForTests();
  });

  after(() => {
    stopAiGateway(id);
    delete process.env.OPENLEAF_AI_GATEWAY;
    fs.rmSync(projectsRoot, { recursive: true, force: true });
  });

  function auth() {
    const resolved = resolveAiToken(token);
    assert.ok(resolved);
    return resolved;
  }

  it("lists the same tools the REST surface exposes", () => {
    assert.ok(mcpToolNames().includes("edit"));
    assert.ok(mcpToolNames().includes("get_context"));
    assert.ok(mcpToolNames().includes("compile"));
  });

  it("initializes a session and lists tools", async () => {
    const init = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
    });
    assert.equal(init.status, 200);
    const sessionId = init.headers["Mcp-Session-Id"];
    assert.ok(sessionId);
    const initBody = init.body as { result: { protocolVersion: string; capabilities: { tools: unknown } } };
    assert.equal(initBody.result.protocolVersion, "2025-03-26");
    assert.ok(initBody.result.capabilities.tools);

    const listed = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      sessionId,
      body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    });
    assert.equal(listed.status, 200);
    const tools = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools;
    assert.ok(tools.some((t) => t.name === "edit"));
  });

  it("calls get_context and edit on the sandbox", async () => {
    const ctx = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_context", arguments: {} },
      },
    });
    assert.equal(ctx.status, 200);
    const ctxResult = ctx.body as { result: { isError?: boolean; structuredContent: { sandbox: { branchName: string } } } };
    assert.equal(ctxResult.result.isError, false);
    assert.match(ctxResult.result.structuredContent.sandbox.branchName, /^ai\/mcp-pass-/);

    const edited = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "edit",
          arguments: { path: "main.tex", old: "base\n", new: "from-mcp\n" },
        },
      },
    });
    assert.equal(edited.status, 200);
    const editResult = edited.body as { result: { isError?: boolean } };
    assert.equal(editResult.result.isError, false);

    const resolved = auth();
    const root = await ensureBranchRoot(id, resolved.ai.branchId);
    assert.equal(fs.readFileSync(path.join(root, "main.tex"), "utf8"), "from-mcp\n");
  });

  it("returns isError when a tool is given bad arguments", async () => {
    const bad = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      body: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "edit", arguments: { path: "main.tex" } },
      },
    });
    assert.equal(bad.status, 200);
    const body = bad.body as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(body.result.isError, true);
    assert.match(body.result.content[0]!.text, /old\/new/i);
  });

  it("404s an unknown session and 403s a malformed Origin", async () => {
    const missing = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      sessionId: "mcp-does-not-exist",
      body: { jsonrpc: "2.0", id: 6, method: "ping" },
    });
    assert.equal(missing.status, 404);

    const origin = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      origin: "not a url",
      body: { jsonrpc: "2.0", id: 7, method: "ping" },
    });
    assert.equal(origin.status, 403);
  });

  it("accepts initialized notifications with 202", async () => {
    const note = await handleMcpHttp({
      method: "POST",
      auth: auth(),
      body: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    assert.equal(note.status, 202);
    assert.equal(note.body, null);
  });

  it("serves POST /api/ai/v1/mcp over HTTP with the Bearer token", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/ai", aiApiRouter);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const url = `http://127.0.0.1:${addr.port}/api/ai/v1/mcp`;
    try {
      const unauth = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      assert.equal(unauth.status, 401);

      const ok = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "http-test", version: "1" } },
        }),
      });
      assert.equal(ok.status, 200);
      assert.ok(ok.headers.get("mcp-session-id"));
      const payload = (await ok.json()) as { result: { serverInfo: { name: string } } };
      assert.equal(payload.result.serverInfo.name, "openleaf-ai");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});
