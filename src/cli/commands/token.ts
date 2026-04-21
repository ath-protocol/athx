import { Command } from "commander";
import { buildGatewayClient, buildNativeClient, resolveMode, output, handleError } from "../shared.js";

export const tokenCommand = new Command("token")
  .description("Exchange authorization code for ATH access token")
  .requiredOption("--code <code>", "OAuth authorization code")
  .requiredOption("--session <id>", "ATH session ID from authorize step")
  .option("-m, --mode <mode>", "Connection mode (gateway|native)", "gateway")
  .option("-g, --gateway <url>", "Gateway URL or config name (gateway mode)")
  .option("-s, --service <url>", "Service URL (native mode)")
  .option("--agent-id <uri>", "Agent identity URI")
  .option("--key <path>", "Path to ES256 private key (PEM)")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action(async (opts) => {
    try {
      const mode = resolveMode(opts);
      const res = mode === "native"
        ? await (await buildNativeClient(opts)).client.exchangeToken(opts.code, opts.session)
        : await (await buildGatewayClient(opts)).client.exchangeToken(opts.code, opts.session);

      if (opts.format === "json") {
        output(res, "json");
      } else {
        console.log(`Token type:       ${res.token_type}`);
        console.log(`Provider:         ${res.provider_id}`);
        console.log(`Agent:            ${res.agent_id}`);
        console.log(`Expires in:       ${res.expires_in}s`);
        console.log(`Effective scopes: ${res.effective_scopes.join(", ")}`);
        console.log(`\nScope intersection:`);
        console.log(`  Agent approved:  ${res.scope_intersection.agent_approved.join(", ")}`);
        console.log(`  User consented:  ${res.scope_intersection.user_consented.join(", ")}`);
        console.log(`  Effective:       ${res.scope_intersection.effective.join(", ")}`);
      }
    } catch (err) {
      handleError(err);
    }
  });
