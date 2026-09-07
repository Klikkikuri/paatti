"use strict";

/**
 * The feedback card, rendered in the visited page instead of the popup.
 *
 * The popup cannot be opened from here: `action.openPopup()` needs Chrome 127 against a manifest floor of 122,
 * Firefox refuses it from a page-originated event before 149 against a floor of 128, and a page click dismisses
 * an open popup anyway. So the dialog lives in a shadow root of its own, and everything it submits comes from
 * the target element's own dataset -- no `getConversions` round trip.
 *
 * Same isolated-world rules as highlight-overlay.js: an unregistered tag with `attachShadow` called directly,
 * because a custom element would need the page's registry to upgrade it. Its own host rather than the overlay's,
 * because it is `position: fixed` and the overlay's layer is in document coordinates.
 *
 * The card's rules are shared with the popup's <feedback-item> through src/feedback-card.css, which this
 * shadow root adopts alongside theme.css.
 */

import { buildFeedbackPayload, buildFeedbackRequest, clickbaitBadgeIndex } from "../feedback.js";

/** Inline on the host, all `!important`: an inline important declaration outranks any page author rule. */
const HOST_STYLE = {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    margin: "0",
    border: "0",
    padding: "0",
    display: "block",
    "z-index": "2147483647"
};

/* Short enough that a click still feels immediate; the hide is quicker, because by then the user has decided. */
const MOTION_IN_MS = 120;
const MOTION_OUT_MS = 90;

const DIALOG_CSS = `
:host {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 14px;
    color: var(--color-text-primary);
}

.dialog {
    position: fixed;
    width: 320px;
    max-width: calc(100vw - 24px);
    box-sizing: border-box;
}

.dialog[hidden] {
    display: none;
}

.close {
    position: absolute;
    top: 4px;
    right: 6px;
    padding: 2px 6px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
}

.close:hover {
    background: var(--color-surface);
    color: var(--color-text-primary);
}

.status {
    font-size: 0.85em;
    font-weight: bold;
}

/* .push-button, trimmed for the card: the page's original in styles.css also sets --font-display and gives a
 * pressed button a pulsing glow, neither of which belongs on a two-button card inside someone else's page. It
 * is the one rule here that cannot simply be adopted -- styles.css fuses .push-button with #navi and
 * input:checked selectors this root has no use for, and drags 710 lines of page layout with it. The card's
 * surface and .hidden come from components.css, which this root adopts alongside the other two sheets.
 * No backticks in here: this is inside a template literal, and a pair of them silently turns CSS into JS. */
.push-button {
    display: inline-block;
    cursor: pointer;
    background: var(--push-bg);
    outline: 1px outset var(--color-border-strong);
    border-radius: 0.375rem;
    box-shadow:
        var(--push-shadow) var(--push-offset) var(--push-offset),
        var(--push-shadow) 0px 0px inset;
    transition:
        transform 0.2s ease-in-out,
        box-shadow 0.2s ease-in-out,
        background 0.2s ease-in-out;
    text-align: center;
    min-width: 6.25rem;
    color: var(--push-text);
    margin: 0;
    padding: 2%;
    padding-bottom: 0.3125rem;
    font-weight: bold;
}

.push-button:hover {
    color: var(--push-accent);
    outline: 2px solid var(--color-info);
}

.push-button:active {
    box-shadow:
        var(--push-shadow) 0px 0px,
        var(--push-shadow) 1px 1px inset;
    transform: translate(calc(var(--push-offset) / 2), calc(var(--push-offset) / 2));
    background: var(--push-bg-active);
    outline: 1px solid var(--color-info);
}
`;

/**
 * Read everything the payload needs off the highlighted element.
 *
 * The title values live on a descendant carrying `data-klikkikuri-original-title`, falling back to the
 * container itself, exactly as the `getConversions` handler resolves them.
 *
 * @param {Element} target
 * @returns {{urlSign: string, originalTitle: string, convertedTitle: string, clickbaitLevel: string}}
 */
function readTarget(target) {
    const titleElem = target.querySelector("[data-klikkikuri-original-title]") || target;
    return {
        urlSign: target.dataset.klikkikuriUrlSign || "",
        originalTitle: titleElem.dataset.klikkikuriOriginalTitle || titleElem.textContent || "",
        convertedTitle: titleElem.dataset.klikkikuriConvertedTitle || "",
        clickbaitLevel: titleElem.dataset.klikkikuriClickbaitLevel ?? ""
    };
}

/** Kept between the card and the viewport edge whenever the card has to come off its anchor. */
const PLACE_MARGIN = 8;

/**
 * Whether the anchor has left the page, so the card should go with it: collapsed to nothing, or scrolled
 * fully past an edge. Partly visible still counts as visible.
 *
 * @param {{top: number, left: number, right: number, bottom: number, width: number, height: number}} anchor
 *   In viewport coordinates, as `getBoundingClientRect` gives them.
 * @param {{width: number, height: number}} viewport
 * @returns {boolean}
 */
export function isAnchorGone(anchor, viewport) {
    return anchor.width === 0 || anchor.height === 0
        || anchor.bottom <= 0 || anchor.top >= viewport.height
        || anchor.right <= 0 || anchor.left >= viewport.width;
}

/**
 * Where to put the card: both top-right corners on the same point, so it covers the pill that was clicked.
 *
 * Nothing is clamped to the viewport -- the card travels with its headline, scrolling off the edge with it
 * rather than clinging to the edge detached from the thing it reports on. The two fallbacks move it only
 * where the primary corner would leave it unusable.
 *
 * @param {{top: number, left: number, right: number, bottom: number}} anchor - In viewport coordinates.
 * @param {{width: number, height: number}} card - Measured at its settled size.
 * @param {{width: number, height: number}} viewport
 * @param {number} [margin]
 * @returns {{top: number, left: number, transformOrigin: string}}
 */
export function placeCard(anchor, card, viewport, margin = PLACE_MARGIN) {
    // Too little room under the pill for the whole card: pull it up to sit on the anchor's bottom edge.
    // Never past the pill, or an anchor taller than the card would push it down and off the fold.
    let top = anchor.top;
    if (top + card.height > viewport.height - margin) top = Math.min(top, anchor.bottom - card.height);

    // A headline narrower than the card would push it off the left edge; align it with the left edge then.
    let left = anchor.right - card.width;
    if (left < margin) left = anchor.left;

    // Whichever corner ended up on the anchor is the one the card grows out of. Derived from the edges it was
    // aligned to, not from a comparison: a card wider than its headline starts left of it either way.
    return {
        top,
        left,
        transformOrigin: `${top === anchor.top ? "top" : "bottom"} ${left === anchor.left ? "left" : "right"}`
    };
}

/**
 * Build the dialog and attach it to the document.
 *
 * @param {object} deps
 * @param {typeof globalThis.browser} deps.browser - Extension namespace, resolved by the content script.
 * @param {() => Promise<string>} deps.getFeedbackServerUrl
 * @param {() => Promise<string>} deps.getDatabaseUpdated
 * @param {(...args: unknown[]) => void} deps.log
 * @param {(element: Element, on: boolean) => void} [deps.setHighlighted] - Marks the article the card reports
 *   on, so it stands out for as long as the card is up. The content script points this at the same overlay
 *   call the popup's <feedback-item> reaches over a message when it is hovered.
 * @returns {{ open: (target: Element) => void, close: () => void }}
 */
export function createFeedbackDialog({ browser, getFeedbackServerUrl, getDatabaseUpdated, log, setHighlighted = () => {} }) {
    const host = document.createElement("klikkikuri-feedback-dialog");
    for (const [property, value] of Object.entries(HOST_STYLE)) {
        host.style.setProperty(property, value, "important");
    }

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = DIALOG_CSS;
    shadow.appendChild(style);

    // The sheets the extension pages link: theme.css for the colours, components.css for the card's surface
    // and .hidden, feedback-card.css for the card itself. All are fetched rather than linked, because a page
    // stylesheet never crosses a shadow boundary. Started at construction rather than on open, so they have
    // landed long before the first click on a pill.
    for (const path of ["src/options/theme.css", "src/options/components.css", "src/feedback-card.css"]) {
        const sheet = new CSSStyleSheet();
        shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
        fetch(browser.runtime.getURL(path))
            .then((response) => response.text())
            .then((css) => sheet.replaceSync(css))
            .catch((err) => log(`Failed to load ${path}:`, err));
    }

    const dialog = document.createElement("div");
    dialog.className = "dialog feedback-card";
    dialog.setAttribute("role", "dialog");
    dialog.hidden = true;
    shadow.appendChild(dialog);

    /** Torn down every time the dialog closes, so a reopened dialog never carries the last one's listeners. */
    let listeners = null;
    let current = null;
    let frame = 0;
    /** The show or hide currently running, kept so a reopen can cancel a hide before it takes the card away. */
    let motion = null;
    let hiding = false;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

    // Catches what scroll and resize miss: the card's own headline reflowing as the page settles.
    const resizeObserver = new ResizeObserver(() => schedulePlace());

    const message = (key, fallback) => browser.i18n.getMessage(key) || fallback;

    // Without a name a dialog is announced as just "dialog", which says nothing in a page the user did not
    // expect one in.
    dialog.setAttribute("aria-label", message("feedbackviewDialogLabel", "Klikkikuri headline feedback"));

    /** Drop everything the last opening wired up. Shared by close() and by a reopen. */
    function teardown() {
        listeners?.abort();
        listeners = null;
        if (current) {
            resizeObserver.unobserve(current);
            setHighlighted(current, false);
        }
        current = null;
        cancelAnimationFrame(frame);
        frame = 0;
    }

    /**
     * Fade the card, scaling it out of the corner that sits on the pill so it grows from the thing that was
     * clicked rather than appearing whole.
     *
     * Under `prefers-reduced-motion: reduce` the scale goes and the fade stays: a fade carries no movement, so
     * it asks nothing of a reader the preference is there to protect. Read per call, not cached, so a change
     * to the setting takes effect without a reload.
     *
     * @param {boolean} show
     * @returns {Animation}
     */
    function animateCard(show) {
        const hidden = { opacity: "0", transform: reducedMotion.matches ? "none" : "scale(0.96)" };
        const shown = { opacity: "1", transform: "none" };
        return dialog.animate(show ? [hidden, shown] : [shown, hidden], {
            duration: show ? MOTION_IN_MS : MOTION_OUT_MS,
            easing: show ? "ease-out" : "ease-in",
            // The hide holds its last frame: the card leaves the page a tick later, and snapping back to full
            // opacity in between would flash.
            fill: show ? "none" : "forwards"
        });
    }

    function close() {
        teardown();
        if (!host.isConnected || hiding) return;

        hiding = true;
        // A show still in flight would otherwise keep compositing against the hide.
        motion?.cancel();
        motion = animateCard(false);
        motion.finished.then(() => {
            hiding = false;
            dialog.hidden = true;
            dialog.replaceChildren();
            // Out of the page entirely between openings -- the element stays alive here, so its shadow root
            // keeps the sheets already fetched, but the page is left with no trace of it.
            host.remove();
        // Cancelled by a reopen during the hide, which keeps the card exactly where it is.
        }, () => {});
    }

    /**
     * Measure the anchor and put the card on it, or close the dialog once the anchor is gone -- scrolled
     * fully out of view, hidden, or dropped from the page.
     *
     * The anchor is read on every call rather than captured when the dialog opened, so the card follows its
     * headline as the page moves under it. The geometry itself is in `placeCard`.
     */
    function place() {
        if (!current) return;

        if (!current.isConnected) {
            close();
            return;
        }

        const anchor = current.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        if (isAnchorGone(anchor, viewport)) {
            close();
            return;
        }

        // offsetWidth/Height rather than a client rect: they ignore transforms, so a reposition mid-animation
        // measures the card at its settled size instead of its scaled one.
        const card = { width: dialog.offsetWidth, height: dialog.offsetHeight };
        const { top, left, transformOrigin } = placeCard(anchor, card, viewport);

        dialog.style.top = `${top}px`;
        dialog.style.left = `${left}px`;
        dialog.style.transformOrigin = transformOrigin;
    }

    /** Coalesced to one reposition per frame, however many scroll events arrive. */
    function schedulePlace() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            place();
        });
    }

    function setStatus(container, text, colour) {
        const span = document.createElement("span");
        span.className = "status";
        span.style.color = colour;
        span.textContent = text;
        container.replaceChildren(span);
    }

    async function submit(type, comment) {
        const payload = buildFeedbackPayload({
            pageUrl: window.location.href,
            ...readTarget(current),
            feedbackType: type,
            comment,
            databaseUpdated: await getDatabaseUpdated()
        });

        if (!payload) {
            log("Validation failed: missing required feedback fields", readTarget(current));
            return false;
        }

        // Posted by the worker, not here, so this and the popup's list share one network path.
        const { url, init } = buildFeedbackRequest(await getFeedbackServerUrl(), payload);
        try {
            const result = await browser.runtime.sendMessage({ action: "submitFeedback", url, init });
            return result?.success === true;
        } catch (err) {
            log("Failed to submit feedback:", err);
            return false;
        }
    }

    /** One row of the card: a label, an optional badge, and the text. */
    function row(variant, labelText, text, badge) {
        const wrapper = document.createElement("div");
        wrapper.className = `feedback-row ${variant}`;

        const head = document.createElement("div");
        head.className = "feedback-row-head";
        const label = document.createElement("span");
        label.className = "feedback-label";
        label.textContent = labelText;
        head.appendChild(label);
        if (badge) head.appendChild(badge);

        const body = document.createElement("span");
        body.className = "feedback-text";
        body.textContent = text;

        wrapper.append(head, body);
        return wrapper;
    }

    function render(values) {
        const { signal } = listeners;

        const close_ = document.createElement("button");
        close_.className = "close";
        close_.textContent = "✕";
        close_.setAttribute("aria-label", message("feedbackviewCloseBtn", "Close"));
        close_.addEventListener("click", close, { signal });

        const { index, fallback } = clickbaitBadgeIndex(values.clickbaitLevel || 0);
        const badge = document.createElement("span");
        badge.className = "clickbait-level-badge";
        badge.dataset.level = String(index);
        badge.textContent = message(`clickbaitBadgeLevel${index}`, fallback);

        const original = row("original", message("feedbackviewRateTitleOriginalTitleLabel", "Original:"), values.originalTitle, badge);
        const converted = row("converted", message("feedbackviewRateTitleConvertedTitleLabel", "Aligned:"), values.convertedTitle);

        const separator = document.createElement("hr");
        separator.className = "feedback-separator";

        const actions = document.createElement("div");
        actions.className = "feedback-actions";
        const goodBtn = document.createElement("button");
        goodBtn.className = "push-button feedback-action-btn good";
        goodBtn.textContent = `👍 ${message("feedbackviewRateTitleConversionIsGood", "Is good")}`;
        const badBtn = document.createElement("button");
        badBtn.className = "push-button feedback-action-btn bad";
        badBtn.textContent = `👎 ${message("feedbackviewRateTitleConversionIsBad", "Is no good")}`;
        actions.append(goodBtn, badBtn);

        const form = document.createElement("div");
        form.className = "feedback-input-container hidden";
        const group = document.createElement("div");
        group.className = "feedback-input-group";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "feedback-text-input";
        input.placeholder = message("feedbackviewReportCommentPlaceholder", "Describe the issue...");
        const submitBtn = document.createElement("button");
        submitBtn.className = "feedback-submit-button";
        submitBtn.textContent = message("feedbackviewReportSubmitBtn", "Submit");
        group.append(input, submitBtn);
        form.appendChild(group);

        dialog.replaceChildren(close_, original, converted, separator, actions, form);

        const report = (ok) => setStatus(
            actions,
            ok ? message("feedbackviewReportSuccess", "✓ Feedback submitted!") : message("feedbackviewReportFailure", "✗ Failed to send report."),
            ok ? "var(--color-success-strong)" : "var(--color-danger-strong)"
        );

        goodBtn.addEventListener("click", async () => {
            setStatus(actions, "...", "var(--color-text-muted)");
            report(await submit("good_conversion", ""));
        }, { signal });

        badBtn.addEventListener("click", () => {
            actions.style.display = "none";
            form.classList.remove("hidden");
            input.focus();
        }, { signal });

        const triggerSubmit = async () => {
            if (!input.value.trim()) return;
            input.disabled = true;
            submitBtn.disabled = true;
            submitBtn.textContent = "...";

            const ok = await submit("bad_conversion", input.value);
            form.classList.add("hidden");
            actions.style.display = "flex";
            report(ok);
        };

        submitBtn.addEventListener("click", triggerSubmit, { signal });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                triggerSubmit();
            }
        }, { signal });
    }

    return {
        /**
         * @param {Element} target - The highlighted element being reported on.
         */
        open(target) {
            teardown();
            // A hide still running would otherwise remove the host from under the card we are about to show.
            motion?.cancel();
            motion = null;
            hiding = false;

            listeners = new AbortController();
            current = target;
            setHighlighted(target, true);
            const { signal } = listeners;

            // Under <html> rather than <body>, so the content script's body-scoped MutationObserver never
            // sees it. Back in before `place()`, which needs the card laid out to measure it.
            document.documentElement.appendChild(host);
            render(readTarget(target));
            dialog.hidden = false;
            place();
            motion = animateCard(true);

            // Follow the headline while the page moves under it. Capture, so a scrolling container that stops
            // the event still reaches us; passive, because none of this cancels anything.
            window.addEventListener("scroll", schedulePlace, { capture: true, passive: true, signal });
            window.addEventListener("resize", schedulePlace, { signal });
            resizeObserver.observe(target);

            // Capture phase, so the page cannot swallow the key before it reaches us.
            window.addEventListener("keydown", (event) => {
                if (event.key === "Escape") close();
            }, { capture: true, signal });

            // Dismiss on an outside click. The dialog's own clicks never reach here: they are retargeted to
            // the host, so `composedPath` is what distinguishes inside from outside.
            window.addEventListener("click", (event) => {
                if (!event.composedPath().includes(dialog)) close();
            }, { capture: true, signal });
        },

        close
    };
}
