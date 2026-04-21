/**
 * Config — manages ~/.athx/config.json for gateway URLs, agent identity, and key paths.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface GatewayEntry {
  name: string;
  url: string;
}

export interface ATHXConfig {
  defaultGateway?: string;
  gateways: GatewayEntry[];
  agentId?: string;
  keyPath?: string;
  keyId?: string;
}

export type GatewayResolution =
  | { kind: "url"; url: string }
  | { kind: "named"; name: string; url: string }
  | { kind: "unknown-name"; name: string; knownNames: string[] }
  | { kind: "none" };

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function defaultConfig(): ATHXConfig {
  return { gateways: [] };
}

export class Config {
  private configDir: string;
  private configPath: string;
  private data: ATHXConfig;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(os.homedir(), ".athx");
    this.configPath = path.join(this.configDir, "config.json");
    this.data = this.load();
  }

  private load(): ATHXConfig {
    try {
      const raw = fs.readFileSync(this.configPath, "utf-8");
      return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch {
      return defaultConfig();
    }
  }

  private save(): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
  }

  get(): ATHXConfig {
    return {
      ...this.data,
      gateways: this.data.gateways.map((g) => ({ ...g })),
    };
  }

  getGatewayUrl(nameOrUrl?: string): string | undefined {
    const r = this.resolveGateway(nameOrUrl);
    return r.kind === "url" || r.kind === "named" ? r.url : undefined;
  }

  /**
   * Resolve a gateway reference with explicit outcome, so callers can
   * distinguish "no gateway configured" from "unknown name".
   *
   *   resolveGateway()                  — pick the default or first entry
   *   resolveGateway("http://...")      — explicit URL passthrough
   *   resolveGateway("name")            — named lookup (may be unknown)
   */
  resolveGateway(nameOrUrl?: string): GatewayResolution {
    if (nameOrUrl && isHttpUrl(nameOrUrl)) {
      return { kind: "url", url: nameOrUrl };
    }

    if (nameOrUrl) {
      const entry = this.data.gateways.find((g) => g.name === nameOrUrl);
      if (!entry) {
        return {
          kind: "unknown-name",
          name: nameOrUrl,
          knownNames: this.data.gateways.map((g) => g.name),
        };
      }
      return { kind: "named", name: entry.name, url: entry.url };
    }

    const fallbackName =
      this.data.defaultGateway ?? this.data.gateways[0]?.name;
    if (!fallbackName) {
      return { kind: "none" };
    }
    const entry = this.data.gateways.find((g) => g.name === fallbackName);
    if (!entry) {
      return { kind: "none" };
    }
    return { kind: "named", name: entry.name, url: entry.url };
  }

  setGateway(name: string, url: string): void {
    if (!isHttpUrl(url)) {
      throw new Error(
        `Gateway URL must start with http:// or https:// (got: ${JSON.stringify(url)}).`,
      );
    }
    const existing = this.data.gateways.findIndex((g) => g.name === name);
    if (existing >= 0) {
      this.data.gateways[existing].url = url;
    } else {
      this.data.gateways.push({ name, url });
    }
    if (!this.data.defaultGateway) {
      this.data.defaultGateway = name;
    }
    this.save();
  }

  setDefault(name: string): void {
    this.data.defaultGateway = name;
    this.save();
  }

  setAgentId(agentId: string): void {
    this.data.agentId = agentId;
    this.save();
  }

  setKeyPath(keyPath: string): void {
    this.data.keyPath = keyPath;
    this.save();
  }

  setKeyId(keyId: string): void {
    this.data.keyId = keyId;
    this.save();
  }

  init(): void {
    this.save();
  }

  getConfigDir(): string {
    return this.configDir;
  }
}
