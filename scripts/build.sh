#!/bin/sh
# Packs extension/ into release/in-other-words-v<version>.zip.
# The zip holds one folder, so unzipping it gives something you can point
# Chrome's "Load unpacked" straight at.
set -eu

cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
name="in-other-words-v$version"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

node --test test/unit.test.mjs >/dev/null

mkdir -p "$stage/$name" release
cp -R extension/. "$stage/$name/"
find "$stage" -name '.DS_Store' -delete

rm -f "release/$name.zip"
(cd "$stage" && zip -qrX "$OLDPWD/release/$name.zip" "$name")
(cd release && shasum -a 256 "$name.zip" > "$name.zip.sha256")

echo "release/$name.zip"
cat "release/$name.zip.sha256"
