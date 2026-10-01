// node --test product-search.test.ts (Node ≥ 22.6 strips types natively)
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import {
  PRODUCT_SEARCH_PARAMETERS,
  PRODUCT_SEARCH_PROMPT_HINT,
  PRODUCT_SEARCH_RESULT_INSTRUCTION,
  PRODUCT_SEARCH_TOOL_NAME,
  callProductSearch,
  createProductSearchTool,
  formatProductSearchResult,
  normalizeProductSearchArgs,
} from "./test-api.js";

const sample = {
  query: "mechanical keyboard under $100",
  vertical: "auto" as const,
  vertical_used: ["services", "products"] as ("services" | "products")[],
  counts: { services: 0, products: 2 },
  attribution: "via Gravity Index",
  search_id: "s1",
  search_ids: { services: "svc1", products: "s1" },
  summary: "Full keyboards under budget.",
  results: [
    {
      kind: "product" as const,
      title: "S98 96% Wireless Mechanical Keyboard",
      merchant: "RK Royal Kludge",
      price: 89.99,
      currency: "USD",
      url: "https://index.trygravity.ai/go/a",
      image_url: null,
      why: "Hot-swappable, tri-mode.",
    },
    {
      kind: "product" as const,
      title: "GALATIN PRO K719",
      merchant: "Redragonshop",
      price: 79.99,
      currency: "USD",
      url: "https://index.trygravity.ai/go/b",
      image_url: null,
      regular_price: 99.99,
    },
  ],
};

/** Merged services + products answer, as the service returns it for a dev query in auto mode. */
const mixed = {
  query: "managed postgres for a side project",
  vertical: "auto" as const,
  vertical_used: ["services", "products"] as ("services" | "products")[],
  counts: { services: 4, products: 5 },
  attribution: "via Gravity Index",
  search_id: "svc-search-1",
  search_ids: { services: "svc-search-1", products: "search-1" },
  summary:
    "While the user asked for Postgres, MongoDB Atlas is the only candidate with a free-forever tier.",
  results: [
    {
      kind: "service" as const,
      title: "MongoDB Atlas",
      merchant: "MongoDB Atlas",
      category: "Database",
      price: null,
      currency: null,
      url: "https://index.trygravity.ai/go/go-atlas",
      image_url: null,
      why: "Recommend MongoDB Atlas for teams building new applications who want a fully managed database.",
    },
    {
      kind: "service" as const,
      title: "Neon",
      merchant: "Neon",
      category: "Database",
      price: null,
      currency: null,
      url: "https://index.trygravity.ai/go/go-neon",
      image_url: null,
      why: "Neon is a serverless Postgres provider that is ideal for side projects. Serverless Postgres with branching.",
    },
    {
      kind: "product" as const,
      title: "PostgreSQL: Up and Running",
      merchant: "Bookshop",
      price: 39.99,
      currency: "USD",
      url: "https://index.trygravity.ai/go/book",
      image_url: null,
    },
  ],
};

describe(`${PRODUCT_SEARCH_TOOL_NAME} schema + manifest`, () => {
  it("has no empty-object params, requires only query, and offers the vertical enum", () => {
    for (const [name, def] of Object.entries(PRODUCT_SEARCH_PARAMETERS.properties)) {
      assert.notEqual(
        (def as { type: string }).type,
        "object",
        `${name} must not be an object param`,
      );
      assert.ok(
        (def as { description: string }).description.length > 10,
        `${name} needs a description`,
      );
    }
    assert.deepEqual(PRODUCT_SEARCH_PARAMETERS.required, ["query"]);
    assert.equal(PRODUCT_SEARCH_PARAMETERS.additionalProperties, false);
    assert.deepEqual(PRODUCT_SEARCH_PARAMETERS.properties.vertical.enum, [
      "services",
      "products",
      "auto",
    ]);
    assert.equal(PRODUCT_SEARCH_PARAMETERS.properties.vertical.default, "auto");
  });

  it("is named product_service_search everywhere the host checks", () => {
    assert.equal(PRODUCT_SEARCH_TOOL_NAME, "product_service_search");
    assert.deepEqual(manifest.contracts.tools, [PRODUCT_SEARCH_TOOL_NAME]);
    assert.deepEqual(Object.keys(manifest.toolMetadata), [PRODUCT_SEARCH_TOOL_NAME]);
    assert.deepEqual(manifest.toolMetadata.product_service_search.authSignals, [
      { provider: "gravity" },
    ]);
    const authChoice = manifest.providerAuthChoices[0];
    assert.ok(authChoice);
    assert.match(authChoice.choiceHint, /product & service search/);
    assert.ok(PRODUCT_SEARCH_PROMPT_HINT.startsWith(`You have ${PRODUCT_SEARCH_TOOL_NAME}.`));
    assert.match(PRODUCT_SEARCH_PROMPT_HINT, /databases, hosting, SaaS, hardware, consumer goods/);
  });
});

describe("normalizeProductSearchArgs", () => {
  it("requires query; coerces the rest; drops unknown keys", () => {
    assert.throws(() => normalizeProductSearchArgs({}), /non-empty `query`/);
    assert.deepEqual(
      normalizeProductSearchArgs({
        query: " shoes ",
        intent: "gift",
        max_results: "12",
        budget_usd: "$120",
        country: "us",
        extra: 1,
      }),
      { query: "shoes", intent: "gift", max_results: 8, budget_usd: 120, country: "US" },
    );
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", intent: "steal", max_results: 0 }), {
      query: "x",
      max_results: 1,
    });
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", budget_usd: 0.01 }), { query: "x" });
  });

  it("passes vertical through, maps obvious synonyms, and leaves auto to the service default", () => {
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", vertical: "services" }), {
      query: "x",
      vertical: "services",
    });
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", vertical: "Products" }), {
      query: "x",
      vertical: "products",
    });
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", vertical: "service" }), {
      query: "x",
      vertical: "services",
    });
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", vertical: "auto" }), { query: "x" });
    assert.deepEqual(normalizeProductSearchArgs({ query: "x", vertical: "everything" }), {
      query: "x",
    });
  });
});

describe("formatProductSearchResult", () => {
  it("renders products as title — merchant — price, structured JSON, and the instruction line last", () => {
    const text = formatProductSearchResult(sample);
    const lines = text.split("\n");
    assert.equal(lines[0], 'Search results for "mechanical keyboard under $100" — 2 products:');
    assert.equal(
      lines[1],
      "1. [S98 96% Wireless Mechanical Keyboard](https://index.trygravity.ai/go/a) — RK Royal Kludge — $89.99",
    );
    assert.equal(lines[2], "   Hot-swappable, tri-mode.");
    assert.match(
      text,
      /2\. \[GALATIN PRO K719\]\(https:\/\/index\.trygravity\.ai\/go\/b\) — Redragonshop — \$79\.99 \(was \$99\.99\)/,
    );
    assert.ok(!text.includes("via Gravity Index"), "no attribution in the model-facing text");
    assert.equal(lines.at(-1), PRODUCT_SEARCH_RESULT_INSTRUCTION);
    const jsonLine = lines[lines.indexOf("```json") + 1];
    assert.ok(jsonLine);
    const parsed = JSON.parse(jsonLine);
    assert.deepEqual(parsed.vertical_used, ["services", "products"]);
    assert.equal(parsed.results.length, 2);
  });

  it("renders services as name — category (service) with the why, mixed with products", () => {
    const text = formatProductSearchResult(mixed);
    const lines = text.split("\n");
    assert.equal(
      lines[0],
      'Search results for "managed postgres for a side project" — 2 services, 1 product:',
    );
    assert.equal(
      lines[1],
      "1. [MongoDB Atlas](https://index.trygravity.ai/go/go-atlas) — Database (service)",
    );
    assert.equal(
      lines[2],
      "   Recommend MongoDB Atlas for teams building new applications who want a fully managed database.",
    );
    assert.equal(
      lines[3],
      "2. [Neon](https://index.trygravity.ai/go/go-neon) — Database (service)",
    );
    assert.equal(
      lines[5],
      "3. [PostgreSQL: Up and Running](https://index.trygravity.ai/go/book) — Bookshop — $39.99",
    );
    assert.match(text, /^Notes: While the user asked for Postgres/m);
    assert.ok(!text.includes("price n/a"), "services never show a fake price");
    assert.equal(lines.at(-1), PRODUCT_SEARCH_RESULT_INSTRUCTION);
  });

  it("notes a partially failed vertical and explains an empty result", () => {
    const partial = formatProductSearchResult({
      ...sample,
      vertical_used: ["products"],
      errors: { services: "timeout" },
    });
    assert.match(
      partial,
      /\(services search unavailable this time; results above are from products\.\)/,
    );
    const text = formatProductSearchResult({ ...sample, results: [] });
    assert.match(
      text,
      /No matches found for "mechanical keyboard under \$100" in services \+ products search/,
    );
    assert.ok(!text.includes(PRODUCT_SEARCH_RESULT_INSTRUCTION));
  });
});

describe("callProductSearch + tool", () => {
  it("posts to the Index service with the free key and client version; surfaces service errors", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      calls.push({ url: requestUrl, init: init ?? {} });
      return new Response(JSON.stringify(sample), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const data = await callProductSearch({
      rootUrl: "http://127.0.0.1:1",
      apiKey: "gk_free_x",
      args: { query: "kb", vertical: "services" },
      clientVersion: "1.2.3",
      fetchImpl,
    });
    assert.equal(data.results.length, 2);
    const call = calls[0];
    assert.ok(call);
    assert.equal(
      call.url,
      "http://127.0.0.1:1/v1/tools/product_search",
      "wire path is unchanged by the rename",
    );
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer gk_free_x");
    assert.equal(headers["X-Gravity-Client"], "openclaw/1.2.3");
    assert.equal(headers["X-Gravity-Agent-Id"], undefined);
    assert.equal(headers["X-Gravity-Session-Id"], undefined);
    const body = JSON.parse(call.init.body as string);
    assert.equal(body.query, "kb");
    assert.equal(body.vertical, "services");

    const failing = (async () =>
      new Response(JSON.stringify({ error: { message: "nope", code: "rate_limited" } }), {
        status: 429,
      })) as typeof fetch;
    await assert.rejects(
      callProductSearch({
        rootUrl: "http://127.0.0.1:1",
        apiKey: "k",
        args: { query: "kb" },
        fetchImpl: failing,
      }),
      /nope/,
    );
  });

  it("tool execute returns text + details and refuses without a key", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(mixed), { status: 200 })) as typeof fetch;
    const tool = createProductSearchTool({
      rootUrl: "http://127.0.0.1:1",
      resolveApiKey: async () => "gk_free_x",
      fetchImpl,
    }) as unknown as {
      name: string;
      label: string;
      execute: (
        id: string,
        p: unknown,
      ) => Promise<{
        content: { type: string; text: string }[];
        details: { count: number; vertical_used: string[]; counts: Record<string, number> };
      }>;
    };
    assert.equal(tool.name, "product_service_search");
    assert.equal(tool.label, "Product & service search");
    const out = await tool.execute("call1", { query: "postgres", vertical: "auto" });
    assert.equal(out.details.count, 3);
    assert.deepEqual(out.details.vertical_used, ["services", "products"]);
    assert.deepEqual(out.details.counts, { services: 4, products: 5 });
    const firstContent = out.content[0];
    assert.ok(firstContent);
    assert.ok(firstContent.text.endsWith(PRODUCT_SEARCH_RESULT_INSTRUCTION));
    const nokey = createProductSearchTool({
      rootUrl: "http://127.0.0.1:1",
      resolveApiKey: async () => undefined,
      fetchImpl,
    }) as unknown as { execute: (id: string, p: unknown) => Promise<unknown> };
    await assert.rejects(nokey.execute("call2", { query: "kb" }), /sign-in/);
  });
});
