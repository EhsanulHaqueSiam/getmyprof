#!/bin/sh
# Installs gradcode from its public releases. Needs only sh, curl, tar and shasum or sha256sum.
#
#   curl -fsSL https://raw.githubusercontent.com/EhsanulHaqueSiam/gradcode-releases/main/install.sh | sh
#
# The `gradcode` command by default: a tarball with its own Node, unpacked under
# ~/.local/share/gradcode/<version> and linked from ~/.local/bin. `sh -s -- --desktop` installs the
# desktop app instead: gradcode.app in /Applications, or the AppImage plus a menu entry on Linux.
#
#   GRADCODE_VERSION      a version instead of the newest (0.2.0)
#   GRADCODE_INSTALL_DIR  where versions unpack (~/.local/share/gradcode)
#   GRADCODE_BIN_DIR      where the `gradcode` link goes (~/.local/bin)
#   GRADCODE_APP_DIR      where the Mac app goes (/Applications)
#   GRADCODE_RELEASE_URL  a mirror of the releases (https://github.com/<repo>/releases)
set -eu

repo="EhsanulHaqueSiam/gradcode-releases"
releases="${GRADCODE_RELEASE_URL:-https://github.com/$repo/releases}"
install_dir="${GRADCODE_INSTALL_DIR:-$HOME/.local/share/gradcode}"
bin_dir="${GRADCODE_BIN_DIR:-$HOME/.local/bin}"
app_dir="${GRADCODE_APP_DIR:-/Applications}"
desktop=false
[ "${1:-}" = "--desktop" ] && desktop=true

fail() {
  printf 'gradcode install: %s\n' "$1" >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "gradcode runs on macOS and Linux" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "no build for $(uname -m)" ;;
esac
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "the release is built for glibc Linux; on musl use: npx gradcode@latest"
fi

version="${GRADCODE_VERSION:-}"
if [ -z "$version" ]; then
  # .../releases/latest redirects to .../releases/tag/v<version>.
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "$releases/latest")" ||
    fail "can't reach $releases"
  version="${latest##*/v}"
fi
case "$version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "no release found at $releases" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Downloads one asset of the release into $tmp and checks it against SHA256SUMS.
fetch() {
  [ -f "$tmp/SHA256SUMS" ] || curl -fsSL "$releases/download/v$version/SHA256SUMS" -o "$tmp/SHA256SUMS" ||
    fail "release v$version has no SHA256SUMS"
  printf 'Downloading %s\n' "$1" >&2
  curl -fL --progress-bar "$releases/download/v$version/$1" -o "$tmp/$1" ||
    fail "release v$version has no $1"
  expected="$(grep " $1\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$1" | cut -d' ' -f1)"
  else
    actual="$(shasum -a 256 "$tmp/$1" | cut -d' ' -f1)"
  fi
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "$1 doesn't match SHA256SUMS"
}

if "$desktop" && [ "$os" = darwin ]; then
  fetch "gradcode-$version-$arch.dmg"
  mkdir "$tmp/mnt"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$tmp/mnt" "$tmp/gradcode-$version-$arch.dmg"
  mkdir -p "$app_dir"
  rm -rf "$app_dir/gradcode.app"
  ditto "$tmp/mnt/gradcode.app" "$app_dir/gradcode.app"
  hdiutil detach -quiet "$tmp/mnt"
  printf 'Installed gradcode %s in %s\n' "$version" "$app_dir"
  exit 0
fi

if "$desktop"; then
  # The AppImage replaces itself on update, so it lives at a fixed path the menu entry points to.
  name="gradcode-$version-$([ "$arch" = x64 ] && echo x86_64 || echo arm64).AppImage"
  fetch "$name"
  data="${XDG_DATA_HOME:-$HOME/.local/share}"
  mkdir -p "$install_dir" "$data/applications"
  mv "$tmp/$name" "$install_dir/gradcode.AppImage"
  chmod +x "$install_dir/gradcode.AppImage"
  (cd "$tmp" && "$install_dir/gradcode.AppImage" --appimage-extract gradcode-desktop.png >/dev/null 2>&1) &&
    cp "$tmp/squashfs-root/gradcode-desktop.png" "$install_dir/gradcode.png" || true
  cat >"$data/applications/gradcode-desktop.desktop" <<EOF
[Desktop Entry]
Name=gradcode
Comment=Find professors who can fund your degree
Exec="$install_dir/gradcode.AppImage" %U
Icon=$install_dir/gradcode.png
Type=Application
Categories=Education;
StartupWMClass=gradcode-desktop
EOF
  printf 'Installed gradcode %s: open it from your app launcher.\n' "$version"
  exit 0
fi

stem="gradcode-$version-$os-$arch"
fetch "$stem.tar.gz"
tar -xzf "$tmp/$stem.tar.gz" -C "$tmp"
"$tmp/$stem/gradcode" --version >/dev/null || fail "the downloaded gradcode doesn't run here"
previous="$(readlink "$bin_dir/gradcode" 2>/dev/null || true)"
mkdir -p "$install_dir" "$bin_dir"
rm -rf "${install_dir:?}/$version"
mv "$tmp/$stem" "$install_dir/$version"
ln -sfn "$install_dir/$version/gradcode" "$bin_dir/gradcode"
# Keep this version and the one before it (a background server may still run from it).
for old in "$install_dir"/*; do
  [ -d "$old" ] || continue
  case "$old" in
    "$install_dir/$version" | "$(dirname "$previous")") ;;
    *) rm -rf "$old" ;;
  esac
done

printf 'Installed gradcode %s\n' "$version"
case ":$PATH:" in
  *":$bin_dir:"*) printf 'Run: gradcode\n' ;;
  *) printf 'Add %s to your PATH, then run: gradcode\n' "$bin_dir" ;;
esac
