/**
 * Meta app settings for "Instagram API with Facebook Login" (Facebook Login for
 * Business). Pure (no Next/DB imports) so tests can load it.
 *
 * META_APP_SECRET must never be printed, logged or sent to the browser: it only
 * signs server-side Graph calls (appsecret_proof) and the token exchange.
 */

/**
 * Requested at login. Business discovery (competitors) needs instagram_basic + a Page.
 * DM replies need instagram_manage_messages, plus pages_manage_metadata to subscribe the
 * Page to the messaging webhooks (lib/services/meta/messaging.ts).
 */
export const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "instagram_manage_messages",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "business_management",
] as const;

export type MetaScope = (typeof META_SCOPES)[number];

/** Without these nothing works: we can't find the Instagram account behind the Page. */
export const ESSENTIAL_SCOPES: readonly MetaScope[] = ["instagram_basic", "pages_show_list"];

export const DEFAULT_GRAPH_VERSION = "v26.0";

export interface MetaConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
  /** https://graph.facebook.com — overridable (META_GRAPH_BASE_URL) only to point tests at a local stub. */
  graphBaseUrl: string;
  /**
   * "code" (default): Meta redirects with ?code=…, exchanged server-side with the secret.
   * "token": Business Login's documented mode — the token arrives in the URL fragment and
   * a small page posts it to the server once (app/api/integrations/instagram/callback).
   */
  responseType: "code" | "token";
}

type Env = Record<string, string | undefined>;

export interface MetaConfigResult {
  config: MetaConfig | null;
  /** Names of the missing variables (never their values). */
  missing: string[];
}

export function readMetaConfig(env: Env = process.env): MetaConfigResult {
  const appId = env.META_APP_ID?.trim() ?? "";
  const appSecret = env.META_APP_SECRET?.trim() ?? "";
  const redirectUri = env.META_REDIRECT_URI?.trim() ?? "";
  const missing = [!appId && "META_APP_ID", !appSecret && "META_APP_SECRET", !redirectUri && "META_REDIRECT_URI"].filter((v): v is string => Boolean(v));
  if (missing.length) return { config: null, missing };
  const version = env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  return {
    config: {
      appId,
      appSecret,
      redirectUri,
      graphVersion: version.startsWith("v") ? version : `v${version}`,
      graphBaseUrl: (env.META_GRAPH_BASE_URL?.trim() || "https://graph.facebook.com").replace(/\/+$/, ""),
      responseType: env.META_OAUTH_RESPONSE_TYPE?.trim() === "token" ? "token" : "code",
    },
    missing: [],
  };
}

export function getMetaConfig(): MetaConfig | null {
  return readMetaConfig().config;
}

/**
 * Which flow "Connect Instagram" uses for new connections (INSTAGRAM_PROVIDER):
 *  - mock:             approve at once with mock data (demo)
 *  - meta:             Facebook Login for Business
 *  - meta_unavailable: INSTAGRAM_PROVIDER=meta but the app isn't configured — connecting is off
 * Existing connections keep their own provider either way.
 */
export type ConnectFlow = "mock" | "meta" | "meta_unavailable";

export function connectFlow(env: Env = process.env): ConnectFlow {
  if ((env.INSTAGRAM_PROVIDER ?? "mock").trim() !== "meta") return "mock";
  return readMetaConfig(env).config ? "meta" : "meta_unavailable";
}

/** The console warning shown at startup when Meta is selected or half-configured (null when all is well). */
export function metaStartupWarning(env: Env = process.env): string | null {
  const { missing } = readMetaConfig(env);
  const wantsMeta = (env.INSTAGRAM_PROVIDER ?? "mock").trim() === "meta";
  if (!missing.length) return null;
  if (!wantsMeta && missing.length === 3) return null; // Meta not set up at all and not asked for: nothing to say.
  return (
    `[meta] Instagram via Meta is DISABLED — missing ${missing.join(", ")} in .env. ` +
    (wantsMeta
      ? "INSTAGRAM_PROVIDER=meta, so \"Connect Instagram\" is turned off until it's set. Existing Meta connections can't sync."
      : "New connections use the mock; existing Meta connections can't sync.")
  );
}

/** Facebook Login for Business dialog (https://www.facebook.com/{version}/dialog/oauth). */
export function buildDialogUrl(config: MetaConfig, state: string, options: { rerequest?: boolean } = {}): string {
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("display", "page");
  url.searchParams.set("extras", JSON.stringify({ setup: { channel: "IG_API_ONBOARDING" } }));
  url.searchParams.set("response_type", config.responseType);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("state", state);
  // Asks again for permissions the user declined last time.
  if (options.rerequest) url.searchParams.set("auth_type", "rerequest");
  return url.toString();
}
