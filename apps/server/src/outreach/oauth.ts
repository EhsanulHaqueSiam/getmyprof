// Mailbox sign-in for providers that prefer OAuth to app passwords: Gmail by choice, Outlook.com
// because it no longer takes them. gradcode's own clients (SHARED_CLIENTS) mean a user just signs
// in; a user can bring their own client instead. Desktop clients accept a loopback redirect on
// any port, so the callback lands on this server, and the refresh token stays in
// GRADCODE_HOME/mail.json like an app password.
import { MailProvider, type MailSignIn } from "@gradcode/contracts";
import * as NodeCrypto from "node:crypto";
import { z } from "zod";

export const OAUTH_PROVIDERS = {
  google: {
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://mail.google.com/ openid email",
    extra: { access_type: "offline", prompt: "consent" },
    // Google wants the loopback IP; any port works for a Desktop client.
    loopback: "127.0.0.1",
    imap: { host: "imap.gmail.com", port: 993 },
    smtp: { host: "smtp.gmail.com", port: 465 },
  },
  microsoft: {
    label: "Microsoft",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:
      "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email",
    extra: { prompt: "select_account" },
    // Azure matches "http://localhost" registered on a public client, on any port.
    loopback: "localhost",
    imap: { host: "outlook.office365.com", port: 993 },
    smtp: { host: "smtp-mail.outlook.com", port: 587 },
  },
} as const;

type OAuthProvider = MailProvider;

/**
 * gradcode's own OAuth clients: a Desktop app in Google Cloud and a public client in Azure,
 * made once by whoever ships gradcode (docs/internals/overview.md, Outreach). They can't keep a
 * secret, so Google and Microsoft expect them in the app's source. null: users bring their own.
 */
export const SHARED_CLIENTS: Record<OAuthProvider, { id: string; secret: string } | null> = {
  google: null,
  microsoft: null,
};

/** What a signed-in mailbox keeps. Google's Desktop clients have a secret; Azure's public ones don't. */
export const OAuthLogin = z.object({
  provider: MailProvider,
  clientId: z.string().min(1),
  clientSecret: z.string(),
  refreshToken: z.string().min(1),
});
export type OAuthLogin = z.infer<typeof OAuthLogin>;

export type SignInStart = MailSignIn;

const PENDING_MS = 10 * 60_000;
/** Sign-ins waiting for their callback, by `state`. */
const pending = new Map<
  string,
  SignInStart & { verifier: string; redirectUri: string; at: number }
>();

const sha256 = (s: string) => NodeCrypto.createHash("sha256").update(s).digest("base64url");

/** Where the provider sends the browser back: this server, on the loopback it accepts. */
export const redirectUri = (provider: OAuthProvider, port: number) =>
  `http://${OAUTH_PROVIDERS[provider].loopback}:${port}/api/oauth/callback`;

/**
 * The provider's consent page for this sign-in, with PKCE, so a stolen code is useless. With no
 * client ID it signs in through the shared client.
 */
export function startSignIn(input: SignInStart, port: number, shared = SHARED_CLIENTS) {
  for (const [k, v] of pending) if (Date.now() - v.at > PENDING_MS) pending.delete(k);
  const client = input.clientId
    ? { id: input.clientId, secret: input.clientSecret }
    : shared[input.provider];
  if (!client) throw new Error("Add the client ID of your own OAuth client.");
  const verifier = NodeCrypto.randomBytes(32).toString("base64url");
  const state = NodeCrypto.randomBytes(16).toString("base64url");
  const p = OAUTH_PROVIDERS[input.provider];
  const uri = redirectUri(input.provider, port);
  pending.set(state, {
    ...input,
    clientId: client.id,
    clientSecret: client.secret,
    verifier,
    redirectUri: uri,
    at: Date.now(),
  });
  const url = new URL(p.authUrl);
  url.search = new URLSearchParams({
    client_id: client.id,
    redirect_uri: uri,
    response_type: "code",
    scope: p.scope,
    state,
    code_challenge: sha256(verifier),
    code_challenge_method: "S256",
    ...p.extra,
  }).toString();
  return url.toString();
}

const TokenReply = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  expires_in: z.number().optional(),
});

async function tokenRequest(
  provider: OAuthProvider,
  form: Record<string, string>,
  fetchFn: typeof fetch,
) {
  const r = await fetchFn(OAUTH_PROVIDERS[provider].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body: unknown = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = z
      .object({ error: z.string().optional(), error_description: z.string().optional() })
      .safeParse(body);
    const why = e.success ? (e.data.error_description ?? e.data.error) : undefined;
    throw new Error(`${OAUTH_PROVIDERS[provider].label} refused: ${why ?? `HTTP ${r.status}`}`);
  }
  return TokenReply.parse(body);
}

/** The address an ID token names. It came straight from the token endpoint over TLS. */
function addressOf(idToken: string | undefined) {
  const payload = idToken?.split(".")[1];
  const claims = payload
    ? z
        .object({ email: z.string().optional(), preferred_username: z.string().optional() })
        .safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")))
    : null;
  const address = claims?.success ? (claims.data.email ?? claims.data.preferred_username) : null;
  if (!address) throw new Error("The sign-in didn't say which address it was for.");
  return address;
}

/** Trades the callback's code for a refresh token, and reads which address signed in. */
export async function finishSignIn(state: string, code: string, fetchFn: typeof fetch = fetch) {
  const s = pending.get(state);
  if (!s || Date.now() - s.at > PENDING_MS)
    throw new Error("This sign-in expired. Start it again from Settings.");
  pending.delete(state);
  const t = await tokenRequest(
    s.provider,
    {
      client_id: s.clientId,
      ...(s.clientSecret ? { client_secret: s.clientSecret } : {}),
      code,
      code_verifier: s.verifier,
      grant_type: "authorization_code",
      redirect_uri: s.redirectUri,
    },
    fetchFn,
  );
  if (!t.refresh_token)
    throw new Error(
      "No refresh token came back, so the mailbox would stop working within an hour.",
    );
  return {
    name: s.name,
    returnTo: s.returnTo,
    address: addressOf(t.id_token),
    oauth: {
      provider: s.provider,
      clientId: s.clientId,
      clientSecret: s.clientSecret,
      refreshToken: t.refresh_token,
    },
  };
}

const tokens = new Map<string, { token: string; until: number }>();

/** A fresh access token for IMAP and SMTP, reused until a minute before it expires. */
export async function accessToken(login: OAuthLogin, fetchFn: typeof fetch = fetch) {
  const hit = tokens.get(login.refreshToken);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await tokenRequest(
    login.provider,
    {
      client_id: login.clientId,
      ...(login.clientSecret ? { client_secret: login.clientSecret } : {}),
      refresh_token: login.refreshToken,
      grant_type: "refresh_token",
    },
    fetchFn,
  );
  tokens.set(login.refreshToken, {
    token: t.access_token,
    until: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000,
  });
  return t.access_token;
}
