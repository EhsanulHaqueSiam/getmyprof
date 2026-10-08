# Releases

One version, in the root `package.json`. A `vX.Y.Z` tag runs `.github/workflows/release.yml`,
which builds everything and publishes it to the public repo `EhsanulHaqueSiam/gradcode-releases`
(the source repo stays private). Installed apps and `gradcode update` look there.

## What ships

| Asset                                                          | Who uses it                                                                                             | Updates                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `gradcode-X.Y.Z-{darwin,linux}-{arm64,x64}.tar.gz`             | `install.sh`: the `gradcode` command, with its own Node 24                                              | `gradcode update` reruns install.sh    |
| `gradcode-X.Y.Z-{arm64,x64}.dmg` and `.zip`                    | the Mac app; the cask; the zip is Squirrel's                                                            | a notice until there is a Developer ID |
| `gradcode-X.Y.Z-{x86_64,arm64}.AppImage`                       | `install.sh --desktop` on Linux                                                                         | downloads and replaces itself          |
| `gradcode_X.Y.Z_{amd64,arm64}.deb`                             | `apt install`, and the AUR package `gradcode-bin`                                                       | a notice; the package manager installs |
| `latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` | electron-updater's feed                                                                                 |                                        |
| `SHA256SUMS`                                                   | install.sh checks every download against it                                                             |                                        |
| `install.sh` on the repo's `main`                              | `curl -fsSL https://raw.githubusercontent.com/EhsanulHaqueSiam/gradcode-releases/main/install.sh \| sh` | synced each release                    |

The npm package `gradcode` (`npx gradcode@latest`), the Homebrew cask and the AUR `PKGBUILD`
are built every release and published only when their secret is set.

## How the pieces run

- `pnpm dist runtime` bundles `apps/server/src/bin.ts` and `cli.ts` with `vp pack` into
  `apps/desktop/dist/runtime` beside the built web app. The server serves `web/` itself when
  `GRADCODE_WEB_DIR` is set (`apps/server/src/static.ts`); dev doesn't set it.
- The desktop app runs that server on Electron's own Node (`ELECTRON_RUN_AS_NODE`, Node 24.21
  in Electron 44, with `node:sqlite` and FTS5). The CLI tarball ships the official Node 24.21.
- The Agent SDK finds its native Claude binary through `node_modules/@anthropic-ai/
claude-agent-sdk-<os>-<arch>/claude` next to `server.mjs`; the build puts the target's copy
  there (outside the asar, so it can run).
- One server per `GRADCODE_HOME`: the launcher records it in `server.json`, and the desktop app
  and the CLI open a running one instead of starting a second (two would both run loops and the
  send queue). Port 4350 when free, so the page's origin and its localStorage stay put.
- On Linux the command line is `gradcode` and the app is `gradcode-desktop`.

## Cutting a release

1. Bump `version` in the root `package.json`, commit, and push to `main`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. The workflow fails if the tag and the version differ.

Local builds use the same steps: `pnpm dist runtime`, then
`pnpm dist cli darwin-arm64`, `pnpm dist desktop mac arm64`, `pnpm dist npm`, `pnpm dist sums`
into `dist/release`. `GRADCODE_UPDATE_URL=http://host/feed` points a test build's updater at
any folder holding a `latest-*.yml`. From a checkout, `pnpm dist runtime` then
`pnpm --filter @gradcode/desktop start` runs the app unpackaged.

## Secrets (source repo, Settings, Secrets and variables, Actions)

| Secret                                                  | What                                                                          | Without it                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| `RELEASES_TOKEN`                                        | fine-grained token, Contents read and write on `gradcode-releases`            | the publish job fails              |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                          | Developer ID Application certificate as base64 `.p12`, and its password       | ad-hoc signed Mac app              |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key (`.p8` contents), its id and issuer, for notarizing | not notarized                      |
| `HOMEBREW_TAP_TOKEN`                                    | token with Contents write on `EhsanulHaqueSiam/homebrew-tap`                  | the cask stays in the run artifact |
| `AUR_SSH_KEY`                                           | private key registered on the AUR account that owns `gradcode-bin`            | the PKGBUILD stays in the artifact |
| `NPM_TOKEN`                                             | npm automation token that can publish `gradcode`                              | the package stays in the artifact  |

The variable `GRADCODE_RELEASES` (owner/name) moves the whole feed to another public repo.

## Traps

- **An unsigned Mac app.** Squirrel.Mac only installs updates into a Developer ID signed app, so
  `apps/desktop/src/updates.ts` checks the signature and turns an update into a notice whose
  Download opens the release. Gatekeeper blocks an ad-hoc app downloaded in a browser; curl
  (install.sh) sets no quarantine and the cask strips it. With a browser download:
  `xattr -dr com.apple.quarantine /Applications/gradcode.app`.
- **Size.** The Claude binary is 235 MB of every download; `compression: "maximum"` keeps a dmg
  near 200 MB.
- **Ubuntu 24.04 and AppImages.** Its AppArmor blocks Chromium's sandbox in any AppImage; the
  `.deb` ships a setuid sandbox and works. Arch is fine.
- **`ELECTRON_RUN_AS_NODE` in your shell** (any terminal inside an Electron app, T3 Code's
  included) makes the packaged app start as plain Node. Unset it to launch from there.
