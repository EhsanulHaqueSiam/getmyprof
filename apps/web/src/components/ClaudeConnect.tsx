import type { AppState } from "@gradcode/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { call } from "~/rpc/client";

/**
 * Setup's Agent row: Claude Code's binary (a release build fetches it on first run) and its
 * sign-in, which runs Claude Code's own login without a terminal.
 */
export function ClaudeConnect({ claude }: { claude: AppState["claude"] | undefined }) {
  const [signIn, setSignIn] = useState<{ url: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const run = (job: () => Promise<unknown>) => {
    setError("");
    job().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  if (!claude) return null;
  const { binary } = claude;

  if (binary.state === "downloading")
    return (
      <span className="text-muted-foreground tabular-nums" data-testid="claude-downloading">
        Downloading Claude Code · {binary.percent}%
      </span>
    );
  if (binary.state === "missing")
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="claude-missing">
        <span>
          <span className="text-warning-foreground">●</span>{" "}
          {binary.error || "Claude Code isn't downloaded yet."}
        </span>
        <Button size="xs" variant="outline" onClick={() => run(() => call("claude.fetch", {}))}>
          Download
        </Button>
      </div>
    );
  if (claude.signedIn)
    return (
      <>
        <span className="text-success-foreground">●</span> Claude Code{" "}
        <span className="text-muted-foreground text-xs">
          · signed in as {claude.who}; your subscription pays for the thinking
        </span>
      </>
    );
  return (
    <div className="flex flex-col gap-2" data-testid="claude-signed-out">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          <span className="text-warning-foreground">●</span> Claude Code isn't signed in.
        </span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => run(async () => setSignIn(await call("claude.login", {})))}
        >
          {signIn ? "Start again" : "Sign in"}
        </Button>
      </div>
      {signIn ? (
        <form
          className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => call("claude.loginCode", { code }));
          }}
        >
          <span>
            Finish in your browser, or{" "}
            <a href={signIn.url} target="_blank" rel="noreferrer" className="underline">
              open the sign-in page
            </a>
            . Shown a code? Paste it:
          </span>
          <Input
            size="compact"
            className="w-56"
            aria-label="Sign-in code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button size="xs" type="submit" disabled={!code.trim()}>
            Send
          </Button>
        </form>
      ) : null}
      {error ? <span className="text-destructive-foreground text-xs">{error}</span> : null}
    </div>
  );
}
