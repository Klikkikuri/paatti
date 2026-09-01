"use strict";

/**
 * Debug highlighting for the visited page, drawn inside a shadow root.
 *
 * No shadow root can enclose an element the page owns, so this is an overlay rather than a wrapper: one
 * extension-owned host holds a box per highlighted element, positioned over it in document coordinates. The
 * page's own DOM is never styled, which is why nothing in here needs `!important` — only the host does, to
 * survive the page's stylesheet.
 *
 * NOTE: unlike the badges beside it, this is NOT a custom element. Badges are injected into the page's main
 * world so the page's registry upgrades them; this module is driven from the content script's isolated world,
 * where a registration would never upgrade a node the page can see. `attachShadow` is a DOM API and works from
 * either world, so an unregistered tag name sidesteps the registry entirely. The name is still hyphenated so
 * the host is obvious in devtools.
 *
 * The status strings stay English on purpose: they are debug signals, and `browser.i18n` would give this
 * module its only import, and with it a `web_accessible_resources` dependency.
 */

/** Label per `klikkikuriStatus` value from model.js. */
const STATUS_LABELS = {
    skipped: "⏭️ Skipped",
    converted: "✅ Converted",
    original: "🔄 Original",
    paywalled: "🔒 Paywalled",
    error: "⚠️ Error"
};

/** Room a label needs above its box. Below this it flips inside, so it cannot be clipped by the viewport. */
const LABEL_CLEARANCE = 24;

/** Inline on the host, all `!important`: a page author rule cannot outrank an inline important declaration. */
const HOST_STYLE = {
    position: "absolute",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    margin: "0",
    border: "0",
    padding: "0",
    display: "block",
    "z-index": "2147483647",
    "pointer-events": "none"
};

const SCROLL_OPTIONS = { capture: true, passive: true };

/**
 * Status colours are debug signals, so they stay fixed and saturated rather than following
 * `prefers-color-scheme`: that reports the OS preference, while this markup lives in the page's own theme.
 */
const OVERLAY_CSS = `
:host {
    --kk-skipped: #78909c;
    --kk-converted: #2e7d32;
    --kk-original: #ef6c00;
    --kk-paywalled: #fbc02d;
    --kk-error: #c62828;
    --kk-badge-text: #ffffff;
    --kk-hover: 0, 210, 255;
}

.box {
    position: absolute;
    top: 0;
    left: 0;
}

.box[hidden] {
    display: none;
}

.box[data-status="skipped"] {
    outline: 1.5px dashed var(--kk-skipped);
}

.box[data-status="converted"] {
    outline: 2px solid var(--kk-converted);
    box-shadow: 0 0 8px color-mix(in srgb, var(--kk-converted) 20%, transparent);
}

.box[data-status="original"] {
    outline: 2px solid var(--kk-original);
    box-shadow: 0 0 8px color-mix(in srgb, var(--kk-original) 20%, transparent);
}

.box[data-status="paywalled"] {
    outline: 2px solid var(--kk-paywalled);
    box-shadow: 0 0 8px color-mix(in srgb, var(--kk-paywalled) 20%, transparent);
}

.box[data-status="error"] {
    outline: 2px solid var(--kk-error);
    box-shadow: 0 0 10px color-mix(in srgb, var(--kk-error) 30%, transparent);
}

/* The label sits above its box rather than over the content it names, which a small target has no room for. */
.label {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 2px;
    padding: 3px 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--kk-badge-text);
    border-radius: 20px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.box.label-inside .label {
    bottom: auto;
    top: 2px;
    margin-bottom: 0;
}

.box:not([data-status]) .label {
    display: none;
}

.box[data-status="skipped"] .label { background-color: var(--kk-skipped); }
.box[data-status="converted"] .label { background-color: var(--kk-converted); }
.box[data-status="original"] .label { background-color: var(--kk-original); }
.box[data-status="paywalled"] .label { background-color: var(--kk-paywalled); }
.box[data-status="error"] .label { background-color: var(--kk-error); }

/* The hover ring is a layer of its own so the pulse animates opacity, which the compositor handles without
 * repainting. Animating outline-color and box-shadow instead repaints every frame the pointer rests. */
.ring {
    position: absolute;
    inset: 0;
    opacity: 0;
    outline: 3px solid rgb(var(--kk-hover));
    box-shadow: 0 0 12px rgba(var(--kk-hover), 0.8);
}

.box.hover .ring {
    opacity: 1;
    animation: klikkikuri-pulse 1.2s infinite ease-in-out;
}

@keyframes klikkikuri-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .box.hover .ring {
        animation: none;
    }
}
`;

/**
 * Build the overlay and attach it to the document.
 *
 * @returns {{
 *   setStatusVisible: (visible: boolean) => void,
 *   addHovered: (elements: Iterable<Element>) => void,
 *   removeHovered: (elements: Iterable<Element>) => void,
 *   clearHovered: () => void,
 *   refresh: () => void
 * }}
 */
export function createHighlightOverlay() {
    const host = document.createElement("klikkikuri-highlight-overlay");
    // Decoration only. Without this the labels, which used to be CSS `content:` strings, would be announced
    // over every headline once they became real nodes.
    host.setAttribute("aria-hidden", "true");
    for (const [property, value] of Object.entries(HOST_STYLE)) {
        host.style.setProperty(property, value, "important");
    }

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);

    // Appended to <html>, not <body>: the content script's MutationObserver watches document.body, and its
    // "is this our own change" guard would not recognise the host. Changes inside a shadow root never reach an
    // observer outside it, so the per-frame box updates stay invisible either way.
    document.documentElement.appendChild(host);

    /** @type {Map<Element, HTMLElement>} Page element to the box drawn over it. */
    const boxes = new Map();
    /** @type {Set<Element>} Elements the popup is currently hovering. */
    const hovered = new Set();

    let statusVisible = false;
    let frame = 0;
    let listening = false;

    const resizeObserver = new ResizeObserver(() => scheduleRefresh());

    function scheduleRefresh() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            draw();
        });
    }

    /**
     * Scroll and resize only matter while something is drawn, so the idle page pays nothing.
     */
    function setListening(active) {
        if (active === listening) return;
        listening = active;
        if (active) {
            window.addEventListener("scroll", scheduleRefresh, SCROLL_OPTIONS);
            window.addEventListener("resize", scheduleRefresh);
        } else {
            window.removeEventListener("scroll", scheduleRefresh, SCROLL_OPTIONS);
            window.removeEventListener("resize", scheduleRefresh);
        }
    }

    /**
     * Every element that should carry a box right now. Hover survives with status highlighting off, so the two
     * sources are independent.
     */
    function collectTargets() {
        const targets = new Set();
        if (statusVisible) {
            for (const element of document.querySelectorAll("[data-klikkikuri-status]")) {
                targets.add(element);
            }
        }
        for (const element of hovered) {
            // A page that recycles its DOM would otherwise leave us holding detached nodes for the tab's life.
            if (element.isConnected) {
                targets.add(element);
            } else {
                hovered.delete(element);
            }
        }
        return targets;
    }

    function createBox() {
        const box = document.createElement("div");
        box.className = "box";
        const ring = document.createElement("div");
        ring.className = "ring";
        const label = document.createElement("span");
        label.className = "label";
        box.append(ring, label);
        return box;
    }

    function draw() {
        const targets = collectTargets();

        for (const [element, box] of boxes) {
            if (targets.has(element)) continue;
            box.remove();
            boxes.delete(element);
            resizeObserver.unobserve(element);
        }

        for (const element of targets) {
            if (boxes.has(element)) continue;
            const box = createBox();
            shadow.appendChild(box);
            boxes.set(element, box);
            // Catches what scroll and resize miss: a lazy <img> growing a card, a webfont rewrapping a headline.
            resizeObserver.observe(element);
        }

        // Read every rect before writing any style. Interleaving the two forces a layout per element.
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        const placements = [];
        for (const element of targets) {
            placements.push([element, element.getBoundingClientRect()]);
        }

        for (const [element, rect] of placements) {
            const box = boxes.get(element);
            // A zero-size target draws no outline, but its label would still float somewhere on the page.
            box.hidden = rect.width === 0 || rect.height === 0;
            if (box.hidden) continue;

            box.style.transform = `translate(${rect.left + scrollX}px, ${rect.top + scrollY}px)`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;

            const status = element.dataset.klikkikuriStatus;
            if (box.dataset.status !== status) {
                if (status) {
                    box.dataset.status = status;
                } else {
                    delete box.dataset.status;
                }
                box.querySelector(".label").textContent = STATUS_LABELS[status] || "";
            }

            box.classList.toggle("hover", hovered.has(element));
            box.classList.toggle("label-inside", rect.top < LABEL_CLEARANCE);
        }

        setListening(targets.size > 0);
    }

    return {
        setStatusVisible(visible) {
            if (statusVisible === visible) return;
            statusVisible = visible;
            scheduleRefresh();
        },

        addHovered(elements) {
            for (const element of elements) {
                hovered.add(element);
                element.dataset.klikkikuriHover = "";
            }
            scheduleRefresh();
        },

        removeHovered(elements) {
            for (const element of elements) {
                hovered.delete(element);
                delete element.dataset.klikkikuriHover;
            }
            scheduleRefresh();
        },

        clearHovered() {
            for (const element of hovered) {
                delete element.dataset.klikkikuriHover;
            }
            hovered.clear();
            scheduleRefresh();
        },

        refresh: scheduleRefresh
    };
}
