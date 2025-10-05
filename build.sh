#!/bin/bash

set -e

git submodule init
git submodule update

# Build suola artifacts.
docker build --target builder -t buildsuola suola/
docker run --mount type=bind,src=$(pwd)/suola/build/,dst=/app/build buildsuola

./generate_test_data.py
