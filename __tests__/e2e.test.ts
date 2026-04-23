/**
 * E2E Test: athx CLI — both gateway and native mode.
 *
 * Self-contained: builds mock OAuth, gateway, and native servers
 * using @ath-protocol/server handlers. No external package imports.
 *
 * Run: pnpm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Hono } from "hono";

import {
  createATHHandlers,
  createServiceDiscoveryDocument,
  createProxyHandler,
  InMemoryAgentRegistry,
  InMemoryTokenStore,
  InMemorySessionStore,
  InMemoryProviderTokenStore,
} from "@ath-protocol/server";

const OAUTH_PORT = 15001;
const GATEWAY_PORT = 15000;
const NATIVE_PORT = 15002;
const UPSTREAM_PORT = 15003;
const OAUTH_URL = `http://localhost:${OAUTH_PORT}`;
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;
const NATIVE_URL = `http://localhost:${NATIVE_PORT}`;
const UPSTREAM_URL = `http://localhost:${UPSTREAM_PORT}`;
const AGENT_ID = "https://athx-e2e-test.example.com/.well-known/agent.json";
const OAUTH_CLIENT_ID = "ath-gateway-client";
const OAUTH_CLIENT_SECRET = "ath-gateway-secret";

const CLI_PATH = path.resolve(import.meta.dirname, "../dist/cli/main.js");

let oauthServer: ServerType;
let gatewayServer: ServerType;
let nativeServer: ServerType;
let upstreamServer: ServerType;
let configDir: string;

const exec = promisify(execFile);

async function athx(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const env = { ...process.env, HOME: configDir, XDG_CONFIG_HOME: configDir };
  return exec("node", [CLI_PATH, ...args], { env, cwd: process.cwd() });
}

async function athxJson(...args: string[]): Promise<unknown> {
  const { stdout } = await athx(...args, "--format", "json");
  return JSON.parse(stdout);
}

function buildMockOAuthServer() {
  const app = new Hono();
  const codes = new Map<string, {
    client_id: string; redirect_uri: string; scope: string;
    code_challenge?: string; code_challenge_method?: string;
  }>();
  const tokens = new Map<string, { scope: string }>();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/authorize", (c) => {
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const scope = c.req.query("scope") || "";
    const state = c.req.query("state") || "";
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method");
    const autoApprove = c.req.query("auto_approve") === "true";

    if (!autoApprove) return c.json({ error: "interaction_required" }, 400);

    const code = crypto.randomBytes(16).toString("hex");
    codes.set(code, {
      client_id: clientId!, redirect_uri: redirectUri || "",
      scope, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod,
    });
    const redirect = new URL(redirectUri!);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return c.redirect(redirect.toString());
  });

  app.post("/token", async (c) => {
    const contentType = c.req.header("content-type") || "";
    let grantType: string, code: string, clientId: string, clientSecret: string, codeVerifier: string | undefined;

    if (contentType.includes("application/json")) {
      const json = await c.req.json() as Record<string, string>;
      grantType = json.grant_type; code = json.code;
      clientId = json.client_id; clientSecret = json.client_secret;
      codeVerifier = json.code_verifier;
    } else {
      const form = await c.req.parseBody();
      grantType = form["grant_type"] as string; code = form["code"] as string;
      clientId = form["client_id"] as string; clientSecret = form["client_secret"] as string;
      codeVerifier = form["code_verifier"] as string | undefined;
    }

    if (grantType !== "authorization_code") return c.json({ error: "unsupported_grant_type" }, 400);
    if (clientId !== OAUTH_CLIENT_ID || clientSecret !== OAUTH_CLIENT_SECRET) return c.json({ error: "invalid_client" }, 401);

    const authCode = codes.get(code);
    if (!authCode) return c.json({ error: "invalid_grant" }, 400);

    if (authCode.code_challenge && codeVerifier) {
      const computed = authCode.code_challenge_method === "S256"
        ? crypto.createHash("sha256").update(codeVerifier).digest("base64url")
        : codeVerifier;
      if (computed !== authCode.code_challenge) {
        codes.delete(code);
        return c.json({ error: "invalid_grant", message: "PKCE failed" }, 400);
      }
    }
    codes.delete(code);

    const accessToken = `mock_at_${crypto.randomBytes(24).toString("hex")}`;
    tokens.set(accessToken, { scope: authCode.scope });
    return c.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: authCode.scope });
  });

  app.get("/.well-known/oauth-authorization-server", (c) => c.json({
    issuer: OAUTH_URL,
    authorization_endpoint: `${OAUTH_URL}/authorize`,
    token_endpoint: `${OAUTH_URL}/token`,
    scopes_supported: ["repo", "read:user", "user:email", "mail:read", "mail:send", "mail:delete"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
  }));

  return app;
}

function buildUpstreamService() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/userinfo", (c) => c.json({ login: "test-user", name: "Test User", email: "test@example.com" }));
  app.get("/api/repos", (c) => c.json([{ id: 1, name: "ath-gateway", full_name: "test-user/ath-gateway" }]));
  return app;
}

function buildGatewayService() {
  const app = new Hono();
  const registry = new InMemoryAgentRegistry();
  const tokenStore = new InMemoryTokenStore();
  const sessionStore = new InMemorySessionStore();
  const providerTokenStore = new InMemoryProviderTokenStore();

  const handlers = createATHHandlers({
    registry, tokenStore, sessionStore, providerTokenStore,
    config: {
      audience: GATEWAY_URL,
      callbackUrl: `${GATEWAY_URL}/ath/callback`,
      availableScopes: ["repo", "read:user", "user:email", "read:org"],
      appId: "github",
      skipAttestationVerification: true,
      oauth: {
        authorize_endpoint: `${OAUTH_URL}/authorize`,
        token_endpoint: `${OAUTH_URL}/token`,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
      },
    },
  });

  app.get("/.well-known/ath.json", (c) => c.json({
    ath_version: "0.1",
    gateway_id: GATEWAY_URL,
    agent_registration_endpoint: `${GATEWAY_URL}/ath/agents/register`,
    supported_providers: [{
      provider_id: "github", display_name: "GitHub", categories: [],
      available_scopes: ["repo", "read:user", "user:email", "read:org"],
      auth_mode: "OAUTH2", agent_approval_required: true,
    }],
  }));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/ath/agents/register", async (c) => {
    const r = await handlers.register({ method: "POST", path: "/ath/agents/register", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });
  app.post("/ath/authorize", async (c) => {
    const r = await handlers.authorize({ method: "POST", path: "/ath/authorize", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });
  app.get("/ath/callback", async (c) => {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.query())) { if (v) query[k] = v; }
    const r = await handlers.callback({ method: "GET", path: "/ath/callback", headers: {}, query, url: c.req.url });
    if (r.status === 302 && r.headers?.Location) return c.redirect(r.headers.Location);
    return c.json(r.body, r.status as any);
  });
  app.post("/ath/token", async (c) => {
    const r = await handlers.token({ method: "POST", path: "/ath/token", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });
  app.post("/ath/revoke", async (c) => {
    const r = await handlers.revoke({ method: "POST", path: "/ath/revoke", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });

  const proxy = createProxyHandler({
    tokenStore,
    providerTokenStore,
    upstreams: { github: UPSTREAM_URL },
  });

  app.all("/ath/proxy/:provider/*", async (c) => {
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => { headers[k] = v; });
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.query())) { if (v) query[k] = v; }
    let body: unknown = undefined;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      try { body = await c.req.json(); } catch { body = undefined; }
    }
    const r = await proxy({ method: c.req.method, path: c.req.path, headers, query, body });
    const out = new Response(
      typeof r.body === "string" || r.body instanceof ArrayBuffer
        ? (r.body as BodyInit)
        : JSON.stringify(r.body),
      { status: r.status, headers: r.headers },
    );
    return out;
  });

  return app;
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
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
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
    const r = await handlers.register({ method: "POST", path: "/ath/agents/register", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });
  app.post("/ath/authorize", async (c) => {
    const r = await handlers.authorize({ method: "POST", path: "/ath/authorize", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });
  app.get("/ath/callback", async (c) => {
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.query())) { if (v) query[k] = v; }
    const r = await handlers.callback({ method: "GET", path: "/ath/callback", headers: {}, query, url: c.req.url });
    if (r.status === 302 && r.headers?.Location) return c.redirect(r.headers.Location);
    return c.json(r.body, r.status as any);
  });
  app.post("/ath/token", async (c) => {
    const r = await handlers.token({ method: "POST", path: "/ath/token", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });
  app.post("/ath/revoke", async (c) => {
    const r = await handlers.revoke({ method: "POST", path: "/ath/revoke", headers: {}, body: await c.req.json() });
    return c.json(r.body, r.status as any);
  });

  app.get("/api/inbox", async (c) => {
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

  oauthServer = serve({ fetch: buildMockOAuthServer().fetch, port: OAUTH_PORT, hostname: "127.0.0.1" });
  gatewayServer = serve({ fetch: buildGatewayService().fetch, port: GATEWAY_PORT, hostname: "127.0.0.1" });
  nativeServer = serve({ fetch: buildNativeService().fetch, port: NATIVE_PORT, hostname: "127.0.0.1" });
  upstreamServer = serve({ fetch: buildUpstreamService().fetch, port: UPSTREAM_PORT, hostname: "127.0.0.1" });

  for (let i = 0; i < 30; i++) {
    try {
      const [gw, oauth, nat, up] = await Promise.all([
        fetch(`${GATEWAY_URL}/health`).then((r) => r.ok),
        fetch(`${OAUTH_URL}/health`).then((r) => r.ok),
        fetch(`${NATIVE_URL}/health`).then((r) => r.ok),
        fetch(`${UPSTREAM_URL}/health`).then((r) => r.ok),
      ]);
      if (gw && oauth && nat && up) break;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
}, 30_000);

afterAll(async () => {
  oauthServer?.close();
  gatewayServer?.close();
  nativeServer?.close();
  upstreamServer?.close();
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

  it("proxy — reaches upstream via gateway", async () => {
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
