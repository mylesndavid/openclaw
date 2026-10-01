import { PROVIDER_ID } from "./config.js";

/** Provider-owned features fail closed unless OpenClaw identifies the active provider as Gravity. */
export function isGravityProviderTurn(activeProvider: unknown): boolean {
  return activeProvider === PROVIDER_ID;
}

export function forGravityProviderTurn<T>(activeProvider: unknown, create: () => T): T | null {
  return isGravityProviderTurn(activeProvider) ? create() : null;
}
