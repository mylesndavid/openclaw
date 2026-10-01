// Focused test-only surface for Gravity provider internals.
export {
  STATIC_PROVIDER,
  buildGravityProviderConfig,
  buildGravityStaticProviderConfig,
} from "./catalog.js";
export {
  DEFAULT_ACCOUNT_URL,
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_REF,
  resolveGravityAccountUrl,
  resolveGravityApiBaseUrl,
  resolveGravityRootUrl,
} from "./config.js";
export {
  GRAVITY_CHOICE_ID,
  GRAVITY_LABEL,
  GRAVITY_METHOD_ID,
  GRAVITY_PROFILE_ID,
  createGravityAuthMethod,
  runGravityLogin,
} from "./device-code.js";
export {
  PRODUCT_SEARCH_PARAMETERS,
  PRODUCT_SEARCH_PROMPT_HINT,
  PRODUCT_SEARCH_RESULT_INSTRUCTION,
  PRODUCT_SEARCH_TOOL_NAME,
  callProductSearch,
  createProductSearchTool,
  formatProductSearchResult,
  normalizeProductSearchArgs,
} from "./product-search.js";
