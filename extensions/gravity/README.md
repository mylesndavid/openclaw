# Free (Ad-supported) provider for OpenClaw

**Run OpenClaw for free.** Gravity account sign-in and built-in Gravity Index search are included.

## Behavior

- Provider id: `gravity`
- Provider choice: **Free (Ad-supported)**
- Setup: RFC 8628 device-code sign-in to a Gravity account
- Activation result: `gravity/free-default` becomes the selected default model
- Built-in tool: `product_service_search`
- Tool gating: the tool and its system guidance exist only while Gravity is the active provider
- Ad delivery: not included; this plugin has no ad fetch, render, transform, beacon, or sponsored-message runtime

The plugin never exposes the install credential to the browser. Gravity hands it directly to OpenClaw after the user signs in and approves the displayed device code.

The user-facing product name is intentionally retained, but this contribution contains only free inference, account setup, usage, and the provider-gated Gravity Index tool.

Hosted account and device approval lives at `https://openclaw.trygravity.ai`. The model provider is registered separately at `models.providers.gravity.baseUrl`; its production default and the one-time token response both use `https://llm.trygravity.ai/v1`. Model and Index requests never fall back to the account site's host.

## Sign in

```bash
openclaw models auth login --provider gravity --device-code --set-default
```

The plugin is bundled and enabled by default. For a local account/service stack:

```bash
openclaw config set plugins.entries.gravity.config.accountUrl http://127.0.0.1:3100
openclaw config set models.providers.gravity \
  '{"baseUrl":"http://127.0.0.1:18901/v1","api":"openai-completions","models":[]}' \
  --strict-json
```

The equivalent environment overrides are `GRAVITY_ACCOUNT_URL` and `GRAVITY_MODEL_BASE_URL`.

## Gravity Index

`product_service_search` calls `POST /v1/tools/product_search` with the provider credential. The service owns the Gravity Index publisher key and fans out to product and service search. The publisher key never leaves the server.

The tool is registered through an active-provider factory. On Gravity turns it is available automatically; no second plugin or tool toggle is required. On non-Gravity or unidentified turns the factory returns `null`, so another provider cannot see or call it.

## Verification

```bash
pnpm test:extension gravity
```

The focused extension suite checks auth/config, default model selection, chat
transport, provider-gated tool exposure, product search, and the no-ad runtime
boundary.
