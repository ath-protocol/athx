/**
 * Unit tests for CredentialStore (src/credential-store.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CredentialStore, type StoredToken } from "../../src/credential-store.js";

let tmpDir: string;

const GATEWAY = "http://localhost:3000";
const AGENT_ID = "https://agent.example.com/.well-known/agent.json";

function makeToken(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    accessToken: "ath_tk_abc",
    provider: "github",
    effectiveScopes: ["repo"],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    agentId: AGENT_ID,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "athx-cred-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CredentialStore", () => {
  it("returns undefined before any registration is saved", () => {
    const store = new CredentialStore(tmpDir);
    expect(store.getCredentials(GATEWAY)).toBeUndefined();
  });

  it("saves and reloads registration data", () => {
    const store = new CredentialStore(tmpDir);
    store.saveRegistration(GATEWAY, AGENT_ID, "client-123", "secret-xyz");

    const reloaded = new CredentialStore(tmpDir);
    const creds = reloaded.getCredentials(GATEWAY);
    expect(creds?.clientId).toBe("client-123");
    expect(creds?.clientSecret).toBe("secret-xyz");
    expect(creds?.agentId).toBe(AGENT_ID);
    expect(typeof creds?.registeredAt).toBe("string");
    expect(creds?.tokens).toEqual({});
  });

  it("updates registration without dropping existing tokens", () => {
    const store = new CredentialStore(tmpDir);
    store.saveRegistration(GATEWAY, AGENT_ID, "client-1", "secret-1");
    store.saveToken(GATEWAY, "github", makeToken());

    store.saveRegistration(GATEWAY, AGENT_ID, "client-2", "secret-2");
    expect(store.getCredentials(GATEWAY)?.clientId).toBe("client-2");
    expect(store.getToken(GATEWAY, "github")?.accessToken).toBe("ath_tk_abc");
  });

  it("ignores saveToken for unknown gateway", () => {
    const store = new CredentialStore(tmpDir);
    store.saveToken(GATEWAY, "github", makeToken());
    expect(store.getCredentials(GATEWAY)).toBeUndefined();
  });

  it("returns stored token while valid and prunes expired tokens on read", () => {
    const store = new CredentialStore(tmpDir);
    store.saveRegistration(GATEWAY, AGENT_ID, "client-1", "secret-1");
    store.saveToken(
      GATEWAY,
      "github",
      makeToken({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    expect(store.getToken(GATEWAY, "github")).toBeUndefined();
    const raw = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "credentials.json"), "utf-8"),
    );
    expect(raw[GATEWAY].tokens.github).toBeUndefined();
  });

  it("removeToken deletes only the specified provider token", () => {
    const store = new CredentialStore(tmpDir);
    store.saveRegistration(GATEWAY, AGENT_ID, "client-1", "secret-1");
    store.saveToken(GATEWAY, "github", makeToken({ provider: "github" }));
    store.saveToken(GATEWAY, "mail", makeToken({ provider: "mail" }));

    store.removeToken(GATEWAY, "github");
    expect(store.getToken(GATEWAY, "github")).toBeUndefined();
    expect(store.getToken(GATEWAY, "mail")).toBeDefined();
  });

  it("clear() removes the entire gateway entry", () => {
    const store = new CredentialStore(tmpDir);
    store.saveRegistration(GATEWAY, AGENT_ID, "client-1", "secret-1");
    store.clear(GATEWAY);
    expect(store.getCredentials(GATEWAY)).toBeUndefined();
  });

  it("isolates credentials between different gateway URLs", () => {
    const store = new CredentialStore(tmpDir);
    store.saveRegistration("http://a", AGENT_ID, "client-a", "secret-a");
    store.saveRegistration("http://b", AGENT_ID, "client-b", "secret-b");
    expect(store.getCredentials("http://a")?.clientId).toBe("client-a");
    expect(store.getCredentials("http://b")?.clientId).toBe("client-b");
  });
});
