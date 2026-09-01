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
 * The card's markup and rules are shared with the popup's <feedback-item> through src/feedback-style.js.
 */

import { buildFeedbackPayload, buildFeedbackRequest, clickbaitBadgeIndex } from "../feedback.js";
import { FEEDBACK_BASE, FEEDBACK_TOKENS, feedbackRules } from "../feedback-style.js";

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

const DIALOG_CSS = `
:host {
${FEEDBACK_TOKENS}
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
${FEEDBACK_BASE}
${feedbackRules("")}
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

/**
 * Build the dialog and attach it to the document.
 *
 * @param {object} deps
 * @param {typeof globalThis.browser} deps.browser - Extension namespace, resolved by the content script.
 * @param {() => Promise<string>} deps.getFeedbackServerUrl
 * @param {() => Promise<string>} deps.getDatabaseUpdated
 * @param {(...args: unknown[]) => void} deps.log
 * @returns {{ open: (target: Element, anchor: DOMRect) => void, close: () => void }}
 */
export function createFeedbackDialog({ browser, getFeedbackServerUrl, getDatabaseUpdated, log }) {
    const host = document.createElement("klikkikuri-feedback-dialog");
    for (const [property, value] of Object.entries(HOST_STYLE)) {
        host.style.setProperty(property, value, "important");
    }

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = DIALOG_CSS;
    shadow.appendChild(style);

    // Under <html> rather than <body>, so the content script's body-scoped MutationObserver never sees it.
    document.documentElement.appendChild(host);

    const dialog = document.createElement("div");
    dialog.className = "dialog feedback-card";
    dialog.setAttribute("role", "dialog");
    dialog.hidden = true;
    shadow.appendChild(dialog);

    /** Torn down every time the dialog closes, so a reopened dialog never carries the last one's listeners. */
    let listeners = null;
    let current = null;
    let frame = 0;

    // Catches what scroll and resize miss: the card's own headline reflowing as the page settles.
    const resizeObserver = new ResizeObserver(() => schedulePlace());

    const message = (key, fallback) => browser.i18n.getMessage(key) || fallback;

    function close() {
        listeners?.abort();
        listeners = null;
        if (current) resizeObserver.unobserve(current);
        current = null;
        cancelAnimationFrame(frame);
        frame = 0;
        dialog.hidden = true;
        dialog.replaceChildren();
    }

    /**
     * Position the dialog beside the element it is about, flipping above and clamping to the viewport so a
     * partly visible headline still gets a card that is fully on screen.
     *
     * The anchor is read from the element every time rather than captured when the dialog opened, so the card
     * stays with its headline while the page scrolls or reflows. Once the headline is gone -- scrolled fully
     * out of view, hidden, or dropped from the page -- the dialog goes with it rather than floating at the
     * viewport edge, detached from the thing it reports on.
     */
    function place() {
        if (!current) return;

        if (!current.isConnected) {
            close();
            return;
        }

        const margin = 8;
        const anchor = current.getBoundingClientRect();

        const gone = anchor.width === 0 || anchor.height === 0
            || anchor.bottom <= 0 || anchor.top >= window.innerHeight
            || anchor.right <= 0 || anchor.left >= window.innerWidth;
        if (gone) {
            close();
            return;
        }

        const { width, height } = dialog.getBoundingClientRect();

        let top = anchor.bottom + margin;
        if (top + height > window.innerHeight) {
            top = anchor.top - height - margin;
        }
        dialog.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
        dialog.style.left = `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`;
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
        head.style.cssText = "display: flex; align-items: center; gap: 6px; margin-bottom: 4px;";
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
        separator.style.cssText = "border: 0; border-top: 1px solid var(--color-border-strong); margin: 4px 0;";

        const actions = document.createElement("div");
        actions.className = "feedback-actions";
        const goodBtn = document.createElement("button");
        goodBtn.className = "push-button feedback-action-btn good";
        goodBtn.style.cssText = "margin: 0; padding: 4px 8px; font-size: 0.8em; min-width: 80px;";
        goodBtn.textContent = `👍 ${message("feedbackviewRateTitleConversionIsGood", "Is good")}`;
        const badBtn = document.createElement("button");
        badBtn.className = "push-button feedback-action-btn bad";
        badBtn.style.cssText = "margin: 0; padding: 4px 8px; font-size: 0.8em; min-width: 80px;";
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
            close();
            listeners = new AbortController();
            current = target;
            const { signal } = listeners;

            render(readTarget(target));
            dialog.hidden = false;
            place();

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
