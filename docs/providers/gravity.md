---
summary: "Use Gravity's Free (Ad-supported) model provider and bundled Index search"
title: "Gravity"
read_when:
  - You want to use the Free (Ad-supported) provider
  - You need Gravity device sign-in or product and service search
---

Gravity provides the **Free (Ad-supported)** model choice through the bundled
`gravity` plugin. Setup uses an RFC 8628 device-code flow, selects
`gravity/free-default`, and makes `product_service_search` available
automatically on Gravity model turns.

## Sign in

```bash
openclaw models auth login --provider gravity --device-code --set-default
```

OpenClaw requests a code from `https://openclaw.trygravity.ai` and opens the
approval page. After approval, Gravity returns an install credential directly
to OpenClaw. The credential is stored by OpenClaw and is not exposed to the
browser.

Successful sign-in:

- selects `gravity/free-default`;
- configures the model endpoint returned by the token response, with
  `https://openclaw.trygravity.ai/v1` as the safe fallback; and
- uses Chat Completions for current chat-only models. A future catalog model
  advertising Responses support keeps its own Responses transport.

## Gravity Index

`product_service_search` searches products and services with tracked result
links. It is part of the provider: there is no separate tool enablement.

The tool and its prompt guidance are exposed only when the active model
provider is `gravity`. Non-Gravity and unidentified turns fail closed and do
not receive the tool.

## Runtime and privacy boundary

Conversation text is sent to Gravity for model inference. Search queries are
sent to the configured Gravity model service when the model calls
`product_service_search`.

The bundled plugin contains no ad-fetching, ad-rendering, sponsored follow-up,
beacon/reporting, response-stream transformation, surface gating, organic ad
widget, Hermes, or hosted backend code. The **Free (Ad-supported)** label is
the product choice name; ad delivery is outside this OpenClaw integration.

## Custom endpoints

The account and inference endpoints are configured independently:

```bash
openclaw config set plugins.entries.gravity.config.accountUrl https://accounts.example
openclaw config set models.providers.gravity \
  '{"baseUrl":"https://inference.example/v1","api":"openai-completions","models":[]}' \
  --strict-json
```

`GRAVITY_ACCOUNT_URL` overrides the device-auth host.
`GRAVITY_MODEL_BASE_URL` overrides the model and Index service fallback.
