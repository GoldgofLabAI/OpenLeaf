import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "openleaf-host-auth-"));
process.env.OPENLEAF_HOST_AUTH_DIR = authDir;
process.env.OPENLEAF_HOST_PASSWORD = "test-host-pass-W3x9";
process.env.OPENLEAF_HOST_USER = "admin";

const {
  ensureHostAuth,
  hostLogin,
  mintHostToken,
  readPlainHostPassword,
  resetHostAuthCache,
  updateHostCredentialsUrl,
  verifyHostToken,
} = await import("./hostAuth.js");

describe("hostAuth", () => {
  before(() => {
    resetHostAuthCache();
    const created = ensureHostAuth();
    assert.equal(created.created, true);
    assert.equal(created.username, "admin");
    assert.equal(created.password, "test-host-pass-W3x9");
  });

  after(() => {
    fs.rmSync(authDir, { recursive: true, force: true });
  });

  it("does not rotate an existing password", () => {
    process.env.OPENLEAF_HOST_PASSWORD = "should-not-apply";
    resetHostAuthCache();
    const again = ensureHostAuth();
    assert.equal(again.created, false);
    assert.equal(readPlainHostPassword(), "test-host-pass-W3x9");
  });

  it("accepts the bootstrap password and rejects a wrong one", () => {
    const ok = hostLogin({ username: "Admin", password: "test-host-pass-W3x9" }, "127.0.0.1");
    assert.equal(ok.username, "admin");
    assert.ok(verifyHostToken(ok.token));
    assert.throws(
      () => hostLogin({ username: "admin", password: "nope" }, "10.0.0.2"),
      /Wrong username or password/,
    );
  });

  it("rejects a tampered cookie", () => {
    const token = mintHostToken("admin");
    const broken = `${token.slice(0, -2)}aa`;
    assert.equal(verifyHostToken(broken), null);
    assert.equal(verifyHostToken(undefined), null);
  });

  it("rewrites the operator file with the public URL", () => {
    updateHostCredentialsUrl("https://example.trycloudflare.com");
    const text = fs.readFileSync(path.join(authDir, "host-credentials.txt"), "utf8");
    assert.match(text, /Username: admin/);
    assert.match(text, /Password: test-host-pass-W3x9/);
    assert.match(text, /Public URL: https:\/\/example\.trycloudflare\.com/);
  });
});
