import type { Check, Health } from "@gradcode/contracts";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

type Env = Record<string, string | undefined>;

/** The gradhunt checkout the server reads. e2e and /verify point GRADHUNT_DIR at a copy. */
export const gradhuntDir = (env: Env) =>
  env.GRADHUNT_DIR ?? NodePath.join(NodeOS.homedir(), "Personal/gradhunt");

const onPath = (env: Env, bin: string) =>
  (env.PATH ?? "")
    .split(NodePath.delimiter)
    .some((dir) => dir !== "" && NodeFS.existsSync(NodePath.join(dir, bin)));

/** Which local tools exist. File checks only: it never spawns a process or spends money. */
export function health(env: Env = process.env): Health {
  const checks = {
    claude: onPath(env, "claude"),
    scout: NodeFS.existsSync(NodePath.join(gradhuntDir(env), "scout.py")),
    treg: onPath(env, "treg"),
  } satisfies Record<Check, boolean>;
  return { host: NodeOS.hostname(), checks };
}
