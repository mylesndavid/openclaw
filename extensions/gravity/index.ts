// Gravity model provider for OpenClaw. Gravity account sign-in is required, and
// product_service_search is available only while this provider is active.
import type {
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "openclaw/plugin-sdk/provider-model-shared";
import { buildProviderToolCompatFamilyHooks } from "openclaw/plugin-sdk/provider-tools";
import { forGravityProviderTurn, isGravityProviderTurn } from "./activation.js";
import { buildGravityProviderConfig, buildGravityStaticProviderConfig } from "./catalog.js";
import {
  configuredBaseUrl,
  ENV_VAR,
  PROVIDER_ID,
  resolveGravityApiBaseUrl,
  resolveGravityRootUrl,
} from "./config.js";
import { createGravityAuthMethod } from "./device-code.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import {
  PRODUCT_SEARCH_PROMPT_HINT,
  PRODUCT_SEARCH_TOOL_NAME,
  createProductSearchTool,
} from "./product-search.js";
import { fetchGravityUsage } from "./usage.js";

const openAiReplay = buildProviderReplayFamilyHooks({
  family: "openai-compatible",
  dropReasoningFromHistory: false,
});
const openAiTools = buildProviderToolCompatFamilyHooks("openai");

function dynamicModelScope(ctx: ProviderResolveDynamicModelContext): string {
  return JSON.stringify([
    ctx.agentDir ?? "",
    ctx.workspaceDir ?? "",
    ctx.authProfileId ?? "",
    resolveGravityRootUrl(
      // SAFETY: URL helpers read only optional Gravity fields from host-validated config.
      ctx.config as never,
      // SAFETY: configuredBaseUrl reads only the optional Gravity provider base URL.
      ctx.providerConfig?.baseUrl ?? configuredBaseUrl(ctx.config as never),
    ),
  ]);
}

function buildRuntimeModels(
  providerConfig: Awaited<ReturnType<typeof buildGravityProviderConfig>>,
): Map<string, ProviderRuntimeModel> {
  const models = new Map<string, ProviderRuntimeModel>();
  for (const model of providerConfig.models) {
    const api = model.api ?? providerConfig.api;
    const baseUrl = model.baseUrl ?? providerConfig.baseUrl;
    if (!api || !baseUrl) {
      continue;
    }
    models.set(model.id, {
      ...model,
      api,
      baseUrl,
      provider: PROVIDER_ID,
      input: model.input.filter(
        (entry): entry is "text" | "image" => entry === "text" || entry === "image",
      ),
    });
  }
  return models;
}

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Free (Ad-supported)",
  description: "Free AI from Gravity with built-in Gravity Index product and service search",
  manifest,
  provider(api) {
    const dynamicModels = new Map<string, Map<string, ProviderRuntimeModel>>();
    const version = api.version;

    return {
      label: "Free (Ad-supported)",
      docsPath: "/providers/gravity",
      manifestAuth: {
        hint: "Gravity API key",
        noteTitle: "Gravity API key",
        noteMessage: "Use a key from your Gravity dashboard, or sign in with your Gravity account.",
      },
      extraAuth: [createGravityAuthMethod({ version })],
      catalog: {
        order: "simple",
        // Sterile static rows (no key, no network) so `gravity/free-default` has a display name from
        // plugin load; the host swaps in `run`'s live catalog once credentials resolve.
        staticRun: async (ctx) => ({
          provider: buildGravityStaticProviderConfig({
            // SAFETY: configuredBaseUrl reads only the optional Gravity provider base URL.
            baseUrl: configuredBaseUrl(ctx.config as never),
            config: ctx.config,
          }),
        }),
        run: async (ctx) => {
          const auth = ctx.resolveProviderAuth(PROVIDER_ID);
          let apiKey = auth.apiKey ?? auth.discoveryApiKey;
          if (!apiKey) {
            try {
              const { resolveApiKeyForProvider } =
                await import("openclaw/plugin-sdk/provider-auth-runtime");
              apiKey = (
                await resolveApiKeyForProvider({
                  provider: PROVIDER_ID,
                  cfg: ctx.config,
                  ...(ctx.agentDir ? { agentDir: ctx.agentDir } : {}),
                  ...(ctx.workspaceDir ? { workspaceDir: ctx.workspaceDir } : {}),
                  ...(auth.profileId ? { profileId: auth.profileId, lockedProfile: true } : {}),
                })
              )?.apiKey;
            } catch {
              return null;
            }
          }
          if (!apiKey) {
            return null;
          }
          return {
            provider: await buildGravityProviderConfig({
              apiKey,
              // SAFETY: configuredBaseUrl reads only the optional Gravity provider base URL.
              baseUrl: configuredBaseUrl(ctx.config as never),
              config: ctx.config,
            }),
          };
        },
      },
      resolveDynamicModel: (ctx) => dynamicModels.get(dynamicModelScope(ctx))?.get(ctx.modelId),
      preferRuntimeResolvedModel: (ctx) => {
        const agentDir = ctx.agentDir ?? "";
        const workspaceDir = ctx.workspaceDir ?? "";
        const rootUrl = resolveGravityRootUrl(
          // SAFETY: URL helpers read only optional Gravity fields from host-validated config.
          ctx.config as never,
          // SAFETY: configuredBaseUrl reads only the optional Gravity provider base URL.
          configuredBaseUrl(ctx.config as never),
        );
        for (const [scope, models] of dynamicModels) {
          // SAFETY: dynamicModelScope creates this JSON from a fixed four-string tuple.
          const [scopeAgentDir, scopeWorkspaceDir, , scopeRootUrl] = JSON.parse(scope) as string[];
          if (
            scopeAgentDir === agentDir &&
            scopeWorkspaceDir === workspaceDir &&
            scopeRootUrl === rootUrl &&
            models.has(ctx.modelId)
          ) {
            return true;
          }
        }
        return false;
      },
      prepareDynamicModel: async (ctx) => {
        const scope = dynamicModelScope(ctx);
        const { resolveApiKeyForProvider } =
          await import("openclaw/plugin-sdk/provider-auth-runtime");
        const apiKey = (
          await resolveApiKeyForProvider({
            provider: PROVIDER_ID,
            cfg: ctx.config,
            ...(ctx.agentDir ? { agentDir: ctx.agentDir } : {}),
            ...(ctx.workspaceDir ? { workspaceDir: ctx.workspaceDir } : {}),
            ...(ctx.authProfileId ? { profileId: ctx.authProfileId, lockedProfile: true } : {}),
          })
        )?.apiKey;
        if (!apiKey) {
          dynamicModels.delete(scope);
          return;
        }
        const providerConfig = await buildGravityProviderConfig({
          apiKey,
          // SAFETY: configuredBaseUrl reads only the optional Gravity provider base URL.
          baseUrl: ctx.providerConfig?.baseUrl ?? configuredBaseUrl(ctx.config as never),
          config: ctx.config,
        });
        dynamicModels.set(scope, buildRuntimeModels(providerConfig));
      },
      normalizeConfig: ({ providerConfig }) => {
        const baseUrl = resolveGravityApiBaseUrl(undefined, providerConfig.baseUrl);
        return baseUrl !== providerConfig.baseUrl ? { ...providerConfig, baseUrl } : undefined;
      },
      buildReplayPolicy: (ctx) => openAiReplay.buildReplayPolicy?.(ctx),
      normalizeToolSchemas: (ctx) => openAiTools.normalizeToolSchemas(ctx),
      inspectToolSchemas: (ctx) => openAiTools.inspectToolSchemas(ctx),
      isModernModelRef: () => true,
      resolveUsageAuth: async (ctx) => {
        const apiKey = ctx.resolveApiKeyFromConfigAndStore({ envDirect: [ctx.env[ENV_VAR]] });
        return apiKey ? { token: apiKey } : null;
      },
      fetchUsageSnapshot: async (ctx) =>
        await fetchGravityUsage({
          token: ctx.token,
          config: ctx.config,
          // SAFETY: configuredBaseUrl reads only the optional Gravity provider base URL.
          baseUrl: configuredBaseUrl(ctx.config as never),
          timeoutMs: ctx.timeoutMs,
          signal: ctx.signal,
        }),
    };
  },
  register(api) {
    // The Index tool and its system guidance are present only on Gravity-provider turns.
    api.on("before_prompt_build", (_event, ctx) => {
      const gravityTurn = isGravityProviderTurn(ctx.modelProviderId);
      return gravityTurn ? { appendSystemContext: PRODUCT_SEARCH_PROMPT_HINT } : {};
    });

    // The factory runs per turn. Missing or non-Gravity active-provider metadata fails closed,
    // so another provider can never see or call the bundled Gravity Index tool.
    // The manifest must list it under contracts.tools or registration is refused.
    api.registerTool(
      (ctx) =>
        forGravityProviderTurn(ctx.activeModel?.provider, () => {
          // SAFETY: OpenClaw validates runtime, turn, and startup config before plugin dispatch.
          const cfg = (ctx.runtimeConfig ?? ctx.config ?? api.config) as never;
          const rootUrl = resolveGravityRootUrl(cfg, configuredBaseUrl(cfg));
          return createProductSearchTool({
            rootUrl,
            clientVersion: api.version,
            log: api.logger,
            resolveApiKey: async () => {
              const fromHost = await ctx.resolveApiKeyForProvider?.(PROVIDER_ID);
              if (fromHost) {
                return fromHost;
              }
              try {
                const { resolveApiKeyForProvider } =
                  await import("openclaw/plugin-sdk/provider-auth-runtime");
                return (
                  await resolveApiKeyForProvider({
                    provider: PROVIDER_ID,
                    cfg: ctx.config ?? api.config,
                    ...(ctx.agentDir ? { agentDir: ctx.agentDir } : {}),
                    ...(ctx.workspaceDir ? { workspaceDir: ctx.workspaceDir } : {}),
                  })
                )?.apiKey;
              } catch {
                return undefined;
              }
            },
          });
        }),
      { name: PRODUCT_SEARCH_TOOL_NAME },
    );
  },
});
