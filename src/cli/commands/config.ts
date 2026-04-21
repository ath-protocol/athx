import { Command } from "commander";
import { loadConfig, output, handleError } from "../shared.js";

export const configCommand = new Command("config")
  .description("Manage athx configuration");

configCommand
  .command("show")
  .description("Show current configuration")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action((opts) => {
    try {
      const config = loadConfig();
      const data = config.get();
      if (opts.format === "json") {
        output(data, "json");
      } else {
        console.log(`Config dir: ${config.getConfigDir()}\n`);
        if (data.agentId) console.log(`Agent ID:   ${data.agentId}`);
        if (data.keyPath) console.log(`Key path:   ${data.keyPath}`);
        if (data.keyId) console.log(`Key ID:     ${data.keyId}`);
        console.log(`Default:    ${data.defaultGateway || "(none)"}\n`);
        if (data.gateways.length === 0) {
          console.log("No gateways configured.");
        } else {
          console.log("Gateways:");
          for (const g of data.gateways) {
            const marker = g.name === data.defaultGateway ? " (default)" : "";
            console.log(`  ${g.name}: ${g.url}${marker}`);
          }
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

configCommand
  .command("init")
  .description("Initialize config directory and default config file")
  .action(() => {
    try {
      const config = loadConfig();
      config.init();
      console.log(`Config initialized at ${config.getConfigDir()}`);
    } catch (err) {
      handleError(err);
    }
  });

configCommand
  .command("set-gateway <name> <url>")
  .description("Add or update a gateway")
  .action((name: string, url: string) => {
    try {
      const config = loadConfig();
      config.setGateway(name, url);
      console.log(`Gateway "${name}" set to ${url}`);
    } catch (err) {
      handleError(err);
    }
  });

configCommand
  .command("set <key> <value>")
  .description("Set a config value (agent-id, key-path, key-id, default-gateway)")
  .action((key: string, value: string) => {
    try {
      const config = loadConfig();
      switch (key) {
        case "agent-id":
          config.setAgentId(value);
          break;
        case "key-path":
          config.setKeyPath(value);
          break;
        case "key-id":
          config.setKeyId(value);
          break;
        case "default-gateway":
          config.setDefault(value);
          break;
        default:
          console.error(`Unknown config key: ${key}`);
          console.error("Valid keys: agent-id, key-path, key-id, default-gateway");
          process.exit(1);
      }
      console.log(`Set ${key} = ${value}`);
    } catch (err) {
      handleError(err);
    }
  });
