import type { McpServer } from "@gradcode/contracts";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Chip } from "~/components/FormParts";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useStore } from "~/state/store";

/** "https://…" is an HTTP server; anything else is a command line, run over stdio. */
function parse(name: string, where: string): McpServer {
  const w = where.trim();
  if (/^https?:\/\//.test(w)) return { transport: "http", name, url: w, trusted: false };
  const [command = "", ...args] = w.split(/\s+/);
  return { transport: "stdio", name, command, args, trusted: false };
}

/** Settings' MCP servers row: the user's own servers, passed to every agent session. */
export function McpServers() {
  const settings = useStore((s) => s.app?.settings);
  const save = useStore((s) => s.saveSettings);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  if (!settings) return null;
  const list = settings.mcpServers;
  const put = (mcpServers: McpServer[]) => void save({ mcpServers });
  const valid = /^[a-z0-9_-]+$/i.test(name) && name !== "hunt" && where.trim() !== "";
  return (
    <div className="flex max-w-xl flex-col gap-1.5">
      {list.map((m, i) => (
        <div key={m.name} className="flex items-center gap-2 text-xs">
          <span className="w-24 truncate font-medium text-foreground">{m.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
            {m.transport === "http" ? m.url : [m.command, ...m.args].join(" ")}
          </span>
          <Chip
            on={m.trusted}
            onClick={() => put(list.map((x, j) => (j === i ? { ...x, trusted: !x.trusted } : x)))}
          >
            {m.trusted ? "runs without asking" : "asks each call"}
          </Chip>
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Remove ${m.name}`}
            onClick={() => put(list.filter((_, j) => j !== i))}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          put([...list.filter((m) => m.name !== name), parse(name, where)]);
          setName("");
          setWhere("");
        }}
      >
        <Input
          size="compact"
          className="w-28"
          aria-label="MCP server name"
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          size="compact"
          aria-label="MCP server URL or command"
          placeholder="https://… or npx some-mcp-server"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
        />
        <Button type="submit" size="xs" variant="outline" disabled={!valid}>
          Add
        </Button>
      </form>
    </div>
  );
}

/** Settings' row for other agents: gradcode's own MCP endpoint and the config to paste. */
export function McpEndpoint() {
  const token = useStore((s) => s.app?.settings.mcpToken) ?? "";
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/api/mcp`;
  const config = JSON.stringify(
    {
      mcpServers: {
        gradcode: { type: "http", url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
  return (
    <div className="flex flex-col gap-1 text-xs">
      <code className="font-mono text-2xs text-foreground" data-testid="mcp-url">
        {url}
      </code>
      <span className="text-muted-foreground">
        Tools: search the sheet, start a hunt, read threads, work Review. The token is in the
        config; anyone with it can start hunts.
      </span>
      <div>
        <Button
          size="xs"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(config);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy MCP config"}
        </Button>
      </div>
    </div>
  );
}
