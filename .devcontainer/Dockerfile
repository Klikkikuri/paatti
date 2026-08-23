# Shim package (equivs-style, but dpkg-deb needs no extra tooling) that
# satisfies chromium dependencies headless CDP use never touches:
#  - mesa-libgallium: Mesa's private shared-infrastructure library holding
#    the gallium driver code, loaded at runtime by libgbm1 and the GL/EGL
#    front-ends; drags in libllvm19 + libz3-4. Headless chromium renders
#    with its bundled ANGLE/SwiftShader and never loads it. libgbm1 pins
#    it with (= version), so mirror that version exactly.
#  - xdg-desktop-portal-backend: satisfies the "libgtk-3-0t64 | ..."
#    alternative, dropping the GTK/dconf/dbus/adwaita chain (GTK is
#    dlopen'd only when a real UI exists).
#  - x11-utils, xdg-utils: script tools from chromium-common.
# Together: ~70 MB less download, ~300 MB smaller image.
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


FROM mcr.microsoft.com/devcontainers/typescript-node:5-24-trixie

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
        # Headless browser for chrome-devtools-mcp, which drives Chromium over
        # CDP and needs no webdriver. Point automation at
        # /usr/lib/chromium/chromium, not /usr/bin/chromium: the latter is a
        # shell wrapper that reorders argv and injects flags from
        # /etc/chromium.d/ (including an empty --load-extension=).
        chromium \
        # Emoji glyphs, or popup screenshots render tofu boxes
        fonts-noto-color-emoji \
        # Agent tools
        ripgrep \
        fd-find \
        jq yq \
    # Link fd-find to fd, so that coding agents can find it in the PATH
    && ln -sf "$(command -v fdfind)" /usr/local/bin/fd

# Linters behind `make lint`: eslint enforces the browser-namespace import rule,
# web-ext the AMO checks. run.sh uses web-ext too. jsdom is imported rather than run --
# the `make test` target points NODE_PATH at the global root so the tests can reach it.
RUN npm install -g eslint@10 web-ext@10 jsdom@27

# Disable passwordless sudo
RUN rm -f /etc/sudoers.d/node

USER node
