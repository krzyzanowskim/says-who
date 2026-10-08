#!/bin/sh
# Packs extension/ into release/says-who-v<version>.zip.
# The zip holds one folder, so unzipping it gives something you can point
# Chrome's "Load unpacked" straight at.
set -eu

cd "$(dirname "$0")/.."
version=$(node -p "require('./extension/manifest.json').version")
name="says-who-v$version"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

node --test test/unit.test.mjs >/dev/null

mkdir -p "$stage/$name" release
cp -R extension/. "$stage/$name/"
find "$stage" -name '.DS_Store' -delete

rm -f "release/$name.zip" "release/$name-cws.zip"
(cd "$stage" && zip -qrX "$OLDPWD/release/$name.zip" "$name")
(cd release && shasum -a 256 "$name.zip" > "$name.zip.sha256")

# Chrome Web Store requires manifest.json directly at the root of the zip archive.
(cd extension && zip -qrX "$OLDPWD/release/$name-cws.zip" . -x "*.DS_Store*")
(cd release && shasum -a 256 "$name-cws.zip" > "$name-cws.zip.sha256")

echo "GitHub unpacked release: release/$name.zip"
cat "release/$name.zip.sha256"
echo "Chrome Web Store upload: release/$name-cws.zip"
cat "release/$name-cws.zip.sha256"

