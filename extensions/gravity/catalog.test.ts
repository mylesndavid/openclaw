// Static fallback catalog tests. Run with Node's built-in type stripping:
//   node --test plugins/gravity-provider/catalog.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearLiveCatalogCacheForTests,
  type LiveModelCatalogFetchGuard,
} from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { beforeEach, describe, it, vi } from "vitest";
import {
  STATIC_PROVIDER,
  buildGravityProviderConfig,
  buildGravityStaticProviderConfig,
} from "./test-api.js";

const manifest = JSON.parse(
  readFileSync(new URL("./openclaw.plugin.json", import.meta.url), "utf8"),
) as {
  modelCatalog?: { discovery?: Record<string, string>; providers?: Record<string, unknown> };
};
beforeEach(() => {
  clearLiveCatalogCacheForTests();
});

describe("static fallback catalog (before the live /v1/catalog lands)", () => {
  it("uses Chat Completions for the current Free (Ad-supported) catalog", () => {
    const cfg = buildGravityStaticProviderConfig();
    const def = cfg.models.find((m) => m.id === "free-default");
    assert.ok(def, "free-default is in the static catalog");
    assert.equal(def.name, "Free (Ad-supported)");
    assert.equal(cfg.baseUrl, "https://openclaw.trygravity.ai/v1");
    assert.equal(cfg.api, "openai-completions");
    assert.equal(def.api, "openai-completions");
    assert.ok(
      cfg.models.every((model) => model.api !== "openai-responses"),
      "current catalog cannot route to /responses",
    );
    for (const m of cfg.models) {
      assert.notEqual(m.name, m.id);
      assert.ok(!m.name.startsWith("Free (Ad-supported) · "), `${m.id} has a real display name`);
      assert.equal(m.cost.input, 0);
      assert.equal(m.cost.output, 0);
    }
  });

  it("honours the configured base URL like the live catalog does", () => {
    const cfg = buildGravityStaticProviderConfig({
      config: { models: { providers: { gravity: { baseUrl: "http://127.0.0.1:18901/v1" } } } },
    });
    assert.equal(cfg.baseUrl, "http://127.0.0.1:18901/v1");
    assert.equal(cfg.models[0]?.baseUrl, "http://127.0.0.1:18901/v1");
  });

  it("manifest declares runtime discovery so the live catalog replaces the static seed", () => {
    // Static manifest rows (no `discovery`) would count as complete coverage and the host would
    // never run `catalog.run`; `runtime` is what bundled openrouter/arcee declare for this shape.
    assert.equal(manifest.modelCatalog?.discovery?.gravity, "runtime");
    assert.equal(manifest.modelCatalog?.providers, undefined);
    assert.ok(STATIC_PROVIDER.models.some((m) => m.id === "free-default"));
  });
});

describe("live catalog API selection", () => {
  it("uses Responses as the provider fallback only when the default model advertises it", async () => {
    const fetchGuard = vi.fn<LiveModelCatalogFetchGuard>(async () => ({
      response: Response.json({
        providers: [
          {
            id: "gravity",
            displayName: "Gravity",
            openaiCompatible: true,
            models: [
              { id: "free-default", capabilities: ["llm.responses"] },
              { id: "free-chat", capabilities: ["llm.chat"] },
            ],
          },
        ],
      }),
      finalUrl: "https://responses-fixture.example/v1/catalog",
      release: async () => undefined,
    }));

    const cfg = await buildGravityProviderConfig({
      apiKey: "gk_responses_fixture",
      baseUrl: "https://responses-fixture.example/v1",
      fetchGuard,
    });

    assert.equal(cfg.api, "openai-responses");
    assert.equal(cfg.models.find((model) => model.id === "free-default")?.api, "openai-responses");
    assert.equal(cfg.models.find((model) => model.id === "free-chat")?.api, "openai-completions");
  });
});
