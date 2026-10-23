import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

type FileConfig = {
  access?: string;
  port?: number;
  client?: { devPort?: number };
};

/** default.json, then local.json. Env vars applied by the caller still win. */
function readConfigFiles(): FileConfig {
  const configDir = process.env.OPENLEAF_CONFIG_DIR?.trim() || path.resolve(here, "../config");
  const merged: FileConfig = {};
  for (const name of ["default.json", "local.json"]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(configDir, name), "utf8")) as FileConfig;
      if (parsed.access) merged.access = parsed.access;
      if (typeof parsed.port === "number" && parsed.port > 0) merged.port = parsed.port;
      if (typeof parsed.client?.devPort === "number" && parsed.client.devPort > 0) {
        merged.client = { devPort: parsed.client.devPort };
      }
    } catch {
      /* missing or invalid — keep what we have */
    }
  }
  return merged;
}

function positivePort(fromEnv: string | undefined, fromFile: number | undefined, fallback: number): number {
  const envPort = Number(fromEnv);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  if (fromFile && fromFile > 0) return fromFile;
  return fallback;
}

const fileConfig = readConfigFiles();
const access = process.env.OPENLEAF_ACCESS?.trim() || fileConfig.access || "localhost";
const expose = access === "lan" || access === "remote";
const port = positivePort(process.env.OPENLEAF_CLIENT_PORT, fileConfig.client?.devPort, 5173);
const apiPort = positivePort(process.env.OPENLEAF_PORT, fileConfig.port, 8787);
const apiTarget = `http://127.0.0.1:${apiPort}`;

function apiProxy(ws = false) {
  return {
    target: ws ? `ws://127.0.0.1:${apiPort}` : apiTarget,
    changeOrigin: false,
    xfwd: true,
    ws,
    configure: (proxy: { on: (event: string, handler: (...args: unknown[]) => void) => void }) => {
      proxy.on("proxyReq", (proxyReq: { removeHeader: (name: string) => void; setHeader: (name: string, value: string) => void }, req: { socket?: { remoteAddress?: string }; headers: { host?: string } }) => {
        // Drop caller-supplied forwarding headers, then record only this hop.
        for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cf-connecting-ip"]) {
          proxyReq.removeHeader(name);
        }
        const peer = req.socket?.remoteAddress ?? "";
        if (peer) proxyReq.setHeader("x-forwarded-for", peer);
        if (req.headers.host) proxyReq.setHeader("x-forwarded-host", req.headers.host);
      });
    },
  };
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: expose ? "0.0.0.0" : "127.0.0.1",
    port,
    strictPort: true,
    open: true,
    proxy: {
      "/api": apiProxy(),
      "/ai": apiProxy(),
      "/library-ai": apiProxy(),
      "/join": apiProxy(),
      "/host": apiProxy(),
      "/collab": apiProxy(true),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
