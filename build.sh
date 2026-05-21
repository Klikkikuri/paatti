#!/bin/bash

set -e

# Prefer podman instead of docker if installed.
docker () {
    if type podman
    then podman "$@"
    else command docker "$@"
    fi
}

git submodule init
git submodule update

# Build suola artifacts.
docker build --target wasm-builder -t buildsuola suola/
docker run --mount type=bind,src=$(pwd)/suola/build/,dst=/app/build buildsuola
