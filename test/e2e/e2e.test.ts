/**
 * E2E Test: athx CLI — both gateway and native mode.
 *
 * athx is a standalone repository. This suite requires the following external
 * components to be available at the paths referenced below (typically by
 * cloning / vendoring into `packages/gateway` and `packages/mock-oauth`):
 *   - ath-protocol/gateway          — reference gateway server
 *     (https://github.com/ath-protocol/gateway)
 *   - mock OAuth2 server            — bundled as `vendor/mock-oauth` in the
 *     gateway repo above; expected here at `packages/mock-oauth`
 *   - @ath-protocol/server          — native-mode ATH handlers
 *     (https://github.com/ath-protocol/typescript-sdk)
 *
 * Starts three real HTTP servers, then exercises athx through the full
 * trusted handshake in both deployment modes. No mock/stub behavior.
 *
 * Run with:
 *   pnpm test:e2e     # opt-in, requires the external sources above
 *
 * Unit tests live in `test/unit/` and run with `pnpm test`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";

// Gateway + mock-oauth imports (from the ath-protocol/gateway repo checked out alongside athx)
import { app as gatewayApp } from "../../packages/gateway/src/app.js";
import { app as oauthApp } from "../../packages/mock-oauth/src/server.js";
import { agentStore } from "../../packages/gateway/src/registry/agent-store.js";
import { tokenStore } from "../../packages/gateway/src/auth/token.js";
import { sessionStore } from "../../packages/gateway/src/auth/session-store.js";
import { oauthBridge } from "../../packages/gateway/src/oauth/client.js";
import { providerStore } from "../../packages/gateway/src/providers/store.js";

// @ath-protocol/server (for building the native ATH service in tests)
import {
  createATHHandlers,
  createServiceDiscoveryDocument,
  InMemoryAgentRegistry,
  InMemoryTokenStore,
  InMemorySessionStore,
} from "@ath-protocol/server";

const exec = promisify(execFile);

const GATEWAY_PORT = 15000;
const OAUTH_PORT = 15001;
const NATIVE_PORT = 15002;
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;
const OAUTH_URL = `http://localhost:${OAUTH_PORT}`;
const NATIVE_URL = `http://localhost:${NATIVE_PORT}`;
const AGENT_ID = "https://athx-e2e-test.example.com/.well-known/agent.json";

const CLI_PATH = path.resolve(import.meta.dirname, "../../dist/cli/main.js");

let gatewayServer: ServerType;
let oauthServer: ServerType;
let nativeServer: ServerType;
let configDir: string;

async function athx(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, HOME: configDir, XDG_CONFIG_HOME: configDir };
  return exec("node", [CLI_PATH, ...args], { env, cwd: process.cwd() });
}

async function athxJson(...args: string[]): Promise<unknown> {
  const { stdout } = await athx(...args, "--format", "json");
  return JSON.parse(stdout);
}

function buildNativeService() {
  const app = new Hono();
  const registry = new InMemoryAgentRegistry();
  const nativeTokenStore = new InMemoryTokenStore();
  const nativeSessionStore = new InMemorySessionStore();

  const handlers = createATHHandlers({
    registry,
    tokenStore: nativeTokenStore,
    sessionStore: nativeSessionStore,
    config: {
      audience: NATIVE_URL,
      callbackUrl: `${NATIVE_URL}/ath/callback`,
      availableScopes: ["mail:read", "mail:send", "mail:delete"],
      appId: "com.test.native",
      tokenExpirySeconds: 3600,
      sessionExpirySeconds: 600,
      skipAttestationVerification: true,
      oauth: {
        authorize_endpoint: `${OAUTH_URL}/authorize`,
        token_endpoint: `${OAUTH_URL}/token`,
        client_id: "ath-gateway-client",
        client_secret: "ath-gateway-secret",
      },
    },
  });

  const discoveryDoc = createServiceDiscoveryDocument({
    app_id: "com.test.native",
    name: "Test Mail Service",
    authorization_endpoint: `${OAUTH_URL}/authorize`,
    token_endpoint: `${OAUTH_URL}/token`,
    scopes_supported: ["mail:read", "mail:send", "mail:delete"],
    api_base: `${NATIVE_URL}/api`,
  });

  app.get("/.well-known/ath-app.json", (c) => c.json(discoveryDoc));
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/ath/agents/register", async (c) => {
    const res = await handlers.register({ method: "POST", path: "/ath/agents/register", body: await c.req.json() });
    return c.json(res.body, res.status as 200);
  });

  app.post("/ath/authorize", async (c) => {
    const res = await handlers.authorize({ method: "POST", path: "/ath/authorize", body: await c.req.json() });
    return c.json(res.body, res.status as 200);
  });

  app.get("/ath/callback", async (c) => {
    const query = Object.fromEntries(new URL(c.req.url, NATIVE_URL).searchParams.entries());
    const res = await handlers.callback({ method: "GET", path: "/ath/callback", query });
    if (res.redirect) return c.redirect(res.redirect);
    return c.json(res.body || {}, res.status as 200);
  });

  app.post("/ath/token", async (c) => {
    const res = await handlers.token({ method: "POST", path: "/ath/token", body: await c.req.json() });
    return c.json(res.body, res.status as 200);
  });

  app.post("/ath/revoke", async (c) => {
    const res = await handlers.revoke({ method: "POST", path: "/ath/revoke", body: await c.req.json() });
    return c.json(res.body || {}, res.status as 200);
  });

  app.get("/api/inbox", (c) => {
    const auth = c.req.header("authorization");
    if (!auth) return c.json({ error: "unauthorized" }, 401);
    return c.json([
      { id: 1, subject: "Welcome", from: "admin@test.com" },
      { id: 2, subject: "Meeting", from: "colleague@test.com" },
    ]);
  });

  return app;
}

beforeAll(async () => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "athx-e2e-"));
  process.env.ATH_GATEWAY_HOST = GATEWAY_URL;

  agentStore.clear();
  tokenStore.clear();
  sessionStore.clear();
  oauthBridge.clearTokens();
  providerStore.clearCache();

  providerStore.set("github", {
    display_name: "GitHub (E2E)",
    available_scopes: ["repo", "read:user", "user:email", "read:org"],
    authorize_endpoint: `${OAUTH_URL}/authorize`,
    token_endpoint: `${OAUTH_URL}/token`,
    api_base_url: OAUTH_URL,
    client_id: "ath-gateway-client",
    client_secret: "ath-gateway-secret",
  });

  oauthServer = serve({ fetch: oauthApp.fetch, port: OAUTH_PORT, hostname: "127.0.0.1" });
  gatewayServer = serve({ fetch: gatewayApp.fetch, port: GATEWAY_PORT, hostname: "127.0.0.1" });
  nativeServer = serve({ fetch: buildNativeService().fetch, port: NATIVE_PORT, hostname: "127.0.0.1" });

  for (let i = 0; i < 30; i++) {
    try {
      const [gw, oauth, nat] = await Promise.all([
        fetch(`${GATEWAY_URL}/health`).then((r) => r.ok),
        fetch(`${OAUTH_URL}/health`).then((r) => r.ok),
        fetch(`${NATIVE_URL}/health`).then((r) => r.ok),
      ]);
      if (gw && oauth && nat) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}, 30_000);

afterAll(async () => {
  gatewayServer?.close();
  oauthServer?.close();
  nativeServer?.close();
  agentStore.clear();
  tokenStore.clear();
  sessionStore.clear();
  oauthBridge.clearTokens();
  providerStore.delete("github");
  providerStore.clearCache();
  fs.rmSync(configDir, { recursive: true, force: true });
});

// ── Gateway Mode ────────────────────────────────────────────────

describe("Gateway mode", () => {
  it("discover — lists providers", async () => {
    const data = (await athxJson(
      "discover", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
    )) as { ath_version: string; supported_providers: { provider_id: string }[] };
    expect(data.ath_version).toBe("0.1");
    expect(data.supported_providers.find((p) => p.provider_id === "github")).toBeTruthy();
  });

  let sessionId: string;
  let authorizationUrl: string;

  it("register — agent approved", async () => {
    const data = (await athxJson(
      "register", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "repo,read:user", "--purpose", "E2E",
    )) as { agent_status: string; approved_providers: { approved_scopes: string[] }[] };
    expect(data.agent_status).toBe("approved");
    expect(data.approved_providers[0].approved_scopes).toContain("repo");
  });

  it("authorize — PKCE OAuth URL", async () => {
    const data = (await athxJson(
      "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "repo,read:user",
    )) as { authorization_url: string; ath_session_id: string };
    expect(data.authorization_url).toContain("code_challenge=");
    expect(data.authorization_url).toContain("code_challenge_method=S256");
    authorizationUrl = data.authorization_url;
    sessionId = data.ath_session_id;
  });

  it("consent + token exchange", async () => {
    const url = new URL(authorizationUrl);
    url.searchParams.set("auto_approve", "true");
    const res = await fetch(url.toString(), { redirect: "manual" });
    expect(res.status).toBe(302);
    await fetch(res.headers.get("location")!, { redirect: "manual" });

    const token = (await athxJson(
      "token", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--code", "real_oauth_exchange", "--session", sessionId,
    )) as { access_token: string; effective_scopes: string[] };
    expect(token.access_token).toBeTruthy();
    expect(token.effective_scopes).toContain("repo");
  });

  it("proxy — reaches real OAuth server", async () => {
    const data = (await athxJson(
      "proxy", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "github", "GET", "/userinfo",
    )) as { login: string };
    expect(data.login).toBe("test-user");
  });

  it("revoke + status", async () => {
    await athx("revoke", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID, "--provider", "github");
    const { stdout } = await athx("status", "--gateway", GATEWAY_URL);
    expect(stdout).toContain("No active tokens");
  });
});

// ── Native Mode ─────────────────────────────────────────────────

describe("Native mode", () => {
  it("discover — service discovery", async () => {
    const data = (await athxJson(
      "discover", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
    )) as { ath_version: string; app_id: string; api_base: string };
    expect(data.ath_version).toBe("0.1");
    expect(data.app_id).toBe("com.test.native");
    expect(data.api_base).toContain("/api");
  });

  it("discover (text) — human-readable", async () => {
    const { stdout } = await athx(
      "discover", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
    );
    expect(stdout).toContain("ATH Native Service");
    expect(stdout).toContain("com.test.native");
    expect(stdout).toContain("mail:read");
  });

  let sessionId: string;
  let authorizationUrl: string;

  it("register — agent approved", async () => {
    const data = (await athxJson(
      "register", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--provider", "mail", "--scopes", "mail:read,mail:send", "--purpose", "E2E native",
    )) as { agent_status: string; approved_providers: { approved_scopes: string[] }[] };
    expect(data.agent_status).toBe("approved");
    expect(data.approved_providers[0].approved_scopes).toContain("mail:read");
  });

  it("authorize — PKCE OAuth URL", async () => {
    const data = (await athxJson(
      "authorize", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--provider", "mail", "--scopes", "mail:read,mail:send",
    )) as { authorization_url: string; ath_session_id: string };
    expect(data.authorization_url).toContain(OAUTH_URL);
    expect(data.authorization_url).toContain("code_challenge=");
    authorizationUrl = data.authorization_url;
    sessionId = data.ath_session_id;
  });

  it("consent + token exchange", async () => {
    const url = new URL(authorizationUrl);
    url.searchParams.set("auto_approve", "true");
    const res = await fetch(url.toString(), { redirect: "manual" });
    expect(res.status).toBe(302);
    await fetch(res.headers.get("location")!, { redirect: "manual" });

    const token = (await athxJson(
      "token", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--code", "real_oauth_exchange", "--session", sessionId,
    )) as { access_token: string; effective_scopes: string[] };
    expect(token.access_token).toBeTruthy();
    expect(token.effective_scopes).toContain("mail:read");
  });

  it("proxy — direct API call", async () => {
    const data = (await athxJson(
      "proxy", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "mail", "GET", "/inbox",
    )) as { id: number; subject: string }[];
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].subject).toBe("Welcome");
  });

  it("revoke", async () => {
    const { stdout } = await athx(
      "revoke", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID, "--provider", "mail",
    );
    expect(stdout).toContain("Token revoked");
  });
});
