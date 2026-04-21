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

const DEFAULT_CONFIG: ATHXConfig = {
  gateways: [],
};

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
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private save(): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2) + "\n", "utf-8");
  }

  get(): ATHXConfig {
    return { ...this.data };
  }

  getGatewayUrl(nameOrUrl?: string): string | undefined {
    if (nameOrUrl && (nameOrUrl.startsWith("http://") || nameOrUrl.startsWith("https://"))) {
      return nameOrUrl;
    }
    const name = nameOrUrl || this.data.defaultGateway;
    if (!name) return this.data.gateways[0]?.url;
    return this.data.gateways.find((g) => g.name === name)?.url;
  }

  setGateway(name: string, url: string): void {
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
