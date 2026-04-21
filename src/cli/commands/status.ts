import { Command } from "commander";
import { loadConfig, loadCredentialStore, output, handleError } from "../shared.js";

export const statusCommand = new Command("status")
  .description("Show registration state, active tokens, and token expiry")
  .option("-g, --gateway <url>", "Gateway URL or config name")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const store = loadCredentialStore(config);
      const resolution = config.resolveGateway(opts.gateway);

      if (resolution.kind === "unknown-name") {
        const known =
          resolution.knownNames.length === 0
            ? "(none configured)"
            : resolution.knownNames.join(", ");
        console.log(
          `Unknown gateway name '${resolution.name}'. Known gateways: ${known}.`,
        );
        console.log("Use: athx config set-gateway <name> <url> to add one.");
        return;
      }

      if (resolution.kind === "none") {
        console.log("No gateway configured. Run: athx config set-gateway <name> <url>");
        return;
      }

      const gatewayUrl = resolution.url;
      const creds = store.getCredentials(gatewayUrl);

      if (opts.format === "json") {
        output({ gateway: gatewayUrl, credentials: creds || null }, "json");
        return;
      }

      console.log(`Gateway: ${gatewayUrl}\n`);

      if (!creds) {
        console.log("Not registered. Run: athx register --provider <id> --scopes <list>");
        return;
      }

      console.log(`Agent:       ${creds.agentId}`);
      console.log(`Client ID:   ${creds.clientId}`);
      console.log(`Registered:  ${creds.registeredAt}\n`);

      const tokenEntries = Object.entries(creds.tokens);
      if (tokenEntries.length === 0) {
        console.log("No active tokens.");
      } else {
        console.log("Tokens:");
        for (const [provider, token] of tokenEntries) {
          const expires = new Date(token.expiresAt);
          const expired = expires < new Date();
          const status = expired ? "EXPIRED" : `expires ${expires.toISOString()}`;
          console.log(`  ${provider}: [${token.effectiveScopes.join(", ")}] — ${status}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });
