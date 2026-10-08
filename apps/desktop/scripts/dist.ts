// Release builds. `pnpm dist <step>`, run in this order; release.yml runs the same steps.
//
//   runtime                      web app + bundled server and CLI + Electron's main, in apps/desktop/dist
//   cli <os-arch>...             self-contained `gradcode` tarballs, each with its own Node
//   desktop <mac|linux> <arch>...  dmg + zip, or AppImage + deb, with latest*.yml for the updater
//   npm                          the `gradcode` npm package, packed (never published from here)
//   sums                         SHA256SUMS over the release assets in dist/release
//   manifests                    the Homebrew cask and AUR PKGBUILD for this release, in dist/publish
//
// The version is the root package.json's. GRADCODE_RELEASES (owner/name) moves the public update
// feed; GRADCODE_UPDATE_URL points the desktop app at any static folder instead, for testing.
// The Mac app is signed and notarized when CSC_LINK and Apple's API key are set, else ad-hoc.
import { build as pack } from "vite-plus/pack";
import { build, type Configuration } from "electron-builder";
import * as NodeChild from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "../../..");
const desktop = NodePath.join(root, "apps/desktop");
const runtime = NodePath.join(desktop, "dist/runtime");
const release = NodePath.join(root, "dist/release");
const cache = NodePath.join(root, "dist/cache");

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(NodeFS.readFileSync(file, "utf8"));
const version = String(readJson(NodePath.join(root, "package.json")).version);
const releases = process.env.GRADCODE_RELEASES ?? "EhsanulHaqueSiam/gradcode-releases";
// The CLI's Node: the LTS line Electron 44 runs the server on, so both run the same runtime.
const NODE = "24.21.0";
// The Agent SDK's native binary is one npm package per platform at the SDK's version. Its license
// reserves redistribution, so no download carries it: the runtime pins this version and the
// user's machine fetches it (apps/server/src/agent/binary.ts); the npm package depends on it.
const sdk = String(
  readJson(
    NodePath.join(root, "apps/server/node_modules/@anthropic-ai/claude-agent-sdk/package.json"),
  ).version,
);
const CLI_TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];

const run = (cmd: string, args: string[], cwd = root) => {
  const r = NodeChild.spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
};
const sha256 = (file: string) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(file)).digest("hex");

/** Downloads `url` into the cache once; later builds reuse it. */
async function cached(url: string, name = NodePath.basename(url)) {
  const file = NodePath.join(cache, name);
  if (NodeFS.existsSync(file)) return file;
  NodeFS.mkdirSync(cache, { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  NodeFS.writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()));
  NodeFS.renameSync(`${file}.part`, file);
  return file;
}

/** The web app, the server and CLI bundles, and the Electron main and preload. */
async function buildRuntime() {
  run("pnpm", ["--filter", "@gradcode/web", "build"]);
  NodeFS.rmSync(NodePath.join(desktop, "dist"), { recursive: true, force: true });
  const common = {
    config: false,
    cwd: root,
    platform: "node",
    target: "node24",
    dts: false,
  } as const;
  // cwd is the root, whose package.json has no dependencies, so every import is bundled.
  await pack({
    ...common,
    entry: { server: "apps/server/src/bin.ts", cli: "apps/server/src/cli.ts" },
    outDir: runtime,
    format: "esm",
    fixedExtension: true,
    deps: { onlyBundle: false },
    define: { "process.env.GRADCODE_CLAUDE_SDK": JSON.stringify(sdk) },
  });
  NodeFS.cpSync(NodePath.join(root, "apps/web/dist"), NodePath.join(runtime, "web"), {
    recursive: true,
  });
  NodeFS.writeFileSync(
    NodePath.join(runtime, "package.json"),
    `${JSON.stringify({ name: "gradcode", version, type: "module", gradcode: { releases } }, null, 2)}\n`,
  );
  await pack({
    ...common,
    entry: { main: "apps/desktop/src/main.ts" },
    outDir: NodePath.join(desktop, "dist"),
    format: "esm",
    fixedExtension: true,
    clean: false,
    deps: { neverBundle: ["electron"], onlyBundle: false },
  });
  await pack({
    ...common,
    entry: { preload: "apps/desktop/src/preload.ts" },
    outDir: NodePath.join(desktop, "dist"),
    format: "cjs",
    fixedExtension: true,
    clean: false,
    deps: { neverBundle: ["electron"], onlyBundle: false },
  });
}

/** Official Node for one os-arch, checked against nodejs.org's SHASUMS256.txt. */
async function nodeFor(target: string) {
  const name = `node-v${NODE}-${target}.tar.gz`;
  const base = `https://nodejs.org/dist/v${NODE}`;
  const tgz = await cached(`${base}/${name}`);
  const sums = NodeFS.readFileSync(
    await cached(`${base}/SHASUMS256.txt`, `node-${NODE}-SHASUMS256.txt`),
    "utf8",
  );
  if (!sums.includes(`${sha256(tgz)}  ${name}`))
    throw new Error(`${name} doesn't match SHASUMS256.txt`);
  return { tgz, binary: `node-v${NODE}-${target}/bin/node` };
}

/** gradcode-<v>-<os>-<arch>.tar.gz: the runtime, its Node and the `gradcode` script. */
async function buildCli(targets: string[]) {
  for (const target of targets) {
    if (!CLI_TARGETS.includes(target)) throw new Error(`cli targets: ${CLI_TARGETS.join(", ")}`);
    const stem = `gradcode-${version}-${target}`;
    const dir = NodePath.join(root, "dist/stage", stem);
    NodeFS.rmSync(dir, { recursive: true, force: true });
    NodeFS.cpSync(runtime, dir, { recursive: true });
    const node = await nodeFor(target);
    run("tar", ["-xzf", node.tgz, "-C", dir, "--strip-components=2", node.binary]);
    NodeFS.copyFileSync(
      NodePath.join(root, "packaging/gradcode.sh"),
      NodePath.join(dir, "gradcode"),
    );
    NodeFS.chmodSync(NodePath.join(dir, "gradcode"), 0o755);
    NodeFS.mkdirSync(release, { recursive: true });
    run("tar", [
      "--no-xattrs",
      "-czf",
      NodePath.join(release, `${stem}.tar.gz`),
      "-C",
      NodePath.dirname(dir),
      stem,
    ]);
  }
}

function desktopConfig(): Configuration {
  const [owner = "", repo = ""] = releases.split("/");
  const signed = Boolean(process.env.CSC_LINK);
  const entitlements = NodePath.join(desktop, "build/entitlements.mac.plist");
  return {
    appId: "dev.gradcode.app",
    productName: "gradcode",
    copyright: "Ehsanul Haque Siam",
    artifactName: "gradcode-${version}-${arch}.${ext}",
    // desktopName is the window's app id on Linux, matching the menu entry gradcode-desktop.desktop.
    extraMetadata: {
      version,
      homepage: `https://github.com/${releases}`,
      desktopName: "gradcode-desktop.desktop",
    },
    directories: { output: release, buildResources: "build" },
    files: ["package.json", "dist/*.mjs", "dist/*.cjs"],
    extraResources: [{ from: "dist/runtime", to: "runtime" }],
    electronLanguages: ["en", "en-US"],
    publish: process.env.GRADCODE_UPDATE_URL
      ? { provider: "generic", url: process.env.GRADCODE_UPDATE_URL }
      : { provider: "github", owner, repo, releaseType: "release" },
    mac: {
      target: ["dmg", "zip"],
      category: "public.app-category.education",
      // Ad-hoc without a Developer ID: it runs, and updates arrive as a notice (updates.ts).
      ...(signed ? { entitlements, entitlementsInherit: entitlements } : { identity: "-" }),
      hardenedRuntime: signed,
      notarize: signed && Boolean(process.env.APPLE_API_KEY),
    },
    linux: {
      target: ["AppImage", "deb"],
      // `gradcode` is the command line's name; the app is gradcode-desktop on the PATH.
      executableName: "gradcode-desktop",
      category: "Education",
      synopsis: "Find professors who can fund your degree",
      maintainer: "Ehsanul Haque Siam <EhsanulHaqueSiam@users.noreply.github.com>",
      desktop: { entry: { StartupWMClass: "gradcode-desktop" } },
    },
    // The static AppImage runtime needs no libfuse2, which Arch and others no longer install.
    toolsets: { appimage: "1.0.3" },
    appImage: { artifactName: "gradcode-${version}-${arch}.${ext}" },
    deb: {
      artifactName: "gradcode_${version}_${arch}.${ext}",
      depends: [
        "libasound2t64 | libasound2",
        "libatspi2.0-0t64 | libatspi2.0-0",
        "libgbm1",
        "libgtk-3-0t64 | libgtk-3-0",
        "libnotify4",
        "libnss3",
        "libsecret-1-0",
        "libuuid1",
        "libxss1",
        "libxtst6",
        "xdg-utils",
      ],
    },
  };
}

async function buildDesktop([os, ...archs]: string[]) {
  if ((os !== "mac" && os !== "linux") || archs.length === 0)
    throw new Error("desktop <mac|linux> <x64|arm64>...");
  await build({
    projectDir: desktop,
    config: desktopConfig(),
    publish: "never",
    [os]: [],
    x64: archs.includes("x64"),
    arm64: archs.includes("arm64"),
  });
}

/** The npm package: the runtime, with npm fetching the one Claude binary this machine needs. */
function buildNpm() {
  const dir = NodePath.join(root, "dist/npm/gradcode");
  NodeFS.rmSync(dir, { recursive: true, force: true });
  NodeFS.cpSync(runtime, dir, { recursive: true });
  const platforms = [
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "linux-x64-musl",
    "linux-arm64-musl",
  ];
  const pkg = {
    name: "gradcode",
    version,
    description: "Find professors who can fund your degree. Runs on your own Claude Code login.",
    type: "module",
    bin: { gradcode: "cli.mjs" },
    engines: { node: ">=24" },
    os: ["darwin", "linux"],
    optionalDependencies: Object.fromEntries(
      platforms.map((p) => [`@anthropic-ai/claude-agent-sdk-${p}`, sdk]),
    ),
    gradcode: { releases },
  };
  NodeFS.writeFileSync(NodePath.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  NodeFS.writeFileSync(
    NodePath.join(dir, "README.md"),
    "# gradcode\n\nFinds professors who can fund your degree, on your own Claude Code login.\n\n```sh\nnpx gradcode@latest\n```\n",
  );
  const out = NodePath.join(release, "npm");
  NodeFS.mkdirSync(out, { recursive: true });
  run("npm", ["pack", "--pack-destination", out], dir);
}

/** What a release publishes; electron-builder's debug files and folders stay out. */
const RELEASE_ASSET = /\.(tar\.gz|dmg|zip|blockmap|AppImage|deb)$|^latest-.*\.yml$|^install\.sh$/;

/** SHA256SUMS over the release's assets, as install.sh and `gradcode update` check them. */
function writeSums() {
  const files = NodeFS.readdirSync(release).filter((f) => RELEASE_ASSET.test(f));
  const lines = files.toSorted().map((f) => `${sha256(NodePath.join(release, f))}  ${f}`);
  NodeFS.writeFileSync(NodePath.join(release, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

/**
 * The Homebrew cask and AUR PKGBUILD for this release, from packaging/ with the version and
 * SHA256SUMS filled in, into dist/publish for release.yml to push to the tap and the AUR.
 */
function writeManifests() {
  const sums = new Map(
    NodeFS.readFileSync(NodePath.join(release, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .map((line) => [line.slice(66), line.slice(0, 64)]),
  );
  const values: Record<string, string | undefined> = {
    version,
    sha256_dmg_arm64: sums.get(`gradcode-${version}-arm64.dmg`),
    sha256_dmg_x64: sums.get(`gradcode-${version}-x64.dmg`),
    sha256_deb_amd64: sums.get(`gradcode_${version}_amd64.deb`),
    sha256_deb_arm64: sums.get(`gradcode_${version}_arm64.deb`),
  };
  const out = NodePath.join(root, "dist/publish");
  NodeFS.mkdirSync(out, { recursive: true });
  for (const file of ["homebrew/gradcode.rb", "aur/PKGBUILD"]) {
    const text = NodeFS.readFileSync(NodePath.join(root, "packaging", file), "utf8").replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => {
        const value = values[key];
        if (!value) throw new Error(`${file}: no ${key} in SHA256SUMS`);
        return value;
      },
    );
    NodeFS.writeFileSync(NodePath.join(out, NodePath.basename(file)), text);
  }
}

const [step, ...args] = process.argv.slice(2);
const steps: Record<string, () => unknown> = {
  runtime: buildRuntime,
  cli: () => buildCli(args.length ? args : CLI_TARGETS),
  desktop: () => buildDesktop(args),
  npm: buildNpm,
  sums: writeSums,
  manifests: writeManifests,
  version: () => console.log(version),
};
const fn = step ? steps[step] : undefined;
if (!fn) {
  console.error(`pnpm dist <${Object.keys(steps).join("|")}>`);
  process.exit(1);
}
await fn();
