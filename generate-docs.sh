#!/bin/bash

set -e

rm -rf "./repo"
rm -rf "./docs"

git clone --depth 1 "https://github.com/Azure/bicep-registry-modules.git" "./repo"

mkdir -p "./docs"

find "./repo/avm" -type f -name "README.md" | while read -r readme; do
  module_name=$(basename "$(dirname "$readme")")

  uri="https://github.com/Azure/bicep-registry-modules/blob/main/avm/${readme#./repo/avm/}"

  tmpfile=$(mktemp)
  echo "$uri" > "$tmpfile"
  echo "" >> "$tmpfile"
  cat "$readme" >> "$tmpfile"
  mv "$tmpfile" "docs/$module_name.md"
done

rm -rf "./repo"
