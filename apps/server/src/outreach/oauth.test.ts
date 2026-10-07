import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { accessToken, finishSignIn, startSignIn } from "./oauth.ts";

const idToken = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

/** A token endpoint that records each form it got and answers from a list. */
function tokenEndpoint(answers: object[]) {
  const forms: URLSearchParams[] = [];
  const f = async (_url: string | URL | Request, init?: RequestInit) => {
    forms.push(new URLSearchParams(String(init?.body)));
    return Response.json(answers.shift());
  };
  return { f: f as typeof fetch, forms };
}

describe("mailbox sign-in", () => {
  it("sends Google's consent page a PKCE challenge, and trades the code with its verifier", async () => {
    const url = new URL(
      startSignIn(
        {
          provider: "google",
          clientId: "cid.apps",
          clientSecret: "shh",
          name: "Ada",
          returnTo: "http://127.0.0.1:5174/settings",
        },
        4311,
      ),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:4311/api/oauth/callback");
    expect(q.get("scope")).toContain("https://mail.google.com/");
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("code_challenge_method")).toBe("S256");

    const { f, forms } = tokenEndpoint([
      { access_token: "at", refresh_token: "rt", id_token: idToken({ email: "ada@gmail.com" }) },
    ]);
    const done = await finishSignIn(q.get("state")!, "code-1", f);
    expect(done).toEqual({
      name: "Ada",
      returnTo: "http://127.0.0.1:5174/settings",
      address: "ada@gmail.com",
      oauth: { provider: "google", clientId: "cid.apps", clientSecret: "shh", refreshToken: "rt" },
    });
    const verifier = forms[0]!.get("code_verifier")!;
    expect(NodeCrypto.createHash("sha256").update(verifier).digest("base64url")).toBe(
      q.get("code_challenge"),
    );
    // A state is good once.
    await expect(finishSignIn(q.get("state")!, "code-1", f)).rejects.toThrow(/expired/);
  });

  it("signs in through gradcode's own client unless the user brings one", () => {
    const start = (
      clientId: string,
      shared: Parameters<typeof startSignIn>[2] = {
        google: { id: "shared.apps", secret: "s" },
        microsoft: null,
      },
    ) =>
      startSignIn(
        { provider: "google", clientId, clientSecret: "", name: "Ada", returnTo: "" },
        4311,
        shared,
      );
    expect(new URL(start("")).searchParams.get("client_id")).toBe("shared.apps");
    expect(new URL(start("mine.apps")).searchParams.get("client_id")).toBe("mine.apps");
    expect(() => start("", { google: null, microsoft: null })).toThrow(/client ID/);
  });

  it("refreshes the access token once and reuses it until it nearly expires", async () => {
    const { f, forms } = tokenEndpoint([{ access_token: "a1", expires_in: 3600 }]);
    const login = {
      provider: "microsoft" as const,
      clientId: "azure-id",
      clientSecret: "",
      refreshToken: "rt-ms",
    };
    expect(await accessToken(login, f)).toBe("a1");
    expect(await accessToken(login, f)).toBe("a1");
    expect(forms).toHaveLength(1);
    // A public Azure client sends no secret.
    expect(forms[0]!.has("client_secret")).toBe(false);
  });
});
