import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface RouterModel {
	id: string;
	name?: string;
	context_window?: number;
	max_tokens?: number;
	input_modalities?: string[];
}

interface ModelsResponse {
	data?: RouterModel[];
}

const DEFAULT_BASE_URL = "http://localhost:20128/v1";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_MODELS: RouterModel[] = [{ id: "9router/model" }];

function getBaseUrl(): string {
	return process.env.NINE_ROUTER_BASE_URL ?? DEFAULT_BASE_URL;
}

function getApiKey(): string {
	return process.env.NINE_ROUTER_API_KEY ?? "";
}

function fromEnvModels(): RouterModel[] {
	const raw = process.env.NINE_ROUTER_MODELS;
	if (!raw) return [];

	return raw
		.split(",")
		.map((id) => id.trim())
		.filter((id) => id.length > 0)
		.map((id) => ({ id }));
}

function isModelsResponse(value: unknown): value is ModelsResponse {
	if (typeof value !== "object" || value === null) return false;
	const data = (value as { data?: unknown }).data;
	return data === undefined || Array.isArray(data);
}

async function fetchModels(baseUrl: string, apiKey: string): Promise<RouterModel[]> {
	if (!apiKey) return [];

	try {
		const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!response.ok) return [];

		const body: unknown = await response.json();
		if (!isModelsResponse(body)) return [];

		return (body.data ?? []).filter((model) => typeof model.id === "string" && model.id.length > 0);
	} catch {
		return [];
	}
}

export default async function (pi: ExtensionAPI) {
	const baseUrl = getBaseUrl();
	const discoveredModels = (await fetchModels(baseUrl, getApiKey())).concat(fromEnvModels());
	const models = discoveredModels.length > 0 ? discoveredModels : DEFAULT_MODELS;
	const uniqueModels = Array.from(new Map(models.map((model) => [model.id, model])).values());

	pi.registerProvider("9router", {
		name: "9router",
		baseUrl,
		apiKey: "$NINE_ROUTER_API_KEY",
		api: "openai-completions",
		models: uniqueModels.map((model) => ({
			id: model.id,
			name: model.name ?? model.id,
			reasoning: true,
			input: model.input_modalities?.includes("image") ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.context_window ?? DEFAULT_CONTEXT_WINDOW,
			maxTokens: model.max_tokens ?? DEFAULT_MAX_TOKENS,
			compat: {
				thinkingFormat: "openrouter",
				sessionAffinityFormat: "openrouter",
			},
		})),
	});
}
