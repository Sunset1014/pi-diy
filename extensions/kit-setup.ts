/**
 * Kit Setup Extension
 *
 * Deploys resources that pi packages cannot carry as manifest entries:
 *   - agents/    -> <agentDir>/agents/    (the subagent extension reads agents
 *                                          via getAgentDir(); packages provide
 *                                          no "agents" resource type)
 *   - AGENTS.md  -> <agentDir>/AGENTS.md  (global instructions)
 *
 * Idempotent: never overwrites existing files, only reports what it skipped.
 * Run /kit-setup once on a new machine after installing the pi-diy package,
 * then restart pi (or /reload) for agents to take effect.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { deployDir, deployFile } from "../lib/kit-setup-core.ts";

export default function kitSetup(pi: ExtensionAPI) {
	pi.registerCommand("kit-setup", {
		description: "Deploy pi-diy agents & AGENTS.md to the pi config dir (idempotent)",
		handler: async (_args, ctx) => {
			// The kit root is one level up from this extension file.
			const kitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
			const agentDir = getAgentDir();

			const agents = deployDir(path.join(kitDir, "agents"), path.join(agentDir, "agents"));
			const agentsMd = deployFile(path.join(kitDir, "AGENTS.md"), path.join(agentDir, "AGENTS.md"));

			const lines: string[] = [];
			if (agents.copied.length > 0) lines.push(`Copied agents: ${agents.copied.join(", ")}`);
			if (agentsMd.copied.length > 0) lines.push("Copied AGENTS.md");
			const skipped = [...agents.skipped, ...agentsMd.skipped];
			if (skipped.length > 0) lines.push(`Skipped (already exist, not overwritten): ${skipped.join(", ")}`);
			if (lines.length === 0) lines.push("Nothing to deploy.");

			await ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
