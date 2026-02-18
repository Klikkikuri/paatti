#!/bin/bash

set -e

OUTPUT=./klikkikuri-paatti.zip

zip -r -FS $OUTPUT \
  ./icons/ \
  ./_locales/ \
  ./manifest.json \
  ./src/ \
  ./suola/build/js.wasm \
  ./suola/build/suola.js \
  ./suola/build/wasm_exec.js

echo "Packaged Paatti to '$OUTPUT'"
