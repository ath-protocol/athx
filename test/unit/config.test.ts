/**
 * Unit tests for Config (src/config.ts).
 * Uses a temp directory so tests never touch the real ~/.athx.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Config } from "../../src/config.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "athx-config-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Config", () => {
  it("loads default empty config when no file exists", () => {
    const cfg = new Config(tmpDir);
    expect(cfg.get().gateways).toEqual([]);
    expect(cfg.get().defaultGateway).toBeUndefined();
  });

  it("persists and reloads gateway entries", () => {
    const cfg = new Config(tmpDir);
    cfg.setGateway("local", "http://localhost:3000");

    const reloaded = new Config(tmpDir);
    expect(reloaded.get().gateways).toEqual([
      { name: "local", url: "http://localhost:3000" },
    ]);
    expect(reloaded.get().defaultGateway).toBe("local");
  });

  it("updates existing gateway entry instead of duplicating", () => {
    const cfg = new Config(tmpDir);
    cfg.setGateway("prod", "https://old.example.com");
    cfg.setGateway("prod", "https://new.example.com");
    expect(cfg.get().gateways).toEqual([
      { name: "prod", url: "https://new.example.com" },
    ]);
  });

  it("resolves gateway by name, by explicit URL, and by default fallback", () => {
    const cfg = new Config(tmpDir);
    cfg.setGateway("a", "https://a.example.com");
    cfg.setGateway("b", "https://b.example.com");
    cfg.setDefault("b");

    expect(cfg.getGatewayUrl("a")).toBe("https://a.example.com");
    expect(cfg.getGatewayUrl("https://explicit.example.com")).toBe(
      "https://explicit.example.com",
    );
    expect(cfg.getGatewayUrl()).toBe("https://b.example.com");
  });

  it("returns undefined when resolving an unknown gateway name", () => {
    const cfg = new Config(tmpDir);
    cfg.setGateway("a", "https://a.example.com");
    expect(cfg.getGatewayUrl("does-not-exist")).toBeUndefined();
  });

  it("persists agentId, keyPath, and keyId", () => {
    const cfg = new Config(tmpDir);
    cfg.setAgentId("https://agent.example.com/.well-known/agent.json");
    cfg.setKeyPath("/keys/agent.pem");
    cfg.setKeyId("key-1");

    const reloaded = new Config(tmpDir);
    expect(reloaded.get().agentId).toBe(
      "https://agent.example.com/.well-known/agent.json",
    );
    expect(reloaded.get().keyPath).toBe("/keys/agent.pem");
    expect(reloaded.get().keyId).toBe("key-1");
  });

  it("init() creates the config directory and file", () => {
    const cfg = new Config(tmpDir);
    cfg.init();
    expect(fs.existsSync(path.join(tmpDir, "config.json"))).toBe(true);
  });

  it("returns a defensive copy from get() so callers cannot mutate internal state", () => {
    const cfg = new Config(tmpDir);
    cfg.setGateway("a", "https://a.example.com");
    const snap = cfg.get();
    snap.gateways.push({ name: "b", url: "https://b.example.com" });
    expect(cfg.get().gateways).toHaveLength(1);
  });

  // Regression: BUG-002 — setGateway used to accept any string.
  it("rejects non-http(s) URLs with a clear error and does not persist them", () => {
    const cfg = new Config(tmpDir);
    expect(() => cfg.setGateway("bad", "not a url")).toThrow(
      /http:\/\/ or https:\/\//,
    );
    expect(cfg.get().gateways).toEqual([]);
  });

  it("accepts http:// and https:// URLs", () => {
    const cfg = new Config(tmpDir);
    cfg.setGateway("h", "http://example.com");
    cfg.setGateway("s", "https://example.com/path");
    expect(cfg.get().gateways.map((g) => g.name)).toEqual(["h", "s"]);
  });

  // Regression: BUG-003 — status used to treat unknown names as "no config".
  it("resolveGateway distinguishes unknown-name from none", () => {
    const cfg = new Config(tmpDir);
    expect(cfg.resolveGateway().kind).toBe("none");

    cfg.setGateway("a", "https://a.example.com");
    const unknown = cfg.resolveGateway("does-not-exist");
    expect(unknown.kind).toBe("unknown-name");
    if (unknown.kind === "unknown-name") {
      expect(unknown.name).toBe("does-not-exist");
      expect(unknown.knownNames).toEqual(["a"]);
    }

    const named = cfg.resolveGateway("a");
    expect(named.kind).toBe("named");
    if (named.kind === "named") {
      expect(named.url).toBe("https://a.example.com");
    }

    const explicit = cfg.resolveGateway("https://other.example.com");
    expect(explicit.kind).toBe("url");
    if (explicit.kind === "url") {
      expect(explicit.url).toBe("https://other.example.com");
    }
  });
});
