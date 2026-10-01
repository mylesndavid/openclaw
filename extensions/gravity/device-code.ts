// Gravity account sign-in via RFC 8628 device authorization. The browser flow creates
// or signs into a Gravity account, then hands an install credential directly to OpenClaw.
import type {
  ProviderAuthContext,
  ProviderAuthMethod,
  ProviderAuthResult,
} from "openclaw/plugin-sdk/plugin-entry";
import { buildGravityStaticProviderConfig } from "./catalog.js";
import {
  DEFAULT_MODEL_REF,
  PROVIDER_ID,
  resolveGravityAccountUrl,
  resolveGravityApiBaseUrl,
} from "./config.js";

export const GRAVITY_METHOD_ID = "device-code";
export const GRAVITY_CHOICE_ID = "gravity-free";
export const GRAVITY_LABEL = "Free (Ad-supported)";
const GRAVITY_HINT = "Free AI · Gravity Index included";
export const GRAVITY_PROFILE_ID = `${PROVIDER_ID}:free`;

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  interval?: number;
  expires_in?: number;
};

type DeviceTokenResponse = {
  access_token?: string;
  api_key?: string;
  key_id?: string;
  tier?: string;
  region?: string;
  tos_version?: string;
  base_url?: string;
  baseUrl?: string;
  error?: string;
  error_description?: string;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Sign-up cancelled"));
      },
      { once: true },
    );
  });

async function requestDeviceCode(
  rootUrl: string,
  params: { version?: string },
  signal?: AbortSignal,
) {
  const res = await fetch(`${rootUrl}/oauth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client: "openclaw", version: params.version }),
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Gravity sign-in is unavailable (HTTP ${res.status} from ${rootUrl})`);
  }
  // SAFETY: required device-code fields are validated immediately below before use.
  const body = (await res.json()) as DeviceCodeResponse;
  if (!body.device_code || !body.user_code || !body.verification_uri) {
    throw new Error("Gravity returned an incomplete device-code response");
  }
  return body;
}

async function pollDeviceToken(
  rootUrl: string,
  deviceCode: string,
  signal?: AbortSignal,
): Promise<DeviceTokenResponse> {
  const res = await fetch(`${rootUrl}/oauth/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    signal: signal ?? AbortSignal.timeout(15_000),
  });
  // SAFETY: every token field is treated as optional and checked before use.
  return (await res.json()) as DeviceTokenResponse;
}

export async function runGravityLogin(
  ctx: ProviderAuthContext,
  opts?: { version?: string; sleep?: typeof sleep },
): Promise<ProviderAuthResult> {
  // SAFETY: account URL resolution reads only optional fields from host-validated config.
  const accountUrl = resolveGravityAccountUrl(ctx.config as never);
  const spin = ctx.prompter.progress("Requesting a sign-in code from Gravity…");
  let device: DeviceCodeResponse;
  try {
    ctx.assertCurrent?.();
    device = await requestDeviceCode(accountUrl, { version: opts?.version }, ctx.signal);
    spin.stop("Sign-in code ready");
  } catch (error) {
    spin.stop("Could not reach Gravity");
    throw error;
  }

  const url = device.verification_uri_complete ?? device.verification_uri;
  const expiresInMinutes = Math.max(1, Math.round((device.expires_in ?? 900) / 60));
  const where = ctx.isRemote
    ? "Open this URL in your LOCAL browser"
    : "Open this URL in your browser";
  if (ctx.prompter.deviceCode) {
    await ctx.prompter.deviceCode({
      title: `Sign in to ${GRAVITY_LABEL}`,
      code: device.user_code,
      expiresInMinutes,
      message: `${where}, sign in or create a Gravity account, check the code, and approve this OpenClaw install:\n${url}`,
    });
  } else {
    await ctx.prompter.note(
      [
        `${where}, sign in or create a Gravity account, and approve this OpenClaw install.`,
        `URL: ${url}`,
        `Code: ${device.user_code}`,
        `The code expires in ${expiresInMinutes} minutes. Only enter a code that this terminal showed you.`,
        "",
        "Gravity Index is enabled whenever the Gravity provider is active.",
        "Your install credential is created by Gravity and stored by OpenClaw; you never need to copy it.",
      ].join("\n"),
      `Sign in to ${GRAVITY_LABEL}`,
    );
  }
  if (!ctx.isRemote) {
    try {
      await ctx.openUrl(url);
    } catch {
      // Headless: the URL is already in the note above.
    }
  }
  const waiting = ctx.prompter.progress("Waiting for Gravity sign-in to finish in your browser…");
  const intervalMs = Math.max(1000, (device.interval ?? 2) * 1000);
  const deadline = Date.now() + (device.expires_in ?? 900) * 1000;
  let token: DeviceTokenResponse | undefined;
  try {
    while (Date.now() < deadline) {
      ctx.signal?.throwIfAborted();
      await (opts?.sleep ?? sleep)(intervalMs, ctx.signal);
      ctx.assertCurrent?.();
      const res = await pollDeviceToken(accountUrl, device.device_code, ctx.signal);
      if (res.api_key || res.access_token) {
        token = res;
        break;
      }
      if (res.error && res.error !== "authorization_pending" && res.error !== "slow_down") {
        throw new Error(`Gravity sign-in failed: ${res.error_description ?? res.error}`);
      }
    }
    if (!token) {
      throw new Error(
        "The sign-up code expired before the form was completed. Run the login again.",
      );
    }
    waiting.stop(`Signed in — ${GRAVITY_LABEL} and Index search are enabled`);
  } catch (error) {
    waiting.stop("Sign-in did not complete");
    throw error;
  }

  // SAFETY: the polling loop assigns token only after one of these credential fields is present.
  const apiKey = (token.api_key ?? token.access_token) as string;
  const metadata: Record<string, string> = { tier: token.tier ?? "free" };
  if (token.key_id) {
    metadata.keyId = token.key_id;
  }
  if (token.region) {
    metadata.region = token.region;
  }
  if (token.tos_version) {
    metadata.tosVersion = token.tos_version;
  }
  const tokenModelBaseUrl = token.base_url ?? token.baseUrl;
  // SAFETY: URL resolution reads only optional provider fields from host-validated config.
  const modelBaseUrl = resolveGravityApiBaseUrl(ctx.config as never, tokenModelBaseUrl);
  const providerApi = buildGravityStaticProviderConfig({ baseUrl: modelBaseUrl }).api;
  return {
    profiles: [
      {
        profileId: GRAVITY_PROFILE_ID,
        credential: {
          type: "api_key",
          provider: PROVIDER_ID,
          key: apiKey,
          displayName: GRAVITY_LABEL,
          metadata,
        },
      },
    ],
    configPatch: {
      models: {
        providers: {
          [PROVIDER_ID]: {
            baseUrl: modelBaseUrl,
            api: providerApi,
            models: [],
          },
        },
      },
      agents: { defaults: { models: { [DEFAULT_MODEL_REF]: { alias: GRAVITY_LABEL } } } },
      // SAFETY: this literal uses only fields accepted by the provider-auth config patch contract.
    } as ProviderAuthResult["configPatch"],
    defaultModel: DEFAULT_MODEL_REF,
    notes: [
      `Gravity sign-in completed. Select ${DEFAULT_MODEL_REF} to use ${GRAVITY_LABEL}; Gravity Index product_service_search is available automatically on Gravity turns.`,
      "Your conversation text is sent to Gravity to run the model. No key to manage; sign in again with `openclaw models auth login --provider gravity --device-code --set-default` on another machine.",
    ],
  };
}

export function createGravityAuthMethod(opts?: { version?: string }): ProviderAuthMethod {
  return {
    id: GRAVITY_METHOD_ID,
    kind: "device_code",
    label: GRAVITY_LABEL,
    hint: GRAVITY_HINT,
    wizard: {
      choiceId: GRAVITY_CHOICE_ID,
      choiceLabel: GRAVITY_LABEL,
      choiceHint: GRAVITY_HINT,
      groupId: PROVIDER_ID,
      groupLabel: GRAVITY_LABEL,
      groupHint: "Free AI · includes Gravity Index product and service search",
      methodId: GRAVITY_METHOD_ID,
      assistantPriority: -60,
      onboardingFeatured: true,
      modelSelection: { promptWhenAuthChoiceProvided: false, allowKeepCurrent: false },
    },
    run: (ctx) => runGravityLogin(ctx, opts),
  };
}
