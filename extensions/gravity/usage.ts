// `GET /v1/usage` → ProviderUsageSnapshot. Flat per-key token budget, $0 cost.
import type {
  ProviderUsageBilling,
  ProviderUsageSnapshot,
} from "openclaw/plugin-sdk/provider-usage";
import { PROVIDER_ID, resolveGravityRootUrl } from "./config.js";

type UsagePayload = {
  budget?: {
    configured?: boolean;
    windowKey?: string;
    period?: string;
    limitTokens?: number;
    usedTokens?: number;
    remainingTokens?: number;
  };
  usage?: {
    summary?: {
      requestCount?: number;
      totalTokens?: number;
      actualCostMicros?: number;
    };
  };
  plan?: string;
  tier?: string;
};

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function nextUtcMidnight(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export async function fetchGravityUsage(params: {
  token: string;
  config?: unknown;
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ProviderUsageSnapshot> {
  // SAFETY: URL resolution reads only optional Gravity fields from host-validated config.
  const rootUrl = resolveGravityRootUrl(params.config as never, params.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  params.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await fetch(`${rootUrl}/v1/usage`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${params.token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Gravity usage request failed (HTTP ${res.status})`);
    }
    // SAFETY: every usage field is optional and normalized before arithmetic or display.
    const payload = (await res.json()) as UsagePayload;
    const limit = count(payload.budget?.limitTokens);
    const used = count(payload.budget?.usedTokens);
    const summary = payload.usage?.summary;
    const parts = [
      summary?.requestCount !== undefined ? `${fmt(summary.requestCount)} requests` : undefined,
      summary?.totalTokens !== undefined ? `${fmt(summary.totalTokens)} tokens` : undefined,
    ].filter((p): p is string => Boolean(p));
    const windows: ProviderUsageSnapshot["windows"] = [];
    if (payload.budget?.configured && limit !== undefined && used !== undefined) {
      windows.push({
        label: payload.budget.period === "day" ? "Daily token budget" : "Token budget",
        usedPercent: limit === 0 ? 100 : Math.min(100, (used / limit) * 100),
        resetAt: payload.budget.period === "day" ? nextUtcMidnight() : undefined,
      });
    }
    const billing: ProviderUsageBilling[] | undefined =
      limit !== undefined && used !== undefined
        ? [
            {
              type: "budget",
              label: "Free (Ad-supported)",
              used,
              limit,
              unit: "tokens",
              period: payload.budget?.period === "day" ? "day" : "month",
              resetAt: payload.budget?.period === "day" ? nextUtcMidnight() : undefined,
            },
          ]
        : undefined;
    return {
      provider: PROVIDER_ID,
      displayName: "Free (Ad-supported)",
      windows,
      ...(billing ? { billing } : {}),
      summary: parts.length > 0 ? parts.join(" · ") : undefined,
      plan: payload.plan ?? "Free (Ad-supported)",
    };
  } finally {
    clearTimeout(timer);
  }
}
