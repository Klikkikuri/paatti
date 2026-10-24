Klikkikuri Paatti contains one WebAssembly module, build/js.wasm, with its loader build/wasm_exec.js. Both come
from the Go source in the suola/ directory of the source archive, compiled with TinyGo. All other code ships as
written.

The shipped module is the release artifact of the suola tag that the source archive pins, built by suola's own
CI. The build attestation is verifiable with GitHub CLI:

    gh attestation verify build/js.wasm --repo Klikkikuri/suola

To rebuild the package from the source archive, with Docker available:

1. Unpack the archive.
2. Run: make build-suola-local
   This compiles suola in a container from suola/Dockerfile, which pins the TinyGo version, and writes
   build/js.wasm and build/wasm_exec.js.
3. Run: make store-firefox STORE_REVISION=<fourth component of this version>
   This stages the package tree in build/store-firefox/. It keeps the module from step 2, because that module
   is newer than the suola source. Without step 2 it downloads the attested release module instead.
4. Compare build/store-firefox/ with the submitted package.

The archive's e2e suite (tests/e2e) runs against the karikko development server as plain Node tests. It is not
part of the package.

## The development features

The package ships code for development purposes (development-only; see docs/PRIVACY_POLICY_DEVELOPMENT.md).
A store install cannot reach it, unless the user selects the environment `Development` in the settings and adds a
provider on their own machine that names the link relation `x-paatti-dev-capture`. This requires multiple intentional
actions from the user.

The capture row of the popup then sends the links and headlines of the page to that provider's capture endpoint on the
loopback address. The popup part lives in src/options/dev-capture.js and src/options/capture-target.js; the content
script answers the `capturePage` message in src/contentScript.js. docs/development/adding-a-new-site.md, section
1, describes the feature from the developer's side.

docs/release.md in the archive describes the build and the release process.
