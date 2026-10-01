import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "openclaw/plugin-sdk/plugin-test-api";
import { registerSingleProviderPlugin } from "openclaw/plugin-sdk/plugin-test-runtime";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";
import { PRODUCT_SEARCH_PROMPT_HINT } from "./product-search.js";

describe("Gravity provider plugin", () => {
  it("registers Free (Ad-supported) with device auth and provider hooks", async () => {
    const provider = await registerSingleProviderPlugin(plugin);

    expect(provider).toMatchObject({
      id: "gravity",
      label: "Free (Ad-supported)",
      docsPath: "/providers/gravity",
      envVars: ["GRAVITY_API_KEY"],
      buildReplayPolicy: expect.any(Function),
      inspectToolSchemas: expect.any(Function),
      normalizeToolSchemas: expect.any(Function),
    });
    expect(provider?.auth.map((method) => method.id)).toEqual(["api-key", "device-code"]);
  });

  it("exposes Index only on active Gravity turns without another toggle", async () => {
    let toolRegistration: Parameters<OpenClawPluginApi["registerTool"]>[0] | undefined;
    let beforePromptBuild:
      | ((event: unknown, context: { modelProviderId?: string }) => unknown)
      | undefined;

    plugin.register(
      createTestPluginApi({
        registerTool(tool, options) {
          if (options?.name === "product_service_search") {
            toolRegistration = tool;
          }
        },
        on(hookName, handler) {
          if (hookName === "before_prompt_build") {
            beforePromptBuild = handler as typeof beforePromptBuild;
          }
        },
      }),
    );

    expect(typeof toolRegistration).toBe("function");
    const factory = toolRegistration as Exclude<typeof toolRegistration, undefined> &
      ((context: {
        activeModel?: { provider?: string };
        config?: object;
        resolveApiKeyForProvider?: (provider: string) => Promise<string | undefined>;
      }) => unknown);

    expect(factory({ activeModel: { provider: "openai" }, config: {} })).toBeNull();
    expect(factory({ config: {} })).toBeNull();
    expect(
      factory({
        activeModel: { provider: "gravity" },
        config: {},
        resolveApiKeyForProvider: async () => "fixture-key",
      }),
    ).toMatchObject({ name: "product_service_search" });

    expect(await beforePromptBuild?.({}, { modelProviderId: "openai" })).toEqual({});
    expect(await beforePromptBuild?.({}, {})).toEqual({});
    expect(await beforePromptBuild?.({}, { modelProviderId: "gravity" })).toEqual({
      appendSystemContext: PRODUCT_SEARCH_PROMPT_HINT,
    });
  });
});
