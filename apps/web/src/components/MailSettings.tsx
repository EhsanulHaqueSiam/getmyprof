import type { MailConnect } from "@gradcode/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Chip } from "~/components/FormParts";
import { ago } from "~/lib/format";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

// Providers that take an app password over IMAP and SMTP. Outlook.com dropped app passwords,
// so it isn't offered; "Other" covers any host that still allows them.
const PRESETS = {
  gmail: { label: "Gmail", imap: ["imap.gmail.com", 993], smtp: ["smtp.gmail.com", 465] },
  icloud: { label: "iCloud", imap: ["imap.mail.me.com", 993], smtp: ["smtp.mail.me.com", 587] },
  fastmail: {
    label: "Fastmail",
    imap: ["imap.fastmail.com", 993],
    smtp: ["smtp.fastmail.com", 465],
  },
  other: { label: "Other", imap: ["", 993], smtp: ["", 465] },
} as const;
type Preset = keyof typeof PRESETS;
const ORDER = ["gmail", "icloud", "fastmail", "other"] as const satisfies Preset[];

/** Settings' Mailbox row: connect with an app password, or show the connected box and its sync. */
export function MailSettings() {
  const mail = useStore((s) => s.app?.mail);
  const [preset, setPreset] = useState<Preset>("gmail");
  const [form, setForm] = useState({ name: "", address: "", password: "" });
  const [hosts, setHosts] = useState({ imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 465 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!mail) return null;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (mail.connected)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground">{mail.address}</span>
        <span className="text-muted-foreground text-xs">
          {mail.lastSyncAt ? `synced ${ago(mail.lastSyncAt)}` : "not synced yet"}
        </span>
        {mail.error ? (
          <span className="text-destructive-foreground text-xs">{mail.error}</span>
        ) : null}
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={busy}
          onClick={() => void run(() => call("mail.sync", {}))}
        >
          Sync now
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={busy}
          onClick={() => void run(() => call("mail.disconnect", {}))}
        >
          Disconnect
        </Button>
      </div>
    );

  const p = PRESETS[preset];
  const login: MailConnect =
    preset === "other"
      ? { ...form, ...hosts }
      : {
          ...form,
          imapHost: p.imap[0],
          imapPort: p.imap[1],
          smtpHost: p.smtp[0],
          smtpPort: p.smtp[1],
        };

  return (
    <form
      className="flex max-w-md flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => call("mail.connect", login));
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {ORDER.map((k) => (
          <Chip key={k} on={preset === k} onClick={() => setPreset(k)}>
            {PRESETS[k].label}
          </Chip>
        ))}
      </div>
      <Input
        size="compact"
        aria-label="Your name"
        placeholder="Your name, as recipients see it"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Input
        size="compact"
        type="email"
        aria-label="Address"
        placeholder="Address"
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
      />
      <Input
        size="compact"
        type="password"
        aria-label="App password"
        placeholder="App password, not your login password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      {preset === "other" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_80px] gap-2">
          <Input
            size="compact"
            aria-label="IMAP host"
            placeholder="IMAP host"
            value={hosts.imapHost}
            onChange={(e) => setHosts({ ...hosts, imapHost: e.target.value })}
          />
          <Input
            size="compact"
            type="number"
            aria-label="IMAP port"
            value={hosts.imapPort}
            onChange={(e) => setHosts({ ...hosts, imapPort: Number(e.target.value) })}
          />
          <Input
            size="compact"
            aria-label="SMTP host"
            placeholder="SMTP host"
            value={hosts.smtpHost}
            onChange={(e) => setHosts({ ...hosts, smtpHost: e.target.value })}
          />
          <Input
            size="compact"
            type="number"
            aria-label="SMTP port"
            value={hosts.smtpPort}
            onChange={(e) => setHosts({ ...hosts, smtpPort: Number(e.target.value) })}
          />
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">
          {p.imap[0]} · {p.smtp[0]}
        </span>
      )}
      {error ? <span className="text-destructive-foreground text-xs">{error}</span> : null}
      <div>
        <Button
          type="submit"
          size="xs"
          disabled={busy || !form.name || !form.address || !form.password}
        >
          {busy ? "Checking" : "Connect"}
        </Button>
      </div>
    </form>
  );
}
