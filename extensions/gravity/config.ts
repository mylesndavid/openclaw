export const PROVIDER_ID = "gravity";
export const ENV_VAR = "GRAVITY_API_KEY";
export const DEFAULT_MODEL_REF = "gravity/free-default";
/** Browser/device-authorization front door. This host never receives model requests. */
export const DEFAULT_ACCOUNT_URL = "https://openclaw.trygravity.ai";
/** OpenAI-compatible inference and Gravity Index API consumed by provider registration. */
export const DEFAULT_MODEL_BASE_URL = "https://llm.trygravity.ai/v1";

type ConfigLike =
  | {
      models?: { providers?: Record<string, { baseUrl?: unknown }> };
      plugins?: { entries?: Record<string, { config?: { accountUrl?: unknown } }> };
    }
  | null
  | undefined;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Account URL used only for RFC 8628 device-code endpoints. */
export function resolveGravityAccountUrl(config: ConfigLike, explicit?: string): string {
  const fromPlugin = config?.plugins?.entries?.[PROVIDER_ID]?.config?.accountUrl;
  return normalizeUrl(
    explicit ||
      (typeof fromPlugin === "string" ? fromPlugin : "") ||
      process.env.GRAVITY_ACCOUNT_URL ||
      DEFAULT_ACCOUNT_URL,
  );
}

/** OpenAI-compatible `/v1` base URL used by OpenClaw's provider registration. */
export function resolveGravityApiBaseUrl(config: ConfigLike, explicit?: string): string {
  const fromProvider = config?.models?.providers?.[PROVIDER_ID]?.baseUrl;
  const raw = normalizeUrl(
    explicit ||
      (typeof fromProvider === "string" ? fromProvider : "") ||
      process.env.GRAVITY_MODEL_BASE_URL ||
      DEFAULT_MODEL_BASE_URL,
  );
  return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

/** Inference/Index service root without `/v1`; never falls back to the account host. */
export function resolveGravityRootUrl(config: ConfigLike, explicit?: string): string {
  return resolveGravityApiBaseUrl(config, explicit).slice(0, -3);
}

export function configuredBaseUrl(config: ConfigLike): string | undefined {
  const value = config?.models?.providers?.[PROVIDER_ID]?.baseUrl;
  return typeof value === "string" ? value : undefined;
}
