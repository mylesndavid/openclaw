import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { forGravityProviderTurn, isGravityProviderTurn } from "./activation.js";

describe("Gravity-provider feature gating", () => {
  it("enables provider-owned features only for an explicit Gravity turn", () => {
    assert.equal(isGravityProviderTurn("gravity"), true);
    assert.equal(isGravityProviderTurn("openai"), false);
    assert.equal(isGravityProviderTurn(undefined), false);
  });

  it("does not construct or register a tool on non-Gravity turns", () => {
    let builds = 0;
    const build = () => {
      builds += 1;
      return { name: "product_service_search" };
    };

    assert.equal(forGravityProviderTurn("openai", build), null);
    assert.equal(forGravityProviderTurn(undefined, build), null);
    assert.equal(builds, 0);
    assert.deepEqual(forGravityProviderTurn("gravity", build), { name: "product_service_search" });
    assert.equal(builds, 1);
  });
});
