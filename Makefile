DOCKER ?= docker
NON_OSS ?= 0
BUILD_DIR := $(shell pwd)/build
TEST_DATA_BUILD_DIR := $(BUILD_DIR)/test_data
TEST_DATA_SIGNATURES := $(TEST_DATA_BUILD_DIR)/signatures.txt
BUILD_TEST_DATA := $(TEST_DATA_BUILD_DIR)/data.json
BUILD_SOURCE_DIST := $(BUILD_DIR)/source-code.zip
STORE_REVISION ?= 1
CHROME_EXTENSION_ID := jalegaigmgljhnaakmbbaajooffgcbgc
AMO_METADATA := $(BUILD_DIR)/amo-metadata.json
DIST_DIR := $(BUILD_DIR)/dist
EXTENSION_ASSETS := icons _locales manifest.json src LICENSE.md LISENSSI.md docs/PRIVACY_POLICY.md
WASM_ASSETS := js.wasm wasm_exec.js
WASM_OUTPUTS := $(addprefix $(BUILD_DIR)/, $(WASM_ASSETS))
# The module's inputs, taken from the submodule so the list cannot drift.
SUOLA_SOURCES := $(patsubst %,suola/%,$(shell git -C suola ls-files 2>/dev/null))
# Outside a git tree -- an unpacked source-dist -- ask the filesystem instead.
ifeq ($(SUOLA_SOURCES),)
SUOLA_SOURCES := $(shell find suola -type f -not -path 'suola/build/*')
endif


build: package

init:
	git submodule update --init --recursive

# Ensure suola submodule is initialized and up to date with superproject commit pointer.
# If in a Git repo: initializes suola if missing, and warns if the checked out commit differs from the pointer.
# If not in a Git repo: verifies suola directory exists.
# The init branch has to exit explicitly: the pointer check below is the last command in the block, and an `if`
# whose condition is false returns 0 -- which used to mask a failed init and let the build continue without suola.
ensure-suola:
	@if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
		if [ ! -f suola/Makefile ]; then \
			echo "suola submodule not found. Initializing suola submodule..."; \
			if ! $(MAKE) init; then \
				echo "Error: failed to initialize the suola submodule."; \
				exit 1; \
			fi; \
			if [ ! -f suola/Makefile ]; then \
				echo "Error: suola submodule is still incomplete after 'make init'."; \
				exit 1; \
			fi; \
		fi; \
		if git submodule status suola | grep -q '^[+]'; then \
			echo "Warning: suola submodule commit does not match superproject pointer."; \
			echo "Run 'git submodule update'"; \
		fi; \
	elif [ ! -f suola/Makefile ]; then \
		echo "Error: suola directory missing or incomplete in non-git tree."; \
		exit 1; \
	fi

build-suola: $(WASM_OUTPUTS)

# For when the artifacts' timestamps say they are current but they are not.
rebuild-suola:
	rm -f $(WASM_OUTPUTS)
	$(MAKE) build-suola

$(WASM_OUTPUTS) &: $(SUOLA_SOURCES) | ensure-suola
ifneq ($(USE_RELEASE_ARTIFACTS),)
	# Fetch pre-built artifacts from GitHub releases for tagged suola submodule
	@if [ -d suola ] && (cd suola && git describe --tags --exact-match >/dev/null 2>&1); then \
		SUOLA_TAG=$$(cd suola && git describe --tags --exact-match); \
		echo "suola submodule is tagged at $$SUOLA_TAG. Fetching pre-built artifacts from GitHub releases..."; \
		mkdir -p $(BUILD_DIR); \
		rm -f $(BUILD_DIR)/js.wasm $(BUILD_DIR)/wasm_exec.js; \
		curl -L -f -o $(BUILD_DIR)/js.wasm "https://github.com/Klikkikuri/suola/releases/download/$$SUOLA_TAG/js.wasm" && \
		curl -L -f -o $(BUILD_DIR)/wasm_exec.js "https://github.com/Klikkikuri/suola/releases/download/$$SUOLA_TAG/wasm_exec.js"; \
	else \
		echo "Error: suola submodule is not tagged or found. Cannot fetch release artifacts." && exit 1; \
	fi
else
	$(MAKE) build-suola-local
endif

build-suola-local: ensure-suola
ifeq ($(DOCKER),false)
	$(MAKE) check-tinygo
	$(MAKE) -C suola js
	mkdir -p $(BUILD_DIR)
	cp suola/build/js.wasm $(BUILD_DIR)/js.wasm
	cp suola/build/wasm_exec.js $(BUILD_DIR)/wasm_exec.js
else
	mkdir -p suola/build
	$(DOCKER) build --target wasm-builder -t buildsuola suola/
	# The extension only needs the browser module and its TinyGo support file.
	$(DOCKER) run --mount type=bind,src=$(shell pwd)/suola/build/,dst=/app/build buildsuola make js
	mkdir -p $(BUILD_DIR)
	cp suola/build/js.wasm $(BUILD_DIR)/js.wasm
	cp suola/build/wasm_exec.js $(BUILD_DIR)/wasm_exec.js
endif

# The browser module is built with TinyGo; stock Go no longer produces js.wasm,
# and the two toolchains' wasm_exec.js are not interchangeable.
check-tinygo:
	@command -v tinygo >/dev/null 2>&1 || { \
		echo "Error: tinygo not found on PATH."; \
		echo "Install TinyGo (https://tinygo.org/getting-started/install/),"; \
		echo "or build in a container by dropping DOCKER=false."; \
		exit 1; \
	}

dist: $(WASM_OUTPUTS) | check-icons
	mkdir -p $(DIST_DIR)/build
	cp -r $(EXTENSION_ASSETS) $(DIST_DIR)/
	cp $(WASM_OUTPUTS) $(DIST_DIR)/build/
ifeq ($(NON_OSS),1)
	@echo "Overlaying non-OSS assets (NON_OSS=1)..."
	cp -r assets/non-oss/by-kagi/src/. $(DIST_DIR)/src/
endif

# One tree per browser: build/dist with manifest.<browser>.json merged onto manifest.json by
# tools/manifest.mjs. Static pattern rule on purpose: make skips implicit rules for .PHONY targets.
dist-chrome dist-firefox: dist-%: manifest.%.json dist
	rm -rf $(BUILD_DIR)/$@
	cp -r $(DIST_DIR) $(BUILD_DIR)/$@
	node tools/manifest.mjs $* > $(BUILD_DIR)/$@/manifest.json

# Store trees: the same merge, then the version AMO needs and no update_url (a listed AMO version
# must not carry one; the self-hosted xpi from dist-firefox keeps it). A store build always carries
# the non-OSS assets; the recursive make is how NON_OSS=1 reaches the parse-time ifeq in dist.
store-chrome store-firefox: store-%: manifest.%.json
	$(MAKE) dist NON_OSS=1
	rm -rf $(BUILD_DIR)/$@
	cp -r $(DIST_DIR) $(BUILD_DIR)/$@
	node tools/manifest.mjs $* --store $(STORE_REVISION) > $(BUILD_DIR)/$@/manifest.json

# Not -FS: a STORE_REVISION bump keeps manifest.json the same size, which -FS can skip. abspath because
# the recipe cds into a tree that has its own build/ subdirectory, where a relative BUILD_DIR would land.
$(BUILD_DIR)/klikkikuri-paatti-%.zip: dist-%
	rm -f $@
	cd $(BUILD_DIR)/dist-$* && zip -r $(abspath $@) .

package: $(BUILD_DIR)/klikkikuri-paatti-chrome.zip $(BUILD_DIR)/klikkikuri-paatti-firefox.zip

source-dist:
	mkdir -p $(BUILD_DIR)
	git ls-files --recurse-submodules | zip -@ $(BUILD_SOURCE_DIST)

test-data:
	mkdir -p "$(TEST_DATA_BUILD_DIR)"
	./generate_test_data.py $(TEST_DATA_SIGNATURES)

# Badge icons are authored as .svg under assets/icons/ and written into the module that
# draws them. The result is committed: the repo root is itself a loadable unpacked
# extension, so src/ must never hold a placeholder. The extension icon PNGs come from
# the two SVG masters under assets/sources/ the same way.
icons:
	node tools/inline-icons.mjs
	assets/sources/export-icons.sh

check-icons:
	@node tools/inline-icons.mjs --check

clean:
	rm -f "$(BUILD_TEST_DATA)" "$(TEST_DATA_SIGNATURES)"
	rm -f $(BUILD_DIR)/klikkikuri-*.xpi
	rm -f $(BUILD_DIR)/klikkikuri-paatti-*.xpi
	rm -rf "$(BUILD_DIR)"
	@if [ -f suola/Makefile ]; then $(MAKE) -C suola clean; fi
	rm -rf suola/build

release:
	node release.js $(VERSION)

# The suola artifacts must carry suola's build attestation before anything is uploaded.
verify-suola: $(WASM_OUTPUTS)
	gh attestation verify $(BUILD_DIR)/js.wasm --repo Klikkikuri/suola
	gh attestation verify $(BUILD_DIR)/wasm_exec.js --repo Klikkikuri/suola

# Store submission, run by publish-amo.yml and publish-chrome.yml, which install web-ext or
# chrome-webstore-upload-cli on the runner and pass USE_RELEASE_ARTIFACTS=1 and the credentials in env.
# AMO shows the GitHub Release body of the tag as the version's release notes, so the Release
# must exist and be written before publishing. The reviewer notes are static.
amo-metadata:
	mkdir -p $(BUILD_DIR)
	gh release view "v$$(node -p "require('./manifest.json').version")" --json body --jq .body \
		| node tools/amo-metadata.mjs docs/amo-reviewer-notes.md > $(AMO_METADATA)

publish-firefox: store-firefox source-dist verify-suola amo-metadata
	web-ext sign --source-dir $(BUILD_DIR)/store-firefox --channel listed --approval-timeout 0 \
		--upload-source-code $(BUILD_SOURCE_DIST) --amo-metadata $(AMO_METADATA) \
		--artifacts-dir $(BUILD_DIR)/web-ext-artifacts

publish-chrome: store-chrome verify-suola
	rm -f $(BUILD_DIR)/store-chrome.zip
	cd $(BUILD_DIR)/store-chrome && zip -r $(abspath $(BUILD_DIR)/store-chrome.zip) .
	chrome-webstore-upload --extension-id $(CHROME_EXTENSION_ID) --source $(BUILD_DIR)/store-chrome.zip

publish: publish-firefox publish-chrome

lint:
	eslint .

# Not part of `lint`. --self-hosted, because the Firefox tree keeps the gecko update_url that
# self-hosted updates need and AMO listings reject. Keep UNSAFE_VAR_ASSIGNMENT at zero.
lint-webext: dist-firefox
	web-ext lint --source-dir $(BUILD_DIR)/dist-firefox --self-hosted

# An explicit glob, not a bare `node --test`: the latter sweeps the whole tree and would
# pick up suola's own smoke test, which test-wasm below runs deliberately and with an
# argument. Node resolves the pattern itself, so keep it quoted.
# jsdom is a global install (see .devcontainer/Dockerfile), and ESM resolution ignores
# NODE_PATH -- tests/helpers/dom.mjs reaches it through the CJS resolver, which does not.
test: export NODE_PATH = $(shell npm root -g)
test: test-wasm
	node --test 'tests/**/*.test.mjs'

# suola's own smoke test for the browser module, run against the artifacts
# staged in $(BUILD_DIR). It is the only check that js.wasm loads and signs
# URLs the way the rules say it should; the tests above never touch it. Needs
# nothing but node, so it is skipped rather than failed when the artifacts have
# not been built yet -- or when the submodule is pinned to a release tag older
# than the test itself, which USE_RELEASE_ARTIFACTS=1 requires.
test-wasm:
	@if [ ! -f suola/test/js_smoke.cjs ]; then \
		echo "Skipping Wasm smoke test: the suola checkout predates it."; \
	elif [ -f "$(BUILD_DIR)/js.wasm" ] && [ -f "$(BUILD_DIR)/wasm_exec.js" ]; then \
		node suola/test/js_smoke.cjs "$(BUILD_DIR)"; \
	else \
		echo "Skipping Wasm smoke test: no artifacts in $(BUILD_DIR), run 'make build-suola' first."; \
	fi

.PHONY: build init ensure-suola check-tinygo package source-dist test-data icons check-icons clean build-suola-local build-suola rebuild-suola release dist dist-chrome dist-firefox store-chrome store-firefox verify-suola amo-metadata publish-firefox publish-chrome publish test test-wasm lint lint-webext
