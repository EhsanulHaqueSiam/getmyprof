# Releases

One version, in the root `package.json`. A `vX.Y.Z` tag runs `.github/workflows/release.yml`,
which builds everything and publishes it as this repo's GitHub release, with the workflow's own
token. Installed apps and `getmyprof update` look there.

## What ships

| Asset                                                          | Who uses it                                                                                          | Updates                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `getmyprof-X.Y.Z-{darwin,linux}-{arm64,x64}.tar.gz`            | `install.sh`: the `getmyprof` command, with its own Node 24                                          | `getmyprof update` runs the release's install.sh |
| `getmyprof-X.Y.Z-{arm64,x64}.dmg` and `.zip`                   | the Mac app; the cask; the zip is Squirrel's                                                         | Update runs the release's install.sh over it     |
| `getmyprof-X.Y.Z-{x86_64,arm64}.AppImage`                      | `install.sh --desktop` on Linux                                                                      | downloads and replaces itself                    |
| `getmyprof_X.Y.Z_{amd64,arm64}.deb`                            | `apt install`, and the AUR package `getmyprof-bin`                                                   | a notice; the package manager installs           |
| `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` | electron-updater's feed                                                                              |                                                  |
| `SHA256SUMS`                                                   | install.sh and `getmyprof update` check every download against it                                    |                                                  |
| `install.sh`                                                   | `curl -fsSL https://github.com/EhsanulHaqueSiam/getmyprof/releases/latest/download/install.sh \| sh` | always the latest release's                      |

The npm package `getmyprof` (`npx getmyprof@latest`), the Homebrew cask and the AUR `PKGBUILD`
are built every release and published only when their secret is set.

## How the pieces run

- `pnpm dist runtime` bundles `apps/server/src/bin.ts` and `cli.ts` with `vp pack` into
  `apps/desktop/dist/runtime` beside the built web app. The server serves `web/` itself when
  `GETMYPROF_WEB_DIR` is set (`apps/server/src/static.ts`); dev doesn't set it.
- The desktop app runs that server on Electron's own Node (`ELECTRON_RUN_AS_NODE`, Node 24.21
  in Electron 44, with `node:sqlite` and FTS5). The CLI tarball ships the official Node 24.21.
- **No download carries the Claude Code binary**: its license reserves redistribution.
  `apps/server/src/agent/binary.ts` uses the SDK's own platform package when node_modules has it
  (dev, npm installs), else fetches `@anthropic-ai/claude-agent-sdk-<os>-<arch>` at the version
  `pnpm dist runtime` pins from registry.npmjs.org into `GETMYPROF_HOME/claude/<version>`,
  checked against the registry's sha512. The CLI does that on its first run with a progress
  line; the server starts it at boot and Setup's Connect step shows the percent, or the error
  with a Download button. When it can't be fetched, a `claude` on PATH stands in. Sign-in runs
  that binary's own `auth login`: `getmyprof login`, or Setup's Sign in (browser, or a pasted code).
- One server per `GETMYPROF_HOME`: the launcher records it in `server.json` with the process
  that answers for it, and the desktop app and the CLI open a running one instead of starting a
  second (two would both run loops and the send queue). A server whose app crashed is adopted by
  the next app launch (which stops it on quit) and can be stopped with `getmyprof stop`. Port
  4350 when free, so the page's origin and its localStorage stay put.
- The app's Electron profile and its one-instance lock live in `GETMYPROF_HOME/desktop`, so a run
  on a temp home never touches a real install's.
- On Linux the command line is `getmyprof` and the app is `getmyprof-desktop`.

## Cutting a release

1. Bump `version` in the root `package.json`, commit, and push to `main`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow fails if the tag and the version differ.

Local builds use the same steps: `pnpm dist runtime`, then
`pnpm dist cli darwin-arm64`, `pnpm dist desktop mac arm64`, `pnpm dist npm`, `pnpm dist sums`
into `dist/release`. `GETMYPROF_UPDATE_URL=http://host/feed` points a test build's updater at
any folder holding a `latest-*.yml`. From a checkout, `pnpm dist runtime` then
`pnpm --filter @getmyprof/desktop start` runs the app unpackaged.

## Secrets (Settings, Secrets and variables, Actions)

The release itself needs none. Each secret below turns on one more channel.

| Secret                                                  | What                                                                          | Without it                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| `HOMEBREW_TAP_KEY`                                      | private half of a write deploy key on `EhsanulHaqueSiam/homebrew-tap`         | the cask stays in the run artifact |
| `AUR_SSH_KEY`                                           | private key registered on the AUR account that owns `getmyprof-bin`           | the PKGBUILD stays in the artifact |
| `NPM_TOKEN`                                             | npm token that can publish `getmyprof`                                        | the package stays in the artifact  |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                          | Developer ID Application certificate as base64 `.p12`, and its password       | ad-hoc signed Mac app              |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key (`.p8` contents), its id and issuer, for notarizing | not notarized                      |

A failed channel (say the AUR key isn't registered yet) can be rerun alone from the run's page
once it's fixed: the release is already out.

## Traps

- **An unsigned Mac app.** Squirrel.Mac only installs updates into a Developer ID signed app, so
  `apps/desktop/src/updates.ts` checks the signature, and an unsigned app's Update runs the
  release's install.sh (checked against SHA256SUMS) with `--desktop` over its own bundle, then
  restarts. Gatekeeper blocks an ad-hoc app downloaded in a browser; curl (install.sh) sets no
  quarantine and the cask strips it. With a browser download:
  `xattr -dr com.apple.quarantine /Applications/getmyprof.app`.
- **Testing an update.** Build with `GETMYPROF_UPDATE_URL=http://127.0.0.1:<port>/feed`, serve a
  folder whose `feed/latest-mac.yml` names a higher version and whose
  `releases/download/v<that>/` holds its dmg, install.sh and SHA256SUMS, and start the app's
  binary with `GETMYPROF_RELEASE_URL=http://127.0.0.1:<port>/releases` and a temp `GETMYPROF_HOME`.
- **The first run needs the network** for the Claude Code binary (about 100 MB to download).
  Offline with no `claude` on PATH, the app and the CLI still start and say why the agent can't.
- **Ubuntu 24.04 and AppImages.** Its AppArmor blocks Chromium's sandbox in any AppImage; the
  `.deb` ships a setuid sandbox and works. Arch is fine.
- **`ELECTRON_RUN_AS_NODE` in your shell** (some terminals inside Electron apps set it) makes
  the packaged app start as plain Node. Unset it to launch from there.
