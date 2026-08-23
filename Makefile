DOCKER ?= docker
NON_OSS ?= 0
BUILD_DIR := $(shell pwd)/build
TEST_DATA_BUILD_DIR := $(BUILD_DIR)/test_data
TEST_DATA_SIGNATURES := $(TEST_DATA_BUILD_DIR)/signatures.txt
BUILD_TEST_DATA := $(TEST_DATA_BUILD_DIR)/data.json
BUILD_SOURCE_DIST := $(BUILD_DIR)/source-code.zip
BUILD_EXTENSION := $(BUILD_DIR)/klikkikuri-paatti.zip
DIST_DIR := $(BUILD_DIR)/dist
EXTENSION_ASSETS := icons _locales manifest.json src LICENSE.md LISENSSI.md docs/PRIVACY_POLICY.md
WASM_ASSETS := js.wasm wasm_exec.js


build: ensure-suola build-suola package

init:
	git submodule init --init --recursive

# Ensure suola submodule is initialized and up to date with superproject commit pointer.
# If in a Git repo: initializes suola if missing, and fails if checked out commit differs from superproject pointer.
# If not in a Git repo: verifies suola directory exists.
ensure-suola:
	@if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
		if [ ! -f suola/Makefile ]; then \
			echo "suola submodule not found. Initializing suola submodule..."; \
			$(MAKE) init; \
		fi; \
		if git submodule status suola | grep -q '^[+]'; then \
			echo "Warning: suola submodule commit does not match superproject pointer."; \
			echo "Run 'git submodule update'"; \
		fi; \
	elif [ ! -f suola/Makefile ]; then \
		echo "Error: suola directory missing or incomplete in non-git tree."; \
		exit 1; \
	fi

build-suola:
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

dist: build-suola
	mkdir -p $(DIST_DIR)/build
	cp -r $(EXTENSION_ASSETS) $(DIST_DIR)/
	cp $(addprefix $(BUILD_DIR)/, $(WASM_ASSETS)) $(DIST_DIR)/build/
ifeq ($(NON_OSS),1)
	@echo "Overlaying non-OSS assets (NON_OSS=1)..."
	cp -r assets/non-oss/by-kagi/src/. $(DIST_DIR)/src/
endif

package: dist
	cd $(DIST_DIR) && zip -r -FS $(BUILD_EXTENSION) .

source-dist:
	mkdir -p $(BUILD_DIR)
	git ls-files --recurse-submodules | zip -@ $(BUILD_SOURCE_DIST)

test-data:
	mkdir -p "$(TEST_DATA_BUILD_DIR)"
	./generate_test_data.py $(TEST_DATA_SIGNATURES)

clean:
	rm -f "$(BUILD_TEST_DATA)" "$(TEST_DATA_SIGNATURES)" "$(BUILD_EXTENSION)"
	rm -f $(BUILD_DIR)/klikkikuri-*.xpi
	rm -f $(BUILD_DIR)/klikkikuri-paatti-*.xpi
	rm -rf "$(BUILD_DIR)"
	@if [ -f suola/Makefile ]; then $(MAKE) -C suola clean; fi
	rm -rf suola/build

release:
	node release.js $(VERSION)

test: test-wasm
	node tests/config.test.mjs
	node tests/utils.test.mjs
	node tests/rahti.test.mjs
	node tests/modifiers.test.mjs
	node tests/faviconCache.test.mjs
	node tests/stats.test.mjs
	node tests/easter-egg.test.mjs

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

.PHONY: build init ensure-suola check-tinygo package source-dist test-data clean build-suola-local build-suola release dist test test-wasm
