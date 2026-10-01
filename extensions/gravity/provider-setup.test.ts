import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import {
  DEFAULT_MODEL_REF,
  GRAVITY_CHOICE_ID,
  GRAVITY_LABEL,
  GRAVITY_METHOD_ID,
  GRAVITY_PROFILE_ID,
  createGravityAuthMethod,
  runGravityLogin,
} from "./test-api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Free (Ad-supported) setup metadata", () => {
  it("keeps the manifest choice aligned with the runtime device-code method", () => {
    const choice = manifest.providerAuthChoices[0];
    const method = createGravityAuthMethod();

    assert.ok(choice);
    assert.ok(choice.channelLogin);
    assert.equal(manifest.name, GRAVITY_LABEL);
    assert.equal(choice.provider, "gravity");
    assert.equal(choice.method, GRAVITY_METHOD_ID);
    assert.equal(choice.choiceId, GRAVITY_CHOICE_ID);
    assert.equal(choice.choiceLabel, GRAVITY_LABEL);
    assert.equal(choice.groupLabel, GRAVITY_LABEL);
    assert.equal(choice.appGuidedAuth, "device-code");
    assert.deepEqual(choice.channelLogin.aliases, ["gravity", "free"]);
    assert.equal(GRAVITY_LABEL, "Free (Ad-supported)");
    assert.doesNotMatch(
      JSON.stringify({ description: manifest.description, choice }),
      /sponsored message/i,
    );
    assert.equal(method.id, choice.method);
    assert.equal(method.kind, "device_code");
    assert.equal(method.label, choice.choiceLabel);
    assert.equal(method.wizard?.choiceId, choice.choiceId);
    assert.equal(method.wizard?.modelSelection?.promptWhenAuthChoiceProvided, false);
    assert.equal(method.wizard?.modelSelection?.allowKeepCurrent, false);
  });
});

describe("Free (Ad-supported) device-code completion", () => {
  it("stores the credential, applies the token endpoint, and selects gravity/free-default", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url.endsWith("/oauth/device/code")) {
        return new Response(
          JSON.stringify({
            device_code: "device-secret",
            user_code: "ABCD-EFGH",
            verification_uri: "https://openclaw.trygravity.ai/device",
            verification_uri_complete: "https://openclaw.trygravity.ai/device?code=ABCD-EFGH",
            interval: 0,
            expires_in: 60,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          api_key: "gk_free_test",
          key_id: "key-1",
          tier: "free",
          baseUrl: "https://inference.example/v1",
        }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;

    const progressStops: string[] = [];
    const devicePrompts: unknown[] = [];
    const result = await runGravityLogin(
      {
        config: {},
        isRemote: true,
        prompter: {
          progress: () => ({ stop: (message: string) => progressStops.push(message) }),
          deviceCode: async (prompt: unknown) => {
            devicePrompts.push(prompt);
          },
        },
        runtime: { log: () => undefined },
      } as never,
      { sleep: async () => undefined },
    );

    assert.deepEqual(requests, [
      "https://openclaw.trygravity.ai/oauth/device/code",
      "https://openclaw.trygravity.ai/oauth/device/token",
    ]);
    assert.equal(devicePrompts.length, 1);
    assert.match(
      JSON.stringify(devicePrompts[0]),
      /https:\/\/openclaw\.trygravity\.ai\/device\?code=ABCD-EFGH/,
    );
    assert.equal(result.profiles[0]?.profileId, GRAVITY_PROFILE_ID);
    assert.deepEqual(result.profiles[0]?.credential, {
      type: "api_key",
      provider: "gravity",
      key: "gk_free_test",
      displayName: GRAVITY_LABEL,
      metadata: { tier: "free", keyId: "key-1" },
    });
    assert.equal(result.defaultModel, DEFAULT_MODEL_REF);
    assert.deepEqual(result.configPatch, {
      models: {
        providers: {
          gravity: {
            baseUrl: "https://inference.example/v1",
            api: "openai-completions",
            models: [],
          },
        },
      },
      agents: { defaults: { models: { [DEFAULT_MODEL_REF]: { alias: GRAVITY_LABEL } } } },
    });
    assert.match(result.notes?.[0] ?? "", /sign-in completed/);
    assert.ok(
      progressStops.includes("Signed in — Free (Ad-supported) and Index search are enabled"),
    );
  });
});
