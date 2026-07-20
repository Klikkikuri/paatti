DOCKER := docker
BUILD_DIR := $(shell pwd)/build
TEST_DATA_BUILD_DIR := $(BUILD_DIR)/test_data
TEST_DATA_SIGNATURES := $(TEST_DATA_BUILD_DIR)/signatures.txt
BUILD_TEST_DATA := $(TEST_DATA_BUILD_DIR)/data.json
BUILD_EXTENSION := $(BUILD_DIR)/klikkikuri-paatti.zip

build: build-suola package

init:
	git submodule init
	git submodule update

build-suola:
	# Check if suola submodule is clean and exact-tagged
	@if [ -d suola ] && (cd suola && git diff-index --quiet HEAD -- && git describe --tags --exact-match >/dev/null 2>&1); then \
		SUOLA_TAG=$$(cd suola && git describe --tags --exact-match); \
		echo "suola submodule is clean and tagged at $$SUOLA_TAG. Fetching pre-built artifacts from GitHub releases..."; \
		mkdir -p suola/build; \
		rm -f suola/build/js.wasm suola/build/wasm_exec.js; \
		curl -L -f -o suola/build/js.wasm "https://github.com/Klikkikuri/suola/releases/download/$$SUOLA_TAG/js.wasm" && \
		curl -L -f -o suola/build/wasm_exec.js "https://github.com/Klikkikuri/suola/releases/download/$$SUOLA_TAG/wasm_exec.js" || \
		{ echo "Failed to download pre-built artifacts. Falling back to docker build..."; $(MAKE) build-suola-local; }; \
	else \
		echo "suola submodule is modified or untagged. Building suola artifacts locally using docker..."; \
		$(MAKE) build-suola-local; \
	fi

build-suola-local:
	$(DOCKER) build --target wasm-builder -t buildsuola suola/
	$(DOCKER) run --mount type=bind,src=$(shell pwd)/suola/build/,dst=/app/build buildsuola

package: build-suola
	mkdir -p $(BUILD_DIR)
	zip -r -FS $(BUILD_EXTENSION) \
	  ./icons/ \
	  ./_locales/ \
	  ./manifest.json \
	  ./src/ \
	  ./suola/build/js.wasm \
	  ./suola/build/wasm_exec.js \
	  ./LICENSE.md \
	  ./LISENSSI.md

test-data:
	mkdir -p "$(TEST_DATA_BUILD_DIR)"
	./generate_test_data.py $(TEST_DATA_SIGNATURES)

clean:
	rm -f "$(BUILD_TEST_DATA)" "$(TEST_DATA_SIGNATURES)" "$(BUILD_EXTENSION)"
	rm -f $(BUILD_DIR)/klikkikuri-*.xpi
	rm -f $(BUILD_DIR)/klikkikuri-paatti-*.xpi
	rmdir "$(TEST_DATA_BUILD_DIR)" 2>/dev/null || true
	rmdir "$(BUILD_DIR)" 2>/dev/null || true

release:
	node release.js $(VERSION)

.PHONY: build init package test-data clean build-suola-local build-suola release
