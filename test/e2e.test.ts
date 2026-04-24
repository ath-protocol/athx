/**
 * E2E Test: athx CLI — ATH Protocol v0.1 compliance.
 *
 * Following auto-test ath-protocol persona: exercises the full trust handshake
 * flow from the agent's perspective via real HTTP against real ATH server handlers.
 *
 * Only the external OAuth provider is mocked (it's an external dependency we don't
 * control). Everything else is real:
 *   - Gateway server: real createATHHandlers, real proxy, real token validation
 *   - Native server: real createATHHandlers, real session management
 *   - Upstream provider API: real HTTP server (simulates GitHub-like API)
 *   - CLI: real process exec with real credential persistence
 *   - PKCE: real S256 challenge/verify through the mock OAuth server
 *   - Scope intersection: real three-way computation
 *   - Token binding: real agent_id + provider_id enforcement
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

async function athxFail(...args: string[]): Promise<string> {
  try {
    await athx(...args);
    throw new Error("Expected CLI to fail but it succeeded");
  } catch (err: any) {
    return err.stderr || err.message || "";
  }
}

// ── Mock OAuth Server (external dependency — only allowed mock) ──

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

// ── Upstream Service Provider (simulates real API like GitHub) ──

function buildUpstreamService() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/userinfo", (c) => c.json({ login: "test-user", name: "Test User", email: "test@example.com" }));
  app.get("/api/repos", (c) => c.json([{ id: 1, name: "ath-gateway", full_name: "test-user/ath-gateway" }]));
  return app;
}

// ── Real ATH Gateway (createATHHandlers — no mocking) ──

let gatewayTokenStore: InMemoryTokenStore;

function buildGatewayService() {
  const app = new Hono();
  const registry = new InMemoryAgentRegistry();
  gatewayTokenStore = new InMemoryTokenStore();
  const sessionStore = new InMemorySessionStore();
  const providerTokenStore = new InMemoryProviderTokenStore();

  const handlers = createATHHandlers({
    registry, tokenStore: gatewayTokenStore, sessionStore, providerTokenStore,
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
    tokenStore: gatewayTokenStore,
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

// ── Real ATH Native Service (createATHHandlers — no mocking) ──

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

// ── Helper: run full handshake and return token ──

async function completeGatewayHandshake(provider: string, scopes: string): Promise<{ access_token: string; effective_scopes: string[] }> {
  const auth = (await athxJson(
    "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
    "--provider", provider, "--scopes", scopes,
  )) as { authorization_url: string; ath_session_id: string };

  const url = new URL(auth.authorization_url);
  url.searchParams.set("auto_approve", "true");
  const r1 = await fetch(url.toString(), { redirect: "manual" });
  await fetch(r1.headers.get("location")!, { redirect: "manual" });

  return (await athxJson(
    "token", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
    "--code", "real_oauth_exchange", "--session", auth.ath_session_id,
  )) as { access_token: string; effective_scopes: string[] };
}

// ── Setup / Teardown ──

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

// ═══════════════════════════════════════════════════════════════
// Gateway Mode — Happy Path (full ATH protocol flow)
// ═══════════════════════════════════════════════════════════════

describe("Gateway mode — happy path", () => {
  it("1. discover — GET /.well-known/ath.json returns valid discovery document", async () => {
    const data = (await athxJson(
      "discover", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
    )) as { ath_version: string; supported_providers: { provider_id: string; available_scopes: string[] }[] };
    expect(data.ath_version).toBe("0.1");
    expect(data.supported_providers).toHaveLength(1);
    expect(data.supported_providers[0].provider_id).toBe("github");
    expect(data.supported_providers[0].available_scopes).toContain("repo");
  });

  it("2. register — Phase A returns client_id and approved scopes", async () => {
    const data = (await athxJson(
      "register", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "repo,read:user", "--purpose", "E2E",
    )) as { agent_status: string; client_id: string; client_secret: string; approved_providers: { approved_scopes: string[]; denied_scopes: string[] }[] };
    expect(data.agent_status).toBe("approved");
    expect(data.client_id).toBeTruthy();
    expect(data.client_secret).toBeTruthy();
    expect(data.approved_providers[0].approved_scopes).toContain("repo");
    expect(data.approved_providers[0].approved_scopes).toContain("read:user");
  });

  let sessionId: string;
  let authorizationUrl: string;

  it("3. authorize — Phase B returns PKCE-protected authorization URL", async () => {
    const data = (await athxJson(
      "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "repo,read:user",
    )) as { authorization_url: string; ath_session_id: string };
    expect(data.ath_session_id).toBeTruthy();

    const url = new URL(data.authorization_url);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toContain("/ath/callback");

    authorizationUrl = data.authorization_url;
    sessionId = data.ath_session_id;
  });

  it("4. consent — real OAuth redirect chain completes (PKCE validated by OAuth server)", async () => {
    const url = new URL(authorizationUrl);
    url.searchParams.set("auto_approve", "true");
    const oauthRes = await fetch(url.toString(), { redirect: "manual" });
    expect(oauthRes.status).toBe(302);

    const callbackUrl = oauthRes.headers.get("location")!;
    expect(callbackUrl).toContain("/ath/callback");
    expect(callbackUrl).toContain("code=");

    const callbackRes = await fetch(callbackUrl, { redirect: "manual" });
    expect(callbackRes.status).toBe(302);
    const finalUrl = callbackRes.headers.get("location")!;
    expect(finalUrl).toContain("success=true");
  });

  it("5. token exchange — returns ATH token with scope intersection", async () => {
    const token = (await athxJson(
      "token", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--code", "real_oauth_exchange", "--session", sessionId,
    )) as {
      access_token: string; token_type: string; expires_in: number;
      effective_scopes: string[]; provider_id: string; agent_id: string;
      scope_intersection: { agent_approved: string[]; user_consented: string[]; effective: string[] };
    };
    expect(token.access_token).toMatch(/^ath_tk_/);
    expect(token.token_type).toBe("Bearer");
    expect(token.expires_in).toBeGreaterThan(0);
    expect(token.provider_id).toBe("github");
    expect(token.agent_id).toBe(AGENT_ID);
    expect(token.effective_scopes).toContain("repo");
    expect(token.scope_intersection.effective.length).toBeGreaterThan(0);
    expect(token.scope_intersection.agent_approved.length).toBeGreaterThan(0);
    expect(token.scope_intersection.user_consented.length).toBeGreaterThan(0);
  });

  it("6. proxy — reaches upstream via gateway proxy with token binding", async () => {
    const data = (await athxJson(
      "proxy", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "github", "GET", "/userinfo",
    )) as { login: string; name: string; email: string };
    expect(data.login).toBe("test-user");
    expect(data.name).toBe("Test User");
  });

  it("7. revoke — token invalidated, status shows no tokens", async () => {
    await athx("revoke", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID, "--provider", "github");
    const { stdout } = await athx("status", "--gateway", GATEWAY_URL);
    expect(stdout).toContain("No active tokens");
  });
});

// ═══════════════════════════════════════════════════════════════
// Gateway Mode — Error Scenarios (ATH protocol security boundaries)
// ═══════════════════════════════════════════════════════════════

describe("Gateway mode — error scenarios", () => {
  it("authorize with unapproved scope → SCOPE_NOT_APPROVED", async () => {
    const stderr = await athxFail(
      "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "admin:org",
    );
    expect(stderr).toContain("SCOPE_NOT_APPROVED");
  });

  it("token exchange with invalid session → SESSION_NOT_FOUND", async () => {
    const stderr = await athxFail(
      "token", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--code", "fake_code", "--session", "nonexistent_session",
    );
    expect(stderr).toContain("SESSION_NOT_FOUND");
  });

  it("proxy with wrong provider → PROVIDER_MISMATCH (direct HTTP)", async () => {
    const token = await completeGatewayHandshake("github", "repo");

    const res = await fetch(`${GATEWAY_URL}/ath/proxy/slack/channels`, {
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "X-ATH-Agent-ID": AGENT_ID,
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("PROVIDER_MISMATCH");
  });

  it("proxy after revocation → TOKEN_REVOKED (direct HTTP)", async () => {
    const token = await completeGatewayHandshake("github", "repo");
    const savedToken = token.access_token;
    await athx("revoke", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID, "--provider", "github");

    const res = await fetch(`${GATEWAY_URL}/ath/proxy/github/userinfo`, {
      headers: {
        "Authorization": `Bearer ${savedToken}`,
        "X-ATH-Agent-ID": AGENT_ID,
      },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("TOKEN_REVOKED");
  });

  it("proxy without Authorization header → TOKEN_INVALID (direct HTTP)", async () => {
    const res = await fetch(`${GATEWAY_URL}/ath/proxy/github/userinfo`);
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("TOKEN_INVALID");
  });

  it("proxy with mismatched X-ATH-Agent-ID → AGENT_IDENTITY_MISMATCH (direct HTTP)", async () => {
    const token = await completeGatewayHandshake("github", "repo");

    const res = await fetch(`${GATEWAY_URL}/ath/proxy/github/userinfo`, {
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
        "X-ATH-Agent-ID": "https://wrong-agent.example.com/agent.json",
      },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("AGENT_IDENTITY_MISMATCH");
  });
});

// ═══════════════════════════════════════════════════════════════
// Gateway Mode — Scope Intersection Verification
// ═══════════════════════════════════════════════════════════════

describe("Gateway mode — scope intersection", () => {
  it("effective scopes = agent_approved ∩ user_consented ∩ requested", async () => {
    const token = await completeGatewayHandshake("github", "repo");

    expect(token.effective_scopes).toContain("repo");
    expect(token.effective_scopes).not.toContain("admin:org");
  });

  it("partial scope request yields subset of approved scopes", async () => {
    const token = (await (async () => {
      const auth = (await athxJson(
        "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
        "--provider", "github", "--scopes", "repo",
      )) as { authorization_url: string; ath_session_id: string };

      const url = new URL(auth.authorization_url);
      url.searchParams.set("auto_approve", "true");
      const r1 = await fetch(url.toString(), { redirect: "manual" });
      await fetch(r1.headers.get("location")!, { redirect: "manual" });

      return (await athxJson(
        "token", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
        "--code", "exchange", "--session", auth.ath_session_id,
      )) as { effective_scopes: string[]; scope_intersection: { agent_approved: string[]; user_consented: string[]; effective: string[] } };
    })());

    expect(token.effective_scopes).toContain("repo");
    expect(token.effective_scopes).not.toContain("read:user");
    expect(token.scope_intersection.effective).toEqual(token.effective_scopes);
  });
});

// ═══════════════════════════════════════════════════════════════
// Gateway Mode — PKCE Verification
// ═══════════════════════════════════════════════════════════════

describe("Gateway mode — PKCE", () => {
  it("authorization URL contains S256 code_challenge (generated server-side)", async () => {
    const auth = (await athxJson(
      "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "repo",
    )) as { authorization_url: string };

    const url = new URL(auth.authorization_url);
    const challenge = url.searchParams.get("code_challenge");
    const method = url.searchParams.get("code_challenge_method");
    expect(challenge).toBeTruthy();
    expect(challenge!.length).toBeGreaterThan(20);
    expect(method).toBe("S256");
  });

  it("full flow completes with real PKCE validation by OAuth server", async () => {
    const auth = (await athxJson(
      "authorize", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--provider", "github", "--scopes", "repo",
    )) as { authorization_url: string; ath_session_id: string };

    const url = new URL(auth.authorization_url);
    url.searchParams.set("auto_approve", "true");
    const r1 = await fetch(url.toString(), { redirect: "manual" });
    expect(r1.status).toBe(302);

    const callbackUrl = r1.headers.get("location")!;
    const r2 = await fetch(callbackUrl, { redirect: "manual" });
    expect(r2.status).toBe(302);
    expect(r2.headers.get("location")).toContain("success=true");

    const token = (await athxJson(
      "token", "--gateway", GATEWAY_URL, "--agent-id", AGENT_ID,
      "--code", "code", "--session", auth.ath_session_id,
    )) as { access_token: string };
    expect(token.access_token).toMatch(/^ath_tk_/);
  });
});

// ═══════════════════════════════════════════════════════════════
// Native Mode — Happy Path (full ATH protocol flow)
// ═══════════════════════════════════════════════════════════════

describe("Native mode — happy path", () => {
  it("1. discover — GET /.well-known/ath-app.json returns valid service discovery", async () => {
    const data = (await athxJson(
      "discover", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
    )) as { ath_version: string; app_id: string; name: string; api_base: string; auth: { type: string; scopes_supported: string[] } };
    expect(data.ath_version).toBe("0.1");
    expect(data.app_id).toBe("com.test.native");
    expect(data.name).toBe("Test Mail Service");
    expect(data.api_base).toContain("/api");
    expect(data.auth.type).toBe("oauth2");
    expect(data.auth.scopes_supported).toContain("mail:read");
  });

  it("1b. discover (text) — human-readable output", async () => {
    const { stdout } = await athx(
      "discover", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
    );
    expect(stdout).toContain("ATH Native Service");
    expect(stdout).toContain("com.test.native");
    expect(stdout).toContain("mail:read");
  });

  it("2. register — Phase A approved", async () => {
    const data = (await athxJson(
      "register", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--provider", "mail", "--scopes", "mail:read,mail:send", "--purpose", "E2E native",
    )) as { agent_status: string; approved_providers: { approved_scopes: string[] }[] };
    expect(data.agent_status).toBe("approved");
    expect(data.approved_providers[0].approved_scopes).toContain("mail:read");
    expect(data.approved_providers[0].approved_scopes).toContain("mail:send");
  });

  let sessionId: string;
  let authorizationUrl: string;

  it("3. authorize — Phase B with PKCE", async () => {
    const data = (await athxJson(
      "authorize", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--provider", "mail", "--scopes", "mail:read,mail:send",
    )) as { authorization_url: string; ath_session_id: string };
    expect(data.authorization_url).toContain(OAUTH_URL);
    expect(data.authorization_url).toContain("code_challenge=");
    expect(data.authorization_url).toContain("code_challenge_method=S256");
    authorizationUrl = data.authorization_url;
    sessionId = data.ath_session_id;
  });

  it("4. consent + 5. token exchange", async () => {
    const url = new URL(authorizationUrl);
    url.searchParams.set("auto_approve", "true");
    const res = await fetch(url.toString(), { redirect: "manual" });
    expect(res.status).toBe(302);
    await fetch(res.headers.get("location")!, { redirect: "manual" });

    const token = (await athxJson(
      "token", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--code", "real_oauth_exchange", "--session", sessionId,
    )) as { access_token: string; effective_scopes: string[]; scope_intersection: { effective: string[] } };
    expect(token.access_token).toMatch(/^ath_tk_/);
    expect(token.effective_scopes).toContain("mail:read");
    expect(token.scope_intersection.effective).toContain("mail:read");
  });

  it("6. api call — direct service access with token", async () => {
    const data = (await athxJson(
      "proxy", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "mail", "GET", "/inbox",
    )) as { id: number; subject: string }[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].subject).toBe("Welcome");
  });

  it("7. revoke", async () => {
    const { stdout } = await athx(
      "revoke", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID, "--provider", "mail",
    );
    expect(stdout).toContain("Token revoked");
  });
});

// ═══════════════════════════════════════════════════════════════
// Native Mode — Error Scenarios
// ═══════════════════════════════════════════════════════════════

describe("Native mode — error scenarios", () => {
  it("authorize with unapproved scope → SCOPE_NOT_APPROVED", async () => {
    const stderr = await athxFail(
      "authorize", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--provider", "mail", "--scopes", "mail:read,admin:all",
    );
    expect(stderr).toContain("SCOPE_NOT_APPROVED");
  });

  it("token exchange with invalid session → SESSION_NOT_FOUND", async () => {
    const stderr = await athxFail(
      "token", "--mode", "native", "--service", NATIVE_URL, "--agent-id", AGENT_ID,
      "--code", "fake", "--session", "fake_session_id",
    );
    expect(stderr).toContain("SESSION_NOT_FOUND");
  });
});
