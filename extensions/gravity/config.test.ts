import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  DEFAULT_ACCOUNT_URL,
  DEFAULT_MODEL_BASE_URL,
  resolveGravityAccountUrl,
  resolveGravityApiBaseUrl,
  resolveGravityRootUrl,
} from "./test-api.js";

const originalAccountUrl = process.env.GRAVITY_ACCOUNT_URL;
const originalModelBaseUrl = process.env.GRAVITY_MODEL_BASE_URL;

afterEach(() => {
  if (originalAccountUrl === undefined) {
    delete process.env.GRAVITY_ACCOUNT_URL;
  } else {
    process.env.GRAVITY_ACCOUNT_URL = originalAccountUrl;
  }
  if (originalModelBaseUrl === undefined) {
    delete process.env.GRAVITY_MODEL_BASE_URL;
  } else {
    process.env.GRAVITY_MODEL_BASE_URL = originalModelBaseUrl;
  }
});

describe("Gravity account and inference endpoints", () => {
  it("keeps hosted device auth separate from the model provider base URL", () => {
    delete process.env.GRAVITY_ACCOUNT_URL;
    delete process.env.GRAVITY_MODEL_BASE_URL;

    assert.equal(resolveGravityAccountUrl(undefined), DEFAULT_ACCOUNT_URL);
    assert.equal(DEFAULT_ACCOUNT_URL, "https://openclaw.trygravity.ai");
    assert.equal(resolveGravityApiBaseUrl(undefined), DEFAULT_MODEL_BASE_URL);
    assert.equal(DEFAULT_MODEL_BASE_URL, "https://llm.trygravity.ai/v1");
    assert.equal(resolveGravityRootUrl(undefined), "https://llm.trygravity.ai");
  });

  it("reads inference from the OpenClaw model-provider config shape", () => {
    const config = {
      models: { providers: { gravity: { baseUrl: "https://inference.example/v1" } } },
      plugins: { entries: { gravity: { config: { accountUrl: "https://accounts.example" } } } },
    };

    assert.equal(resolveGravityAccountUrl(config), "https://accounts.example");
    assert.equal(resolveGravityApiBaseUrl(config), "https://inference.example/v1");
    assert.equal(resolveGravityRootUrl(config), "https://inference.example");
  });
});
