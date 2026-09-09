Klikkikuri Paatti contains one WebAssembly module, build/js.wasm, with its loader build/wasm_exec.js. Both come
from the Go source in the suola/ directory of the source archive, compiled with TinyGo. All other code ships as
written.

The shipped module is the release artifact of the suola tag that the source archive pins, built by suola's own
CI. The build attestation is verifiable with GitHub CLI:

    gh attestation verify build/js.wasm --repo Klikkikuri/suola

To rebuild the package from the source archive, with Docker available:

1. Unpack the archive.
2. Run: make store-firefox STORE_REVISION=<fourth component of this version>
   The build compiles suola in a container from suola/Dockerfile, which pins the TinyGo version, and writes
   the package tree to build/store-firefox/. This tree is what was submitted.
3. Compare build/store-firefox/ with the submitted package.

docs/release.md in the archive describes the build and the release process.
