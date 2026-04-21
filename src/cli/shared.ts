/**
 * Shared CLI utilities — client construction, key loading, output formatting.
 */
import { generateKeyPair, importPKCS8 } from "jose";
import fs from "node:fs";
import { ATHXGatewayClient } from "../gateway-client.js";
import { ATHXNativeClient } from "../native-client.js";
import { Config } from "../config.js";
import { CredentialStore } from "../credential-store.js";

export type Mode = "gateway" | "native";

export function loadConfig(): Config {
  return new Config();
}

export function loadCredentialStore(config: Config): CredentialStore {
  return new CredentialStore(config.getConfigDir());
}

export async function loadPrivateKey(keyPath?: string) {
  if (keyPath && fs.existsSync(keyPath)) {
    const pem = fs.readFileSync(keyPath, "utf-8");
    return importPKCS8(pem, "ES256");
  }
  const { privateKey } = await generateKeyPair("ES256");
  return privateKey;
}

function resolveMode(opts: { mode?: string }): Mode {
  if (opts.mode === "native") return "native";
  return "gateway";
}

export async function buildGatewayClient(opts: {
  gateway?: string;
  agentId?: string;
  key?: string;
  keyId?: string;
}): Promise<{ client: ATHXGatewayClient; url: string }> {
  const config = loadConfig();
  const store = loadCredentialStore(config);
  const cfg = config.get();

  const url = config.getGatewayUrl(opts.gateway);
  if (!url) {
    throw new Error("No gateway URL. Use --gateway <url> or run: athx config set-gateway <name> <url>");
  }

  const agentId = opts.agentId || cfg.agentId;
  if (!agentId) {
    throw new Error("No agent ID. Use --agent-id <uri> or run: athx config set agent-id <uri>");
  }

  const privateKey = await loadPrivateKey(opts.key || cfg.keyPath);
  const keyId = opts.keyId || cfg.keyId || "default";

  const client = new ATHXGatewayClient({
    url,
    agentId,
    privateKey,
    keyId,
    credentialStore: store,
  });

  return { client, url };
}

export async function buildNativeClient(opts: {
  service?: string;
  agentId?: string;
  key?: string;
  keyId?: string;
}): Promise<{ client: ATHXNativeClient; url: string }> {
  const config = loadConfig();
  const store = loadCredentialStore(config);
  const cfg = config.get();

  const url = opts.service;
  if (!url) {
    throw new Error(
      "No service URL for native mode. Use --service <url> (e.g. --service https://mail.example.com).",
    );
  }

  const agentId = opts.agentId || cfg.agentId;
  if (!agentId) {
    throw new Error("No agent ID. Use --agent-id <uri> or run: athx config set agent-id <uri>");
  }

  const privateKey = await loadPrivateKey(opts.key || cfg.keyPath);
  const keyId = opts.keyId || cfg.keyId || "default";

  const client = new ATHXNativeClient({
    url,
    agentId,
    privateKey,
    keyId,
    credentialStore: store,
  });

  return { client, url };
}

export { resolveMode };

export function output(data: unknown, format: "json" | "text" = "text"): void {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === "string") {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function formatError(err: unknown): string {
  if (!(err instanceof Error)) {
    return `Unknown error: ${String(err)}`;
  }

  const code = (err as { code?: string }).code;
  const status = (err as { status?: number }).status;
  const prefix = code ? `[${code}]` : status ? `[HTTP ${status}]` : "[ERROR]";

  const detail = describeCause((err as { cause?: unknown }).cause);
  const message = detail ? `${err.message} (${detail})` : err.message;
  return `${prefix} ${message}`;
}

export function handleError(err: unknown): never {
  console.error(formatError(err));
  process.exit(1);
}

function describeCause(cause: unknown, depth = 0): string | undefined {
  if (!cause || depth > 3) return undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    const nested = describeCause((cause as { cause?: unknown }).cause, depth + 1);
    const base = code ? `${code}: ${cause.message}` : cause.message;
    return nested ? `${base} → ${nested}` : base;
  }
  if (typeof cause === "object") {
    const obj = cause as { code?: unknown; message?: unknown };
    if (typeof obj.code === "string" || typeof obj.message === "string") {
      const code = typeof obj.code === "string" ? obj.code : undefined;
      const message = typeof obj.message === "string" ? obj.message : undefined;
      if (code && message) return `${code}: ${message}`;
      return code ?? message;
    }
  }
  return undefined;
}
