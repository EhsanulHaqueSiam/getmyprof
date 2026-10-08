#!/bin/sh
# The `getmyprof` command in a release tarball: runs cli.mjs on the Node beside it.
# install.sh links ~/.local/bin/getmyprof here, so follow links to find the tarball's folder.
self="$0"
while [ -L "$self" ]; do
  link="$(readlink "$self")"
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
dir="$(cd "$(dirname "$self")" && pwd)"
exec "$dir/node" "$dir/cli.mjs" "$@"
