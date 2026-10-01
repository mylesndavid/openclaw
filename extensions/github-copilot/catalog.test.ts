import { buildManifestModelProviderConfig } from "openclaw/plugin-sdk/provider-catalog-shared";
import { describe, expect, it } from "vitest";
import manifest from "./openclaw.plugin.json" with { type: "json" };

describe("GitHub Copilot bundled model catalog", () => {
  it("includes Claude Sonnet 5.5 when live discovery is unavailable", () => {
    const { models } = buildManifestModelProviderConfig({
      providerId: "github-copilot",
      catalog: manifest.modelCatalog.providers["github-copilot"],
    });

    expect(models.find((model) => model.id === "claude-sonnet-5.5")).toMatchObject({
      id: "claude-sonnet-5.5",
      name: "Claude Sonnet 5.5",
      api: "anthropic-messages",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      compat: { codeMode: "capable" },
    });
  });
});
