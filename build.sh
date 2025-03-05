#! /bin/bash
cd suola/suora
cargo build --lib --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/suora.wasm ../../lib/suola.wasm
cd ../..
