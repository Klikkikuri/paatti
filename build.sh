#! /bin/bash
cd suola/rust
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/rust.wasm ../../lib/suola.wasm
cd ../..
