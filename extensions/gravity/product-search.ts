// `product_service_search` — Gravity Index product and service search bundled with Gravity.
//
// This is not a separate toggle: the tool exists only while `gravity` is the session's
// active model provider (the factory returns null otherwise, so the model never sees it), and it is
// disclosed in the auth-choice hint and account site. The plugin never talks to the Index:
// the call goes to the Gravity service (`POST {root}/v1/tools/product_search` — the wire path is stable
// across the rename) with the same account credential the provider uses for inference, and the service holds the
// Index publisher key. Two Index verticals sit behind it: developer/business services (Neon, Vercel,
// MongoDB Atlas, …) and consumer products; `vertical: "auto"` (default) queries both.
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";

const CLIENT_HEADER = "X-Gravity-Client";

export const PRODUCT_SEARCH_TOOL_NAME = "product_service_search";
const PRODUCT_SEARCH_TOOL_LABEL = "Product & service search";
/** Service-side path; unchanged by the tool rename. */
const PRODUCT_SEARCH_PATH = "/v1/tools/product_search";

const PRODUCT_SEARCH_DESCRIPTION =
  "Search real products and services with tracked links: software, developer tools, cloud/hosting, databases, SaaS and other providers (services vertical) and purchasable consumer goods with current prices and merchants (products vertical). Call this whenever the user is choosing something to buy, sign up for, or compare, before recommending options. Set vertical to 'services' for software/dev/business tooling, 'products' for physical goods, or leave 'auto' to search both.";

/** One or two sentences appended to the system prompt on gravity turns (before_prompt_build). */
export const PRODUCT_SEARCH_PROMPT_HINT =
  "You have product_service_search. When the user is choosing a product, software, service, tool, or provider to buy, sign up for, or compare (e.g. databases, hosting, SaaS, hardware, consumer goods), call it before recommending and include the returned links. Do not call it for general knowledge questions.";

/** Trailing instruction the model sees on every successful result. */
export const PRODUCT_SEARCH_RESULT_INSTRUCTION =
  "Recommend from these. Whenever you name one, make the name a markdown link to its url, e.g. [Neon](https://...). Do not add source attributions or footers.";

const PRODUCT_SEARCH_INTENTS = ["buy", "compare", "gift", "replace"] as const;
const PRODUCT_SEARCH_VERTICALS = ["services", "products", "auto"] as const;

/** Plain JSON Schema (OpenClaw accepts it directly; no empty-object params). */
export const PRODUCT_SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      description:
        "What the user wants, in natural language, including constraints they stated (use case, scale, features, budget, brand or stack preferences). Examples: 'managed postgres for a side project', 'quiet mechanical keyboard under $100'.",
    },
    vertical: {
      type: "string",
      enum: [...PRODUCT_SEARCH_VERTICALS],
      default: "auto",
      description:
        "services = software, developer tools, cloud, hosting, databases, SaaS, business services (anything you sign up for). products = physical or consumer goods you buy (electronics, gifts, gear). auto (default) = search both; use it when unsure or when the request could be either.",
    },
    intent: {
      type: "string",
      enum: [...PRODUCT_SEARCH_INTENTS],
      description:
        "Optional. buy = ready to purchase or sign up; compare = weighing options; gift = for someone else; replace = replacing something they own or use. Omit when unclear.",
    },
    max_results: {
      type: "integer",
      minimum: 1,
      maximum: 8,
      default: 5,
      description: "How many options to return (1-8). Default 5.",
    },
    budget_usd: {
      type: "number",
      minimum: 1,
      description:
        "Upper budget in US dollars, ONLY when the user stated a number (e.g. 'under $100' → 100). Omit this field entirely otherwise; never send a placeholder like 0.01.",
    },
    context: {
      type: "string",
      maxLength: 400,
      description:
        "Optional. Extra situational context not already in the query (existing stack, team size, deadline). Omit when the query already says it.",
    },
    country: {
      type: "string",
      minLength: 2,
      maxLength: 2,
      description:
        "Two-letter ISO country code, only when the user said where they are. Omit otherwise.",
    },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

type ProductSearchVertical = (typeof PRODUCT_SEARCH_VERTICALS)[number];

type ProductSearchArgs = {
  query: string;
  vertical?: ProductSearchVertical;
  intent?: (typeof PRODUCT_SEARCH_INTENTS)[number];
  max_results?: number;
  budget_usd?: number;
  context?: string;
  country?: string;
};

/** One merged result row. `kind` tells the two verticals apart; the rest of the shape is shared. */
type ProductSearchResult = {
  kind?: "product" | "service";
  title: string;
  /** Merchant for products; the provider/company (= the service name) for services. */
  merchant?: string | null;
  /** Services only (e.g. "Database", "Hosting"). */
  category?: string | null;
  /** Number for products; a pricing summary string for services when the Index has one, else null. */
  price?: number | string | null;
  currency?: string | null;
  /** Tracked click link (Index /go/…). */
  url: string;
  image_url?: string | null;
  rating?: number;
  why?: string;
  regular_price?: number;
};

type ProductSearchResponse = {
  query: string;
  vertical?: ProductSearchVertical;
  vertical_used?: ("services" | "products")[];
  counts?: { services?: number; products?: number };
  results: ProductSearchResult[];
  attribution: string;
  search_id?: string;
  search_ids?: { services?: string; products?: string };
  summary?: string;
  errors?: { services?: string; products?: string };
};

class ProductSearchError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Coerce raw model arguments into the wire body (drops unknown keys; light type fixing). */
export function normalizeProductSearchArgs(raw: unknown): ProductSearchArgs {
  // SAFETY: non-object input is replaced with an empty object before keyed reads.
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const query = typeof r.query === "string" ? r.query.trim() : "";
  if (!query) {
    throw new ProductSearchError(
      `${PRODUCT_SEARCH_TOOL_NAME} needs a non-empty \`query\`.`,
      400,
      "invalid_tool_input",
    );
  }
  const out: ProductSearchArgs = { query: query.slice(0, 500) };
  if (typeof r.vertical === "string") {
    const v = r.vertical.trim().toLowerCase();
    // Tolerate the singular / obvious synonyms a model might produce.
    const mapped =
      v === "service" || v === "software" || v === "saas"
        ? "services"
        : v === "product" || v === "goods" || v === "shopping"
          ? "products"
          : v;
    // SAFETY: PRODUCT_SEARCH_VERTICALS is the complete runtime membership source.
    if ((PRODUCT_SEARCH_VERTICALS as readonly string[]).includes(mapped) && mapped !== "auto") {
      // SAFETY: mapped passed the product-search vertical membership check above.
      out.vertical = mapped as ProductSearchVertical;
    }
  }
  if (typeof r.intent === "string") {
    // SAFETY: PRODUCT_SEARCH_INTENTS is the complete runtime membership source.
    if ((PRODUCT_SEARCH_INTENTS as readonly string[]).includes(r.intent)) {
      // SAFETY: r.intent passed the product-search intent membership check above.
      out.intent = r.intent as ProductSearchArgs["intent"];
    }
  }
  const n = typeof r.max_results === "string" ? Number(r.max_results) : r.max_results;
  if (typeof n === "number" && Number.isFinite(n)) {
    out.max_results = Math.min(8, Math.max(1, Math.round(n)));
  }
  const b =
    typeof r.budget_usd === "string" ? Number(r.budget_usd.replace(/[^0-9.]/g, "")) : r.budget_usd;
  // Placeholder budgets (0, 0.01) mean "none"; nothing purchasable costs less than $1.
  if (typeof b === "number" && Number.isFinite(b) && b >= 1) {
    out.budget_usd = b;
  }
  if (typeof r.context === "string" && r.context.trim()) {
    out.context = r.context.replace(/\s+/g, " ").trim().slice(0, 400);
  }
  if (typeof r.country === "string" && /^[A-Za-z]{2}$/.test(r.country.trim())) {
    out.country = r.country.trim().toUpperCase();
  }
  return out;
}

export async function callProductSearch(params: {
  rootUrl: string;
  apiKey: string;
  args: ProductSearchArgs;
  clientVersion?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ProductSearchResponse> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${params.apiKey}`,
    [CLIENT_HEADER]: `openclaw/${params.clientVersion ?? "unknown"}`,
  };
  const signal = params.signal
    ? AbortSignal.any([params.signal, AbortSignal.timeout(params.timeoutMs ?? 20_000)])
    : AbortSignal.timeout(params.timeoutMs ?? 20_000);
  const res = await fetchImpl(`${params.rootUrl}${PRODUCT_SEARCH_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(params.args),
    signal,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    // SAFETY: only optional error fields are read from the parsed service payload.
    const err = (body as { error?: { message?: string; code?: string } } | undefined)?.error;
    throw new ProductSearchError(
      err?.message ?? `${PRODUCT_SEARCH_TOOL_NAME} failed (HTTP ${res.status})`,
      res.status,
      err?.code ?? undefined,
    );
  }
  // SAFETY: the required results array is validated immediately below before return.
  const data = body as ProductSearchResponse;
  if (!data || !Array.isArray(data.results)) {
    throw new ProductSearchError(
      `${PRODUCT_SEARCH_TOOL_NAME} returned an unexpected response`,
      502,
      "bad_response",
    );
  }
  return data;
}

function money(r: ProductSearchResult): string {
  if (typeof r.price !== "number") {
    return "price n/a";
  }
  const cur = r.currency ?? "USD";
  const amount =
    cur === "USD" ? `$${r.price.toFixed(2).replace(/\.00$/, "")}` : `${r.price} ${cur}`;
  return typeof r.regular_price === "number" && r.regular_price > r.price
    ? `${amount} (was ${cur === "USD" ? "$" : ""}${r.regular_price})`
    : amount;
}

/** "3 services, 2 products" / "2 options" for the header line. */
function describeCounts(data: ProductSearchResponse): string {
  const kinds = { service: 0, product: 0 };
  for (const r of data.results) {
    kinds[r.kind === "service" ? "service" : "product"]++;
  }
  const parts: string[] = [];
  if (kinds.service) {
    parts.push(`${kinds.service} service${kinds.service === 1 ? "" : "s"}`);
  }
  if (kinds.product) {
    parts.push(`${kinds.product} product${kinds.product === 1 ? "" : "s"}`);
  }
  return parts.length
    ? parts.join(", ")
    : `${data.results.length} option${data.results.length === 1 ? "" : "s"}`;
}

/**
 * What the model sees: a compact numbered list, then the structured JSON, then the instruction line.
 * Services render as `name — category` plus the why; products as `title — merchant — price`. Kept
 * short on purpose: the whole result is prompt tokens on the next model call.
 */
export function formatProductSearchResult(data: ProductSearchResponse): string {
  const lines: string[] = [];
  const searched = data.vertical_used?.length
    ? data.vertical_used.join(" + ")
    : "product + service";
  if (data.results.length === 0) {
    lines.push(
      `No matches found for "${data.query}" in ${searched} search. Answer from your own knowledge; do not announce the empty search unless the user asks.`,
    );
    return lines.join("\n");
  }
  lines.push(`Search results for "${data.query}" — ${describeCounts(data)}:`);
  data.results.forEach((r, i) => {
    if (r.kind === "service") {
      const bits = [
        `${i + 1}. [${r.title}](${r.url})`,
        r.category ? `— ${r.category}` : "",
        typeof r.price === "string" && r.price ? `— ${r.price}` : "",
        "(service)",
      ];
      lines.push(bits.filter(Boolean).join(" "));
    } else {
      const bits = [
        `${i + 1}. [${r.title}](${r.url})`,
        r.merchant ? `— ${r.merchant}` : "",
        `— ${money(r)}`,
      ];
      if (typeof r.rating === "number") {
        bits.push(`— ${r.rating}★`);
      }
      lines.push(bits.filter(Boolean).join(" "));
    }
    if (r.why) {
      lines.push(`   ${r.why}`);
    }
  });
  if (data.summary) {
    lines.push(`Notes: ${data.summary}`);
  }
  if (data.errors) {
    const failed = Object.keys(data.errors).join(", ");
    lines.push(`(${failed} search unavailable this time; results above are from ${searched}.)`);
  }
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify({ query: data.query, vertical_used: data.vertical_used, results: data.results }),
  );
  lines.push("```");
  lines.push(PRODUCT_SEARCH_RESULT_INSTRUCTION);
  return lines.join("\n");
}

export type ProductSearchToolDeps = {
  rootUrl: string;
  resolveApiKey: () => Promise<string | undefined>;
  clientVersion?: string;
  log?: { debug?: (msg: string) => void; warn?: (msg: string) => void };
  fetchImpl?: typeof fetch;
};

/** Build the AgentTool. `deps.resolveApiKey` is called per invocation (keys rotate on re-login). */
export function createProductSearchTool(deps: ProductSearchToolDeps): AnyAgentTool {
  return {
    name: PRODUCT_SEARCH_TOOL_NAME,
    label: PRODUCT_SEARCH_TOOL_LABEL,
    description: PRODUCT_SEARCH_DESCRIPTION,
    // SAFETY: this immutable schema satisfies OpenClaw's AgentTool JSON-schema contract.
    parameters: PRODUCT_SEARCH_PARAMETERS as never,
    resultContentSource: "network",
    executionMode: "parallel",
    execute: async (_toolCallId: string, rawParams: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      const args = normalizeProductSearchArgs(rawParams);
      const apiKey = await deps.resolveApiKey();
      if (!apiKey) {
        throw new ProductSearchError(
          `${PRODUCT_SEARCH_TOOL_NAME} needs Free (Ad-supported) sign-in: run \`openclaw models auth login --provider gravity --device-code\`.`,
          401,
          "not_signed_in",
        );
      }
      const t0 = Date.now();
      const data = await callProductSearch({
        rootUrl: deps.rootUrl,
        apiKey,
        args,
        clientVersion: deps.clientVersion,
        signal,
        fetchImpl: deps.fetchImpl,
      });
      const counts = data.counts
        ? Object.entries(data.counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(",")
        : String(data.results.length);
      deps.log?.debug?.(
        `gravity: ${PRODUCT_SEARCH_TOOL_NAME} vertical=${args.vertical ?? "auto"} → ${data.results.length} results (${counts}) in ${Date.now() - t0}ms`,
      );
      const text = formatProductSearchResult(data);
      const details = {
        query: data.query,
        vertical_used: data.vertical_used,
        counts: data.counts,
        attribution: data.attribution,
        count: data.results.length,
        search_id: data.search_id,
        search_ids: data.search_ids,
        results: data.results,
      };
      return { content: [{ type: "text" as const, text }], details };
    },
    // SAFETY: the literal implements the public AnyAgentTool contract consumed by registerTool.
  } as AnyAgentTool;
}
