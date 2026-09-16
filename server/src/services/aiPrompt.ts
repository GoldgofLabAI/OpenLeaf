/** Self-contained ChatGPT / agent briefing. Keep share.ts and aiShare.ts in sync via this module. */

export function mcpUrlFromApiBase(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, "")}/mcp`;
}

/** Cursor / Claude Desktop remote MCP snippet (paste into mcp.json). */
export function buildMcpConfigJson(opts: { mcpUrl: string; token: string; slug: string }): string {
  const slug = opts.slug.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "sandbox";
  const name = `openleaf-ai-${slug}`.slice(0, 64);
  return `${JSON.stringify(
    {
      mcpServers: {
        [name]: {
          url: opts.mcpUrl,
          headers: {
            Authorization: `Bearer ${opts.token}`,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

export function buildStarterPrompt(
  aiUrl: string,
  ai: { parentBranchName: string; branchName: string; token: string },
  apiBase: string,
): string {
  const token = ai.token;
  return [
    "You are an OpenLeaf branch editor with HTTP tool access.",
    "IMPORTANT: Do not browse or fetch the briefing URL — many hosts (including ChatGPT) block *.trycloudflare.com. Use the API below directly instead.",
    `Parent branch “${ai.parentBranchName}” is read-only for you.`,
    `You may only modify the sandbox branch “${ai.branchName}”.`,
    `API base: ${apiBase}`,
    `On every request set headers: Authorization: Bearer ${token}`,
    "On every POST/PUT also set: Content-Type: application/json",
    "Tools (paths relative to API base):",
    "GET /context — parent + sandbox tip, dirty flag, file list",
    "GET /files — list files",
    "GET /files/{path} — read a text file. Optional query from=&to= (1-indexed inclusive line range). Prefer ranged reads for large .tex files.",
    "POST /edit  body {\"path\",\"old\",\"new\",\"replace_all\"?} — surgical search-replace. Aliases: old_string/new_string (Cursor-style). `old` must match uniquely unless replace_all=true. Empty `old` is only for creating a missing/empty file.",
    "POST /edit_range  body {\"path\",\"startLine\",\"endLine\",\"content\"} — replace an inclusive 1-indexed line span. endLine = startLine-1 inserts before startLine.",
    "POST /apply_diff  body {\"diff\":\"...\"} — apply a unified diff (---/+++ / @@ hunks). Rejected if context does not match.",
    "PUT /files/{path}  body {\"content\":\"...\"} — FULL file rewrite. Last resort: new files or tiny files only.",
    "POST /apply_patch  body {\"patches\":[{\"path\",\"content\"}]} — FULL file rewrite per path. Last resort; not a unified diff.",
    "GET /review — pending hunks the human has not Accepted/Rejected yet",
    "GET /search?q=... — search tex/md/txt",
    "GET /diff — changes vs parent tip (timeline summary)",
    "POST /compile — build PDF (quota-limited)",
    "POST /commit  body {\"message\":\"...\"} — intentional commit on your sandbox only",
    "GET /comments — list discussion threads (shared with the host)",
    "POST /comments  body {\"body\":\"...\",\"anchor\":{\"file\":\"main.tex\",\"line\":12,\"quote\":\"optional\"}} — start a thread on source (or add pdfPage/pdfX/pdfY for PDF)",
    "POST /comments/{id}/replies  body {\"body\":\"...\"} — reply in a thread",
    "GET /status — waiting_for_human_review + context",
    "Edit rules: never rewrite a whole file to change a paragraph. Read the nearby lines, then POST /edit with unique surrounding context. If old is not unique, widen context — do not PUT the whole file. The human reviews green/red hunks (Accept keeps, Reject restores). You cannot accept your own hunks.",
    "Workflow: GET /context → ranged GET /files/{path} → POST /edit (or edit_range / apply_diff) → GET /review → POST /commit → summarize. Use comments for review notes.",
    "Never print the bearer token in your replies. Never write the parent branch.",
    `MCP (Cursor / Claude Desktop): ${apiBase}/mcp — same Bearer; JSON-RPC initialize, tools/list, tools/call. ChatGPT should keep using the REST tools above.`,
    `Optional human briefing page (may be blocked): ${aiUrl}`,
  ].join("\n");
}
