import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

const runtimeFiles = [
  "activation.ts",
  "catalog.ts",
  "config.ts",
  "device-code.ts",
  "index.ts",
  "product-search.ts",
  "usage.ts",
];

const forbiddenRuntimeMarkers = [
  ["gravity", "_ad"].join(""),
  ["/v1/turns/", "ad"].join(""),
  ["bea", "con"].join(""),
  ["transform_", "llm_output"].join(""),
  ["llm_", "request"].join(""),
  ["X-OpenClaw-", "Turn"].join(""),
  ["wrap", "StreamFn"].join(""),
  ["wrapSimpleCompletion", "StreamFn"].join(""),
  ["organic-", "marker"].join(""),
  ["carousel-", "render"].join(""),
  ["canvas-", "document"].join(""),
  ["attach", "Widget"].join(""),
  ["render", "Carousel"].join(""),
  ["sponsored", "-cards"].join(""),
  ["sponsored", "-channel-messages"].join(""),
] as const;

describe("plugin-only runtime boundary", () => {
  it("ships no ad-delivery files or runtime markers", () => {
    for (const removedFile of ["stream.ts", "surface.ts", "organic-widget.ts"]) {
      assert.equal(
        existsSync(new URL(removedFile, import.meta.url)),
        false,
        `${removedFile} must not ship`,
      );
    }

    for (const file of runtimeFiles) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const marker of forbiddenRuntimeMarkers) {
        assert.equal(
          text.includes(marker),
          false,
          `${file} contains forbidden ad-delivery marker ${marker}`,
        );
      }
    }
  });
});
