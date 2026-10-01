// Gravity catalog: ClawRouter-shaped `GET /v1/catalog`, OpenAI-compatible routes only.
import {
  getCachedLiveProviderModelRows,
  type LiveModelCatalogFetchGuard,
} from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "openclaw/plugin-sdk/provider-model-shared";
import { PROVIDER_ID, resolveGravityRootUrl } from "./config.js";

const CATALOG_CACHE_TTL_MS = 60_000;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 32_768;

const REASONING_EFFORT_LEVELS = [
  ["none", "off"],
  ["minimal", "minimal"],
  ["low", "low"],
  ["medium", "medium"],
  ["high", "high"],
  ["xhigh", "xhigh"],
] as const;
type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number][0];

type CatalogModel = {
  id: string;
  displayName?: string;
  upstream?: string;
  capabilities: string[];
  supportedReasoningEfforts?: ReasoningEffort[];
  pricing?: {
    inputMicrosPerMillion?: number;
    outputMicrosPerMillion?: number;
    cachedInputMicrosPerMillion?: number;
    maxInputTokens?: number;
    defaultMaxOutputTokens?: number;
  };
};

type CatalogProvider = {
  id: string;
  displayName: string;
  openaiCompatible: boolean;
  models: CatalogModel[];
};

/**
 * Static fallback for the free-tier menu (gravity-service/src/menu.mjs BUILTIN_OPENROUTER_MENU).
 * Published at plugin load, before any key exists, so the picker never shows the raw
 * `gravity/free-default` ref; the dynamic `GET /v1/catalog` result replaces these rows as soon as
 * it lands (rows the live catalog does not return are dropped by the host). Same pattern as
 * extensions/clawrouter's manifest rows + `catalog.run`. Prices are always 0 on the free tier.
 */
export const STATIC_PROVIDER: CatalogProvider = {
  id: PROVIDER_ID,
  displayName: "Free (Ad-supported)",
  openaiCompatible: true,
  models: [
    {
      id: "free-default",
      displayName: "Free (Ad-supported)",
      upstream: "z-ai/glm-5.3-flash",
      capabilities: ["llm.chat"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      pricing: { maxInputTokens: 1_048_576, defaultMaxOutputTokens: 8_192 },
    },
    {
      id: "free-deepseek",
      displayName: "Free (DeepSeek V4 Flash)",
      upstream: "deepseek/deepseek-v4-flash",
      capabilities: ["llm.chat"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      pricing: { maxInputTokens: 1_048_576, defaultMaxOutputTokens: 8_192 },
    },
    {
      id: "free-qwen",
      displayName: "Free (Qwen3.7 Flash)",
      upstream: "qwen/qwen3.7-flash",
      capabilities: ["llm.chat"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      pricing: { maxInputTokens: 1_000_000, defaultMaxOutputTokens: 8_192 },
    },
    {
      id: "free-mini",
      displayName: "Free mini (gpt-oss-20b)",
      upstream: "openai/gpt-oss-20b",
      capabilities: ["llm.chat"],
      supportedReasoningEfforts: ["low", "medium", "high"],
      pricing: { maxInputTokens: 131_072, defaultMaxOutputTokens: 8_192 },
    },
  ],
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseModel(row: unknown): CatalogModel | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  // SAFETY: the object guard above narrows the unknown catalog row to keyed data.
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  if (!id) {
    return undefined;
  }
  const advertised: unknown[] = Array.isArray(r.supportedReasoningEfforts)
    ? r.supportedReasoningEfforts
    : [];
  const efforts = REASONING_EFFORT_LEVELS.map(([e]) => e).filter((e) => advertised.includes(e));
  const pricing =
    // SAFETY: pricing is read only after this object guard succeeds.
    r.pricing && typeof r.pricing === "object" ? (r.pricing as Record<string, unknown>) : undefined;
  return {
    id,
    displayName: str(r.displayName),
    upstream: str(r.upstream),
    capabilities: Array.isArray(r.capabilities)
      ? r.capabilities.filter((c): c is string => typeof c === "string")
      : [],
    supportedReasoningEfforts: efforts.length > 0 ? efforts : undefined,
    pricing: pricing
      ? {
          inputMicrosPerMillion: num(pricing.inputMicrosPerMillion),
          outputMicrosPerMillion: num(pricing.outputMicrosPerMillion),
          cachedInputMicrosPerMillion: num(pricing.cachedInputMicrosPerMillion),
          maxInputTokens: num(pricing.maxInputTokens),
          defaultMaxOutputTokens: num(pricing.defaultMaxOutputTokens),
        }
      : undefined,
  };
}

function parseProvider(row: unknown): CatalogProvider | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  // SAFETY: the object guard above narrows the unknown provider row to keyed data.
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  if (!id) {
    return undefined;
  }
  return {
    id,
    displayName: str(r.displayName) ?? id,
    openaiCompatible: r.openaiCompatible === true,
    models: Array.isArray(r.models)
      ? r.models.map(parseModel).filter((m): m is CatalogModel => Boolean(m))
      : [],
  };
}

function readCatalogRows(body: unknown): readonly unknown[] {
  const providers =
    // SAFETY: this assertion follows the object guard and only reads an optional field.
    body && typeof body === "object" ? (body as { providers?: unknown }).providers : undefined;
  if (!Array.isArray(providers)) {
    throw new Error("Gravity catalog response must contain providers[]");
  }
  return providers;
}

async function fetchCatalog(
  rootUrl: string,
  apiKey: string,
  fetchGuard?: LiveModelCatalogFetchGuard,
): Promise<CatalogProvider[]> {
  const rows = await getCachedLiveProviderModelRows({
    providerId: PROVIDER_ID,
    endpoint: `${rootUrl}/v1/catalog`,
    apiKey,
    discoveryApiKey: apiKey,
    fetchGuard,
    readRows: readCatalogRows,
    ttlMs: CATALOG_CACHE_TTL_MS,
    shouldCacheRows: (providers) => providers.length > 0,
    auditContext: "gravity-model-discovery",
  });
  return rows
    .map(parseProvider)
    .filter((provider): provider is CatalogProvider => Boolean(provider));
}

function microsToCost(value: number | undefined): number {
  return value === undefined ? 0 : value / 1_000_000;
}

function buildModel(
  rootUrl: string,
  provider: CatalogProvider,
  model: CatalogModel,
): ModelDefinitionConfig | undefined {
  if (!provider.openaiCompatible) {
    return undefined;
  }
  const api: ModelDefinitionConfig["api"] = model.capabilities.includes("llm.responses")
    ? "openai-responses"
    : model.capabilities.includes("llm.chat")
      ? "openai-completions"
      : undefined;
  if (!api) {
    return undefined;
  }
  const efforts = model.supportedReasoningEfforts;
  const thinkingLevelMap: NonNullable<ModelDefinitionConfig["thinkingLevelMap"]> = {};
  if (efforts) {
    const supported = new Set(efforts);
    for (const [effort, level] of REASONING_EFFORT_LEVELS) {
      thinkingLevelMap[level] = supported.has(effort) ? effort : null;
    }
  }
  return {
    id: model.id,
    name: model.displayName ?? `${provider.displayName} · ${model.id}`,
    api,
    baseUrl: `${rootUrl}/v1`,
    reasoning: Boolean(efforts) || /gpt-5|gpt-oss|o[1-9]/u.test(model.upstream ?? model.id),
    ...(efforts
      ? {
          thinkingLevelMap,
          compat: { supportsReasoningEffort: true, supportedReasoningEfforts: efforts },
        }
      : {}),
    input: ["text", "image"],
    cost: {
      input: microsToCost(model.pricing?.inputMicrosPerMillion),
      output: microsToCost(model.pricing?.outputMicrosPerMillion),
      cacheRead: microsToCost(model.pricing?.cachedInputMicrosPerMillion),
      cacheWrite: 0,
    },
    contextWindow: model.pricing?.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.pricing?.defaultMaxOutputTokens ?? DEFAULT_MAX_TOKENS,
  };
}

function buildModels(rootUrl: string, providers: CatalogProvider[]): ModelDefinitionConfig[] {
  const models = new Map<string, ModelDefinitionConfig>();
  for (const provider of providers) {
    for (const model of provider.models) {
      const built = buildModel(rootUrl, provider, model);
      if (built && !models.has(built.id)) {
        models.set(built.id, built);
      }
    }
  }
  return [...models.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

function deriveProviderApi(
  models: ModelDefinitionConfig[],
): NonNullable<ModelProviderConfig["api"]> {
  const advertisedApis = new Set(
    models
      .map((model) => model.api)
      .filter((api): api is NonNullable<ModelDefinitionConfig["api"]> => api !== undefined),
  );
  if (advertisedApis.size === 1) {
    // SAFETY: a set with exactly one member always returns that API value from next().
    return advertisedApis.values().next().value as NonNullable<ModelProviderConfig["api"]>;
  }
  return models.find((model) => model.id === "free-default")?.api ?? "openai-completions";
}

/** Static (no-key, no-network) provider config from STATIC_PROVIDER; host's `staticCatalog` path. */
export function buildGravityStaticProviderConfig(
  params: { baseUrl?: string; config?: unknown } = {},
): ModelProviderConfig {
  // SAFETY: URL resolution reads only optional provider fields from host-validated config.
  const rootUrl = resolveGravityRootUrl(params.config as never, params.baseUrl);
  const models = buildModels(rootUrl, [STATIC_PROVIDER]);
  return {
    baseUrl: `${rootUrl}/v1`,
    api: deriveProviderApi(models),
    models,
  };
}

export async function buildGravityProviderConfig(params: {
  apiKey: string;
  baseUrl?: string;
  config?: unknown;
  fetchGuard?: LiveModelCatalogFetchGuard;
}): Promise<ModelProviderConfig> {
  // SAFETY: URL resolution reads only optional provider fields from host-validated config.
  const rootUrl = resolveGravityRootUrl(params.config as never, params.baseUrl);
  const providers = await fetchCatalog(rootUrl, params.apiKey, params.fetchGuard);
  const models = buildModels(rootUrl, providers);
  return {
    baseUrl: `${rootUrl}/v1`,
    api: deriveProviderApi(models),
    apiKey: params.apiKey,
    models,
  };
}
