# Homebrew cask for a tap (EhsanulHaqueSiam/homebrew-tap, as Casks/getmyprof.rb):
#   brew install --cask EhsanulHaqueSiam/tap/getmyprof
# release.yml fills in the version and checksums on every release.
cask "getmyprof" do
  arch arm: "arm64", intel: "x64"

  version "{{version}}"
  sha256 arm:   "{{sha256_dmg_arm64}}",
         intel: "{{sha256_dmg_x64}}"

  url "https://github.com/EhsanulHaqueSiam/getmyprof/releases/download/v#{version}/getmyprof-#{version}-#{arch}.dmg"
  name "getmyprof"
  desc "Find professors who can fund your degree"
  homepage "https://github.com/EhsanulHaqueSiam/getmyprof"

  livecheck do
    url :url
    strategy :github_latest
  end

  # The app updates itself (apps/desktop/src/updates.ts).
  auto_updates true
  depends_on macos: ">= :monterey"

  app "getmyprof.app"

  # Ad-hoc signed until there is a Developer ID: without this Gatekeeper won't open it.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/getmyprof.app"]
  end

  # The hunt and the app's profile live in ~/.getmyprof and stay.
  zap trash: [
    "~/Library/Logs/getmyprof",
    "~/Library/Preferences/dev.getmyprof.app.plist",
  ]
end
