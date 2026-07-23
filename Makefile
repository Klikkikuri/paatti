DOCKER ?= docker
BUILD_DIR := $(shell pwd)/build
TEST_DATA_BUILD_DIR := $(BUILD_DIR)/test_data
TEST_DATA_SIGNATURES := $(TEST_DATA_BUILD_DIR)/signatures.txt
BUILD_TEST_DATA := $(TEST_DATA_BUILD_DIR)/data.json
BUILD_SOURCE_DIST := $(BUILD_DIR)/source-code.zip
BUILD_EXTENSION := $(BUILD_DIR)/klikkikuri-paatti.zip
DIST_DIR := $(BUILD_DIR)/dist
EXTENSION_ASSETS := icons _locales manifest.json src LICENSE.md LISENSSI.md docs/PRIVACY_POLICY.md
WASM_ASSETS := js.wasm wasm_exec.js


build: build-suola package

init:
	git submodule init
	git submodule update

ensure-suola:
	@if [ ! -f suola/Makefile ]; then \
		echo "suola submodule not found. Initializing suola submodule..."; \
		$(MAKE) init; \
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
	$(MAKE) -C suola js
	mkdir -p $(BUILD_DIR)
	cp suola/build/js.wasm $(BUILD_DIR)/js.wasm
	cp suola/build/wasm_exec.js $(BUILD_DIR)/wasm_exec.js
else
	mkdir -p suola/build
	$(DOCKER) build --target wasm-builder -t buildsuola suola/
	$(DOCKER) run --mount type=bind,src=$(shell pwd)/suola/build/,dst=/app/build buildsuola
	mkdir -p $(BUILD_DIR)
	cp suola/build/js.wasm $(BUILD_DIR)/js.wasm
	cp suola/build/wasm_exec.js $(BUILD_DIR)/wasm_exec.js
endif

dist: build-suola
	mkdir -p $(DIST_DIR)/build
	cp -r $(EXTENSION_ASSETS) $(DIST_DIR)/
	cp $(addprefix $(BUILD_DIR)/, $(WASM_ASSETS)) $(DIST_DIR)/build/

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

test:
	node tests/config.test.mjs
	node tests/utils.test.mjs

.PHONY: build init ensure-suola package source-dist test-data clean build-suola-local build-suola release dist test
