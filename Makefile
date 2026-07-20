DOCKER := docker
BUILD_DIR := $(shell pwd)
TEST_DATA_BUILD_DIR := $(BUILD_DIR)/test_data
TEST_DATA_SIGNATURES := $(TEST_DATA_BUILD_DIR)/signatures.txt
BUILD_TEST_DATA := $(TEST_DATA_BUILD_DIR)/data.json
BUILD_EXTENSION := $(BUILD_DIR)/klikkikuri-paatti.zip

build: init package

init:
	git submodule init
	git submodule update
	# Build suola artifacts.
	$(DOCKER) build --target wasm-builder -t buildsuola suola/
	$(DOCKER) run --mount type=bind,src=$(BUILD_DIR)/suola/build/,dst=/app/build buildsuola

package:
	zip -r -FS $(BUILD_EXTENSION) \
	  ./icons/ \
	  ./_locales/ \
	  ./manifest.json \
	  ./src/ \
	  ./suola/build/js.wasm \
	  ./suola/build/suola.js \
	  ./suola/build/wasm_exec.js \
	  ./LICENSE.md \
	  ./LISENSSI.md

test-data:
	mkdir -p "$(TEST_DATA_BUILD_DIR)"
	./generate_test_data.py $(TEST_DATA_SIGNATURES)

clean:
	rm -f "$(BUILD_TEST_DATA)" "$(TEST_DATA_SIGNATURES)" "$(BUILD_EXTENSION)"
	rm -f $(BUILD_DIR)/klikkikuri-*.xpi
	rmdir "$(TEST_DATA_BUILD_DIR)" 2>/dev/null || true

release:
	node release.js $(VERSION)
	$(MAKE) build
	cp klikkikuri-paatti.zip klikkikuri-paatti-$$(node -p "require('./manifest.json').version").xpi

.PHONY: build init package test-data clean release
