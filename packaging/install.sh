#!/bin/sh
# Installs getmyprof from its public releases. Needs only sh, curl, tar and shasum or sha256sum.
#
#   curl -fsSL https://github.com/EhsanulHaqueSiam/getmyprof/releases/latest/download/install.sh | sh
#
# The `getmyprof` command by default: a tarball with its own Node, unpacked under
# ~/.local/share/getmyprof/<version> and linked from ~/.local/bin. `sh -s -- --desktop` installs the
# desktop app instead: getmyprof.app in /Applications, or the AppImage plus a menu entry on Linux.
#
#   GETMYPROF_VERSION      a version instead of the newest (0.2.0)
#   GETMYPROF_INSTALL_DIR  where versions unpack (~/.local/share/getmyprof)
#   GETMYPROF_BIN_DIR      where the `getmyprof` link goes (~/.local/bin)
#   GETMYPROF_APP_DIR      where the Mac app goes (/Applications)
#   GETMYPROF_RELEASE_URL  a mirror of the releases (https://github.com/<repo>/releases)
set -eu

repo="EhsanulHaqueSiam/getmyprof"
releases="${GETMYPROF_RELEASE_URL:-https://github.com/$repo/releases}"
install_dir="${GETMYPROF_INSTALL_DIR:-$HOME/.local/share/getmyprof}"
bin_dir="${GETMYPROF_BIN_DIR:-$HOME/.local/bin}"
app_dir="${GETMYPROF_APP_DIR:-/Applications}"
desktop=false
[ "${1:-}" = "--desktop" ] && desktop=true

fail() {
  printf 'getmyprof install: %s\n' "$1" >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || fail "curl is required"
# Give up on a server that won't connect in 10s, or a download that crawls under 1 KB/s for 30s.
get() { curl -fL --connect-timeout 10 --speed-limit 1024 --speed-time 30 "$@"; }
command -v tar >/dev/null 2>&1 || fail "tar is required"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "getmyprof runs on macOS and Linux" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "no build for $(uname -m)" ;;
esac
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "the release is built for glibc Linux; on musl use: npx getmyprof@latest"
fi

version="${GETMYPROF_VERSION:-}"
if [ -z "$version" ]; then
  # .../releases/latest redirects to .../releases/tag/v<version>.
  latest="$(get -sSI --max-time 30 -o /dev/null -w '%{url_effective}' "$releases/latest")" ||
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
  [ -f "$tmp/SHA256SUMS" ] || get -sS "$releases/download/v$version/SHA256SUMS" -o "$tmp/SHA256SUMS" ||
    fail "release v$version has no SHA256SUMS"
  printf 'Downloading %s\n' "$1" >&2
  get --progress-bar "$releases/download/v$version/$1" -o "$tmp/$1" ||
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
  fetch "getmyprof-$version-$arch.dmg"
  mkdir "$tmp/mnt"
  hdiutil attach -nobrowse -readonly -quiet -mountpoint "$tmp/mnt" "$tmp/getmyprof-$version-$arch.dmg"
  mkdir -p "$app_dir"
  rm -rf "$app_dir/getmyprof.app"
  ditto "$tmp/mnt/getmyprof.app" "$app_dir/getmyprof.app"
  hdiutil detach -quiet "$tmp/mnt"
  printf 'Installed getmyprof %s in %s\n' "$version" "$app_dir"
  exit 0
fi

if "$desktop"; then
  # The AppImage replaces itself on update, so it lives at a fixed path the menu entry points to.
  name="getmyprof-$version-$([ "$arch" = x64 ] && echo x86_64 || echo arm64).AppImage"
  fetch "$name"
  data="${XDG_DATA_HOME:-$HOME/.local/share}"
  mkdir -p "$install_dir" "$data/applications"
  mv "$tmp/$name" "$install_dir/getmyprof.AppImage"
  chmod +x "$install_dir/getmyprof.AppImage"
  (cd "$tmp" && "$install_dir/getmyprof.AppImage" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1) || true
  icon="$(find "$tmp/squashfs-root" -name '*.png' -type f 2>/dev/null | head -n 1)"
  [ -n "$icon" ] && cp "$icon" "$install_dir/getmyprof.png"
  cat >"$data/applications/getmyprof-desktop.desktop" <<EOF
[Desktop Entry]
Name=getmyprof
Comment=Find professors who can fund your degree
Exec="$install_dir/getmyprof.AppImage" %U
Icon=$install_dir/getmyprof.png
Type=Application
Categories=Education;
StartupWMClass=getmyprof-desktop
EOF
  printf 'Installed getmyprof %s: open it from your app launcher.\n' "$version"
  exit 0
fi

stem="getmyprof-$version-$os-$arch"
fetch "$stem.tar.gz"
tar -xzf "$tmp/$stem.tar.gz" -C "$tmp"
"$tmp/$stem/getmyprof" --version >/dev/null || fail "the downloaded getmyprof doesn't run here"
previous="$(readlink "$bin_dir/getmyprof" 2>/dev/null || true)"
mkdir -p "$install_dir" "$bin_dir"
rm -rf "${install_dir:?}/$version"
mv "$tmp/$stem" "$install_dir/$version"
ln -sfn "$install_dir/$version/getmyprof" "$bin_dir/getmyprof"
# Keep this version and the one before it (a background server may still run from it).
for old in "$install_dir"/*; do
  [ -d "$old" ] || continue
  case "$old" in
    "$install_dir/$version" | "$(dirname "$previous")") ;;
    *) rm -rf "$old" ;;
  esac
done

printf 'Installed getmyprof %s\n' "$version"
case ":$PATH:" in
  *":$bin_dir:"*) printf 'Run: getmyprof\n' ;;
  *) printf 'Add %s to your PATH, then run: getmyprof\n' "$bin_dir" ;;
esac
