/**
 * Graphify Extension
 *
 * Registers a `graphify` tool so the LLM queries the codebase graph before
 * falling back to grep/find. Injects a system-prompt guideline reminding the
 * LLM to use graphify first for codebase exploration.
 *
 * Auto-discovered from .pi/extensions/ — no -e flag needed.
 *
 * Requires `graphify` on PATH with a pre-built graph at graphify-out/graph.json
 * (auto-rebuilt by .claude/hooks/pre-session.sh).
 */

import type { ExtensionAPI, TextContent } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "typebox";

const GRAPHIFY_CMD = "graphify";
const GRAPH_DIR = "graphify-out";

function findGraphDir(cwd: string): string | null {
	const candidates = [resolve(cwd, GRAPH_DIR), resolve(cwd, "..", GRAPH_DIR)];
	for (const dir of candidates) {
		if (existsSync(resolve(dir, "graph.json"))) return dir;
	}
	return null;
}

function runGraphifyQuery(cwd: string, query: string, budget = 2000, useDfs = false): string {
	try {
		const graphDir = findGraphDir(cwd);
		if (!graphDir) return "";

		const flags = useDfs ? "--dfs" : "";
		const result = execSync(
			`${GRAPHIFY_CMD} query "${query.replace(/"/g, '\\"')}" --budget ${budget} ${flags} --graph "${resolve(graphDir, "graph.json")}"`,
			{
				cwd,
				encoding: "utf-8",
				timeout: 15_000,
				maxBuffer: 50 * 1024,
			},
		);

		const trimmed = result.trim();
		if (!trimmed || trimmed.startsWith("No nodes found") || trimmed.startsWith("No relevant")) {
			return "";
		}

		return trimmed;
	} catch {
		return "";
	}
}

function formatGraphResult(raw: string): string {
	const lines = raw.split("\n").filter(Boolean);
	if (lines.length === 0) return "";

	// Group by file path for readability
	const fileGroups = new Map<string, string[]>();
	for (const line of lines) {
		const match = line.match(/^NODE\s+(\S+)\s+\[src=(.+?)\s+loc=L(\d+)\s+community=(\d+)\]/);
		if (match) {
			const [, name, filePath, lineNum, community] = match;
			const key = filePath;
			if (!fileGroups.has(key)) fileGroups.set(key, []);
			fileGroups.get(key)!.push(`  • ${name} — line ${lineNum} (community ${community})`);
		} else {
			// Non-standard line (e.g. summary text from graphify)
			if (!fileGroups.has("")) fileGroups.set("", []);
			fileGroups.get("")!.push(`  ${line}`);
		}
	}

	const parts: string[] = [];
	for (const [filePath, entries] of fileGroups) {
		if (filePath === "") {
			parts.push(...entries);
		} else {
			parts.push(`\`${filePath}\``);
			parts.push(...entries);
		}
	}

	return parts.join("\n");
}

export default function (pi: ExtensionAPI) {
	// Register the graphify tool
	pi.registerTool({
		name: "graphify",
		label: "Graphify",
		description:
			"Query the codebase dependency graph to find relevant functions, files, and modules. " +
			"Use this BEFORE grep or find when exploring the codebase — it understands structure, " +
			"imports, and relationships. Ask natural-language questions about the codebase.",
		promptSnippet: "Query the codebase structure graph. Prefer this over grep/find for understanding code.",
		promptGuidelines: [
			"Use graphify first when exploring the codebase — it understands module dependencies, imports, and relationships.",
			"Use graphify to find which file or function implements a feature before reading or grepping.",
			"graphify returns file paths with line numbers — feed those directly to read instead of grepping again.",
		],
		parameters: Type.Object({
			query: Type.String({
				description:
					"Natural-language question about the codebase, e.g. 'where is the wiki engine?' or 'what imports fast-model.ts?'",
			}),
			depth: Type.Optional(
				Type.String({
					description: "Search strategy — 'breadth' (default, wide coverage) or 'depth' (focused deep).",
					default: "breadth",
				}),
			),
			budget: Type.Optional(
				Type.Number({
					description: "Maximum output tokens (default 2000). Increase for broad questions.",
					default: 2000,
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { query, depth = "breadth", budget = 2000 } = params;
			const useDfs = depth === "depth";

			const raw = runGraphifyQuery(ctx.cwd, query, budget, useDfs);
			if (!raw) {
				return {
					content: [
						{
							type: "text",
							text: `No graph results found for "${query}". The graph may not be built yet, or nothing matches. Try a different query or fall back to grep.`,
						},
					] as TextContent[],
					details: { found: false },
				};
			}

			const formatted = formatGraphResult(raw);
			return {
				content: [
					{
						type: "text",
						text: `## Graph results for: "${query}"\n\n${formatted}\n\n---\n_Tip: use \`read\` on the file paths above for details._`,
					},
				] as TextContent[],
				details: { found: true, nodes: raw.split("\n").filter((l) => l.startsWith("NODE ")).length },
			};
		},
	});

	// Intercept grep/find — auto-run graphify and make results available
	// via a widget so the user sees them. The tool execution itself proceeds
	// normally as a fallback.
	pi.on("tool_call", async (event, ctx) => {
		const grepTools = new Set(["grep", "hypa_grep", "find", "hypa_find"]);
		if (!grepTools.has(event.toolName)) return;

		// Derive a graph query from the grep pattern
		const pattern = (event.input as Record<string, unknown>).pattern;
		if (typeof pattern !== "string" || !pattern.trim()) return;

		// Fire-and-forget graphify query — results shown as widget, doesn't block
		const query = `find code matching "${pattern}"`;
		const raw = runGraphifyQuery(ctx.cwd, query, 1000);
		if (!raw) return;

		const formatted = formatGraphResult(raw);
		ctx.ui.setWidget("graphify", [
			`╭─ Graphify (auto: "${pattern}")`,
			...formatted.split("\n").map((l) => `│ ${l}`),
			`╰─ Use graphify tool explicitly for more queries`,
		]);
	});

	// Inject system prompt guideline reminding the LLM about graphify
	pi.on("before_agent_start", (event, _ctx) => {
		event.systemPrompt +=
			"\n\n## Codebase exploration\n" +
			"This project uses Graphify for codebase navigation. Before grepping or globbing, query the graph first " +
			"using the `graphify` tool. It returns file paths with line numbers that you can feed directly to `read`. " +
			"Only fall back to grep/find if graphify returns no useful results.\n";
	});
}
