# Homebrew cask for a tap (EhsanulHaqueSiam/homebrew-tap, as Casks/gradcode.rb):
#   brew install --cask EhsanulHaqueSiam/tap/gradcode
# release.yml fills in the version and checksums on every release.
cask "gradcode" do
  arch arm: "arm64", intel: "x64"

  version "{{version}}"
  sha256 arm:   "{{sha256_dmg_arm64}}",
         intel: "{{sha256_dmg_x64}}"

  url "https://github.com/EhsanulHaqueSiam/gradcode-releases/releases/download/v#{version}/gradcode-#{version}-#{arch}.dmg"
  name "gradcode"
  desc "Find professors who can fund your degree"
  homepage "https://github.com/EhsanulHaqueSiam/gradcode-releases"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "gradcode.app"

  # Ad-hoc signed until there is a Developer ID: without this Gatekeeper won't open it.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/gradcode.app"]
  end

  # The hunt itself lives in ~/.gradcode and stays.
  zap trash: [
    "~/Library/Application Support/gradcode",
    "~/Library/Logs/gradcode",
    "~/Library/Preferences/dev.gradcode.app.plist",
  ]
end
