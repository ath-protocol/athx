import { Command } from "commander";
import { buildGatewayClient, buildNativeClient, resolveMode, output, handleError } from "../shared.js";

export const authorizeCommand = new Command("authorize")
  .description("Start user authorization flow (Phase B: user-side OAuth consent)")
  .requiredOption("--provider <id>", "Provider to authorize")
  .requiredOption("--scopes <list>", "Comma-separated scopes to request")
  .option("--resource <uri>", "Target resource server (RFC 8707)")
  .option("--redirect-uri <uri>", "Custom redirect URI")
  .option("-m, --mode <mode>", "Connection mode (gateway|native)", "gateway")
  .option("-g, --gateway <url>", "Gateway URL or config name (gateway mode)")
  .option("-s, --service <url>", "Service URL (native mode)")
  .option("--agent-id <uri>", "Agent identity URI")
  .option("--key <path>", "Path to ES256 private key (PEM)")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action(async (opts) => {
    try {
      const mode = resolveMode(opts);
      const scopes = opts.scopes.split(",").map((s: string) => s.trim());
      const authOpts = { redirectUri: opts.redirectUri, resource: opts.resource };

      const auth = mode === "native"
        ? await (await buildNativeClient(opts)).client.authorize(opts.provider, scopes, authOpts)
        : await (await buildGatewayClient(opts)).client.authorize(opts.provider, scopes, authOpts);

      if (opts.format === "json") {
        output(auth, "json");
      } else {
        console.log(`Session: ${auth.ath_session_id}`);
        console.log(`\nOpen this URL for user consent:`);
        console.log(`  ${auth.authorization_url}`);
      }
    } catch (err) {
      handleError(err);
    }
  });
