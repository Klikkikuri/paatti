# Stages:
#  - shim-build: a shim package (equivs-style, but dpkg-deb needs no extra tooling) that
#    satisfies chromium dependencies headless CDP use never touches:
#     - mesa-libgallium: Mesa's private shared-infrastructure library holding
#       the gallium driver code, loaded at runtime by libgbm1 and the GL/EGL
#       front-ends; drags in libllvm19 + libz3-4. Headless chromium renders
#       with its bundled ANGLE/SwiftShader and never loads it. libgbm1 pins
#       it with (= version), so mirror that version exactly.
#     - xdg-desktop-portal-backend: satisfies the "libgtk-3-0t64 | ..."
#       alternative, dropping the GTK/dconf/dbus/adwaita chain (GTK is
#       dlopen'd only when a real UI exists).
#     - x11-utils, xdg-utils: script tools from chromium-common.
#    Together: ~70 MB less download, ~300 MB smaller image.
#  - test: everything the project's test targets need -- make, python3, chromium and
#    its illustrated deps, uv and jsdom. The Build workflow's e2e and drift jobs run
#    `--target test` of this image, and the dev container's final stage reuses it as
#    its base, so the tests run against the same environment in both places.
#  - dev (final, picked up by devcontainer.json): the dev container itself -- agent
#    tooling (rsvg, imagemagick, ripgrep, fd, jq, yq, shellcheck, gh, eslint, web-ext)
#    on top of test, running as user node without passwordless sudo.
FROM mcr.microsoft.com/devcontainers/typescript-node:5-24-trixie AS shim-build
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && MESA_VER="$(apt-cache show --no-all-versions libgbm1 \
        | sed -n 's/.*mesa-libgallium (= \([^)]*\)).*/\1/p')" \
    && mkdir -p /shim/DEBIAN \
    && printf '%s\n' \
        'Package: chromium-headless-shims' \
        'Version: 1' \
        'Architecture: all' \
        'Maintainer: devcontainer <none@localhost>' \
        "Provides: x11-utils, xdg-utils, xdg-desktop-portal-backend, mesa-libgallium (= ${MESA_VER})" \
        'Description: placeholders for chromium deps unused in headless mode' \
        > /shim/DEBIAN/control \
    && dpkg-deb -b /shim /chromium-headless-shims.deb


FROM mcr.microsoft.com/devcontainers/typescript-node:5-24-trixie AS test

# See the shim-build stage: placeholders for heavy chromium deps that
# headless use never touches. Must be registered before chromium installs.
RUN --mount=type=bind,from=shim-build,source=/chromium-headless-shims.deb,target=/tmp/chromium-headless-shims.deb \
    dpkg -i /tmp/chromium-headless-shims.deb

# Install additional dependencies required by the project
# and tools coding agents reach for by default (ripgrep, fd-find, jq, yq).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        # Project requirements
        make \
        zip \
        python3 \
        wamerican \
        curl \
        # Headless browser for chrome-devtools-mcp, which drives Chromium over
        # CDP and needs no webdriver. Point automation at
        # /usr/lib/chromium/chromium, not /usr/bin/chromium: the latter is a
        # shell wrapper that reorders argv and injects flags from
        # /etc/chromium.d/ (including an empty --load-extension=).
        chromium \
        # Emoji glyphs, or popup screenshots render tofu boxes
        fonts-noto-color-emoji

# uv runs the development server in packages/karikko (`make serve`, `make test-devserver`, `make test-e2e`).
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /usr/local/bin/

# jsdom is installed rather than imported -- the `make test` and drift targets point
# NODE_PATH at the global root, and support files reach it through the CJS resolver.
# The cache mount is keyed by its target path, so the dev stage shares it. The cache
# stays out of the image; --no-audit and --no-fund drop unneeded registry requests.
RUN --mount=type=cache,target=/root/.npm,sharing=shared \
    npm install --global --no-audit --no-fund jsdom@27

# Development stage
FROM test AS dev
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends \
        # Image processing
        librsvg2-bin \
        imagemagick \
        # Agent tools
        ripgrep bat \
        fd-find \
        jq yq \
        shellcheck \
    # Link fd-find to fd, so that coding agents can find it in the PATH
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
    && ln -sf "$(command -v batcat)" /usr/local/bin/bat

# GitHub CLI, per the official Debian install instructions:
# https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian
# ADD (rather than a wget/curl RUN step) fetches the keyring as its own
# cacheable layer, keyed off the URL.
ADD --chmod=644 https://cli.github.com/packages/githubcli-archive-keyring.gpg /etc/apt/keyrings/githubcli-archive-keyring.gpg
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    mkdir -p -m 755 /etc/apt/sources.list.d \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends gh

# Linters behind `make lint`: eslint enforces the browser-namespace import rule,
# web-ext the AMO checks. run.sh uses web-ext too. This is the cache mount that the
# test stage fills.
RUN --mount=type=cache,target=/root/.npm,sharing=shared \
    npm install --global --no-audit --no-fund eslint@10 web-ext@10
# Disable passwordless sudo
RUN rm -f /etc/sudoers.d/node

USER node
