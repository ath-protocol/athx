import { Command } from "commander";
import { buildGatewayClient, buildNativeClient, resolveMode, output, handleError } from "../shared.js";

export const discoverCommand = new Command("discover")
  .description("Discover available providers/services from an ATH endpoint")
  .option("-m, --mode <mode>", "Connection mode (gateway|native)", "gateway")
  .option("-g, --gateway <url>", "Gateway URL or config name (gateway mode)")
  .option("-s, --service <url>", "Service URL (native mode)")
  .option("--agent-id <uri>", "Agent identity URI")
  .option("--key <path>", "Path to ES256 private key (PEM)")
  .option("--format <fmt>", "Output format (text|json)", "text")
  .action(async (opts) => {
    try {
      const mode = resolveMode(opts);

      if (mode === "native") {
        const { client } = await buildNativeClient(opts);
        const doc = await client.discover();
        if (opts.format === "json") {
          output(doc, "json");
        } else {
          console.log(`ATH Native Service v${doc.ath_version}`);
          console.log(`App:      ${doc.app_id}`);
          console.log(`Name:     ${doc.name}`);
          console.log(`API Base: ${doc.api_base}\n`);
          console.log(`Auth:`);
          console.log(`  Type:   ${doc.auth.type}`);
          console.log(`  Scopes: ${doc.auth.scopes_supported.join(", ")}`);
          console.log(`  Attestation required: ${doc.auth.agent_attestation_required ?? false}`);
        }
      } else {
        const { client } = await buildGatewayClient(opts);
        const doc = await client.discover();
        if (opts.format === "json") {
          output(doc, "json");
        } else {
          console.log(`ATH Gateway v${doc.ath_version} (${doc.gateway_id})\n`);
          console.log("Providers:");
          for (const p of doc.supported_providers) {
            console.log(`  ${p.provider_id} — ${p.display_name}`);
            console.log(`    Scopes: ${p.available_scopes.join(", ")}`);
            console.log(`    Approval required: ${p.agent_approval_required}`);
          }
        }
      }
    } catch (err) {
      handleError(err);
    }
  });
