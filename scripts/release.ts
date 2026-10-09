// Releases in one command (pnpm release <cmd>). The version lives in the root package.json; a
// vX.Y.Z tag on main runs .github/workflows/release.yml, which builds every download and publishes
// them (docs/internals/release.md). This script does the steps around it:
//
//   pnpm release status                 version, last tag, what main holds since, the last run
//   pnpm release <patch|minor|major|X.Y.Z> [--watch] [--dry-run]
//                                       a release PR bumps the version; once CI passes it merges,
//                                       main is tagged and the tag pushed, so the release builds
//   pnpm release build                  this machine's downloads into dist/release, no publishing
//   pnpm release watch [X.Y.Z]          follows a tag's release run until it ends
//
// It works from any checkout or worktree: the release branch starts from origin/main and the tag
// goes on origin/main's commit, so a local main is never needed.
import * as NodeChild from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const pkgPath = NodePath.join(root, "package.json");

/** Runs a command where the user sees it; throws when it fails. */
const run = (cmd: string, args: string[]) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = NodeChild.spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} exited ${r.status}`);
};
/** A command's trimmed output, or "" when it fails. */
const read = (cmd: string, args: string[]) => {
  const r = NodeChild.spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};
const versionIn = (json: string) => {
  const v: unknown = JSON.parse(json).version;
  if (typeof v !== "string") throw new Error("package.json has no version");
  return v;
};

/** The version after `current` for a bump word, or `bump` itself when it's a higher X.Y.Z. */
export function nextVersion(current: string, bump: string) {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const cur = parse(current);
  if (!cur) throw new Error(`package.json's version "${current}" isn't X.Y.Z`);
  const [major = 0, minor = 0, patch = 0] = cur;
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  const want = parse(bump);
  if (!want) throw new Error(`Not a version or bump: ${bump}. Use patch, minor, major or X.Y.Z.`);
  const higher = want.findIndex((n, i) => n !== cur[i]);
  if (higher === -1 || (want[higher] ?? 0) < (cur[higher] ?? 0))
    throw new Error(`${bump} isn't higher than ${current}`);
  return bump;
}

/** The release workflow's run for a tag: its id and state, or null before it starts. */
function releaseRun(tag: string) {
  const out = read("gh", [
    "run",
    "list",
    "--workflow",
    "release.yml",
    "--branch",
    tag,
    "--limit",
    "1",
    "--json",
    "databaseId,status,conclusion,url",
  ]);
  const [found]: { databaseId: number; status: string; conclusion: string; url: string }[] = out
    ? JSON.parse(out)
    : [];
  return found ?? null;
}

function status() {
  run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);
  const version = versionIn(read("git", ["show", "origin/main:package.json"]));
  const tag = read("git", ["describe", "--tags", "--abbrev=0", "--match", "v*", "origin/main"]);
  const since = tag ? read("git", ["log", "--oneline", `${tag}..origin/main`]) : "";
  console.log(`main is at ${version}; last tag ${tag || "none"}`);
  console.log(since ? `On main since ${tag}:\n${since}` : "Nothing on main since the last tag.");
  const last = tag ? releaseRun(tag) : null;
  if (last) console.log(`Release run for ${tag}: ${last.status} ${last.conclusion} ${last.url}`);
}

function cut(bump: string, flags: Set<string>) {
  const dry = flags.has("--dry-run");
  if (!dry && read("git", ["status", "--porcelain"]))
    throw new Error("Commit or stash your changes first.");
  if (!read("gh", ["auth", "token"])) throw new Error("Sign in first: gh auth login");
  run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);
  const current = versionIn(read("git", ["show", "origin/main:package.json"]));
  const version = nextVersion(current, bump);
  const tag = `v${version}`;
  const branch = `chore/release-${version}`;
  if (read("git", ["tag", "--list", tag]) || read("git", ["ls-remote", "--tags", "origin", tag]))
    throw new Error(`${tag} exists already`);
  console.log(`Releasing ${current} -> ${version}${dry ? " (dry run: nothing changes)" : ""}`);
  if (dry) {
    console.log(`Would: branch ${branch} from origin/main, bump package.json, open a PR, wait`);
    console.log(`for CI, squash-merge it, tag origin/main ${tag} and push the tag.`);
    return;
  }

  // Wherever you were, you end up back there: a branch by name, else the same commit.
  const start = read("git", ["branch", "--show-current"]) || read("git", ["rev-parse", "HEAD"]);
  run("git", ["switch", "--create", branch, "origin/main"]);
  try {
    publish(version, tag, branch);
  } finally {
    run("git", ["switch", "--quiet", start.length === 40 ? "--detach" : "--no-guess", start]);
  }
  // Once the tag is out the release branch is merged and done; it stays if anything stopped.
  if (read("git", ["ls-remote", "--tags", "origin", tag]))
    run("git", ["branch", "--quiet", "--delete", "--force", branch]);
  if (flags.has("--watch")) watch(version);
  else console.log(`Follow it with: pnpm release watch ${version}`);
}

/** On the fresh release branch: bump, open the PR, wait for CI, merge, tag main, push the tag. */
function publish(version: string, tag: string, branch: string) {
  // A regex edit keeps the file's formatting exactly as it is.
  const json = NodeFS.readFileSync(pkgPath, "utf8");
  NodeFS.writeFileSync(pkgPath, json.replace(/("version":\s*")[^"]+"/, `$1${version}"`));
  if (versionIn(NodeFS.readFileSync(pkgPath, "utf8")) !== version)
    throw new Error("Couldn't set the version in package.json");
  run("git", ["commit", "--quiet", "--all", "--message", `chore: release ${version}`]);
  run("git", ["push", "--quiet", "--set-upstream", "origin", branch]);
  run("gh", [
    "pr",
    "create",
    "--base",
    "main",
    "--title",
    `chore: release ${version}`,
    "--body",
    `Bumps the version to ${version}. Merging it tags ${tag}, which builds and publishes the release.`,
  ]);
  // Give CI a moment to register its check before watching.
  NodeChild.spawnSync("sleep", ["10"]);
  run("gh", ["pr", "checks", branch, "--watch", "--fail-fast"]);
  // gh's --delete-branch would also try the local branch, which this checkout still has out.
  run("gh", ["pr", "merge", branch, "--squash"]);
  run("git", ["push", "--quiet", "origin", "--delete", branch]);

  run("git", ["fetch", "--quiet", "origin", "main"]);
  if (versionIn(read("git", ["show", "origin/main:package.json"])) !== version)
    throw new Error(`origin/main isn't at ${version} after the merge; tag it by hand.`);
  run("git", ["tag", "--annotate", tag, "origin/main", "--message", `getmyprof ${version}`]);
  run("git", ["push", "origin", tag]);
  console.log(`Pushed ${tag}: the release workflow builds and publishes it.`);
}

function watch(version?: string) {
  const tag = `v${version ?? versionIn(NodeFS.readFileSync(pkgPath, "utf8"))}`;
  // A run appears a few seconds after its tag is pushed.
  for (let i = 0; i < 12 && !releaseRun(tag); i++) NodeChild.spawnSync("sleep", ["5"]);
  const found = releaseRun(tag);
  if (!found) throw new Error(`No release run for ${tag} yet.`);
  console.log(found.url);
  run("gh", ["run", "watch", String(found.databaseId), "--exit-status"]);
  console.log(`Released: https://github.com/EhsanulHaqueSiam/getmyprof/releases/tag/${tag}`);
}

/** This machine's downloads, the way release.yml builds them, into dist/release. */
function build() {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  run("pnpm", ["dist", "runtime"]);
  run("pnpm", ["dist", "cli", `${os}-${arch}`]);
  run("pnpm", ["dist", "desktop", os === "darwin" ? "mac" : "linux", arch]);
  run("pnpm", ["dist", "sums"]);
  console.log(`Built into ${NodePath.join(root, "dist/release")}`);
}

if (import.meta.main) {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith("--")));
  const arg = rest.find((a) => !a.startsWith("--"));
  try {
    if (cmd === "status") status();
    else if (cmd === "build") build();
    else if (cmd === "watch") watch(arg);
    else cut(cmd, flags);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
