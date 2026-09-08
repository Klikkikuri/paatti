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

/**
 * Inline on the host, all `!important`: an inline important declaration outranks any page author rule. The
 * same resets neutralise the UA's own `[popover]` box -- its inset, border, padding, fit-content sizing and
 * scroll container -- leaving a 0x0 anchor that only its shadow root draws through.
 *
 * No z-index: the host is a popover, so it paints in the top layer, above every page stacking context however
 * the page numbers its own. Popover is Chrome 114 and Firefox 125, under this manifest's 122 and 128 floors.
 */
const HOST_STYLE = {
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    margin: "0",
    border: "0",
    padding: "0",
    overflow: "visible",
    background: "transparent",
    display: "block"
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
 * The activator's rect, rebuilt from the container it sits in.
 *
 * The activator element itself is deliberately not held: a badge is replaced wholesale on every conversion
 * pass, so a stored one would be detached within seconds while an identical badge stands in its place. The
 * offsets are measured once, when the card opens, and ride the container from then on.
 *
 * @param {{top: number, left: number}} container - In viewport coordinates.
 * @param {{top: number, left: number, width: number, height: number}} offset - Inside the container.
 * @returns {{top: number, left: number, right: number, bottom: number, width: number, height: number}}
 */
export function anchorRect(container, offset) {
    const top = container.top + offset.top;
    const left = container.left + offset.left;
    return {
        top,
        left,
        bottom: top + offset.height,
        right: left + offset.width,
        width: offset.width,
        height: offset.height
    };
}

/**
 * Where to put the card: on the activator that opened it -- the badge leading the headline, or the status
 * pill drawn over its corner.
 *
 * Only the horizontal placement is clamped to the viewport. The card travels with its headline vertically,
 * scrolling off the fold with it rather than clinging to an edge detached from the thing it reports on;
 * sideways nothing carries it away, and an anchor the size of a badge cannot pull it back into view alone.
 *
 * @param {{top: number, left: number, right: number, bottom: number, width: number, height: number}} activator
 *   In viewport coordinates.
 * @param {{left: number, width: number}} container - The headline being reported on, which decides which way
 *   the card opens.
 * @param {{width: number, height: number}} card - Measured at its settled size.
 * @param {{width: number, height: number}} viewport
 * @param {number} [margin]
 * @returns {{top: number, left: number, transformOrigin: string}}
 */
export function placeCard(activator, container, card, viewport, margin = PLACE_MARGIN) {
    // Starts on the activator and covers it, as it has always covered the pill: what you clicked is what the
    // card grows out of. Pulled up onto the activator's bottom edge when the room below runs out.
    let top = activator.top;
    if (top + card.height > viewport.height - margin) top = activator.bottom - card.height;

    // Hung from whichever of the activator's edges keeps the card over the headline it reports on. The badge
    // leads the headline, so its card opens rightwards across it; the pill sits at the far corner, so its
    // card opens back over the article instead of out across the column beside it. A card wider than the
    // headline overhangs either way -- this only chooses the side that overhangs least.
    const trailing = activator.left + activator.width / 2 > container.left + container.width / 2;
    let left = trailing ? activator.right - card.width : activator.left;
    left = Math.min(Math.max(left, margin), Math.max(margin, viewport.width - margin - card.width));

    // The activator's centre, expressed inside the card: a point rather than a corner keyword, because once
    // the clamp has moved the card sideways no corner of it is on the activator any more.
    const origin = (centre, edge, size) => Math.round(Math.min(Math.max(centre - edge, 0), size));
    return {
        top,
        left,
        transformOrigin: `${origin(activator.left + activator.width / 2, left, card.width)}px `
            + `${origin(activator.top + activator.height / 2, top, card.height)}px`
    };
}

/**
 * The focused element, reached through any open shadow root. `document.activeElement` stops at the host, so
 * neither opener of the card -- the overlay's status pill, or a badge in the headline -- would be visible
 * here, and focus could not be handed back to it.
 *
 * @returns {Element|null}
 */
function deepActiveElement() {
    let node = document.activeElement;
    while (node?.shadowRoot?.activeElement) node = node.shadowRoot.activeElement;
    return node;
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
 * @returns {{ open: (target: Element, activator?: Element) => void, close: () => void }}
 */
export function createFeedbackDialog({ browser, getFeedbackServerUrl, getDatabaseUpdated, log, setHighlighted = () => {} }) {
    const host = document.createElement("klikkikuri-feedback-dialog");
    // Manual, not auto: the card keeps its own Escape and outside-click handling rather than taking the
    // light-dismiss behaviour, which would also tie it to the page's own popover stack.
    host.setAttribute("popover", "manual");
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
    // landed long before the first click that opens the card.
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
    // Focusable only programmatically: the card takes focus when it opens, so its name is announced, but it
    // never becomes a tab stop of its own. Not trapping focus -- the popover is not modal, and a trap on a
    // card floating in someone else's page would strand a keyboard user in it.
    dialog.setAttribute("tabindex", "-1");
    dialog.hidden = true;
    shadow.appendChild(dialog);

    /** Torn down every time the dialog closes, so a reopened dialog never carries the last one's listeners. */
    let listeners = null;
    let current = null;
    /** Where the activator sits inside `current`, measured when the card opened. See `anchorRect`. */
    let activatorOffset = null;
    let frame = 0;
    /** Where focus came from, to hand it back when the card closes. */
    let opener = null;
    /** The card's live region, rebuilt per render. Announces what `setStatus` writes. */
    let live = null;
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
        resizeObserver.unobserve(dialog);
        current = null;
        // Cleared with the anchor it belongs to: a reopen on another headline would otherwise place the card
        // by the last activator's offsets, which lands it somewhere plausible and wrong.
        activatorOffset = null;
        cancelAnimationFrame(frame);
        frame = 0;
    }

    /**
     * Fade the card, scaling it out of the corner that sits on the anchor so it grows from the headline that
     * was reported on rather than appearing whole.
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
            // keeps the sheets already fetched, but the page is left with no trace of it. Removing an open
            // popover takes it out of the top layer too, so there is nothing else to unwind.
            host.remove();

            // Back to whatever opened it, if the page still has it. preventScroll, because the card also
            // closes when its headline scrolls away -- and focus must not drag the page back to it.
            const returnTo = opener;
            opener = null;
            if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
        // Cancelled by a reopen during the hide, which keeps the card exactly where it is.
        }, () => {});
    }

    /**
     * Measure the anchor and put the card on it, or close the dialog once the anchor is gone -- scrolled
     * fully out of view, hidden, or dropped from the page.
     *
     * The container is read on every call rather than captured when the dialog opened, so the card follows its
     * headline as the page moves under it. The activator's rect is derived from it through `anchorRect`,
     * which is what survives the badge being rebuilt. The geometry itself is in `placeCard`.
     */
    function place() {
        // Both, not just the anchor: the offsets are written a moment after `current` is, and a reposition
        // that arrived in between would have nothing to place against.
        if (!current || !activatorOffset) return;

        if (!current.isConnected) {
            close();
            return;
        }

        const container = current.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        // The container decides whether the card lives: it is the headline being reported on. The activator
        // only decides where the card sits.
        if (isAnchorGone(container, viewport)) {
            close();
            return;
        }

        // offsetWidth/Height rather than a client rect: they ignore transforms, so a reposition mid-animation
        // measures the card at its settled size instead of its scaled one.
        const card = { width: dialog.offsetWidth, height: dialog.offsetHeight };
        const activator = anchorRect(container, activatorOffset);
        const { top, left, transformOrigin } = placeCard(activator, container, card, viewport);

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

    /**
     * Show a status, and say it. The live region is rendered with the card and only its text changes here: a
     * region inserted along with its content is announced unreliably, one that already exists is not.
     *
     * The visible copy is hidden from the accessibility tree, or the same words would land twice.
     */
    function setStatus(container, text, colour) {
        // Read before the swap. Removing the focused control does not leave it focused-but-disconnected: the
        // browser retargets focus to <body>, which is connected -- so asking afterwards cannot tell a control
        // that was taken away from a user who had clicked elsewhere on the page.
        const focused = deepActiveElement();
        const cardHadFocus = focused === dialog || (!!focused && dialog.contains(focused));

        const span = document.createElement("span");
        span.className = "status";
        span.style.color = colour;
        span.textContent = text;
        span.setAttribute("aria-hidden", "true");
        container.replaceChildren(span);

        if (live) live.textContent = text;

        // This status has usually just replaced the control that had focus -- the buttons, or the comment
        // field. Keep focus in the card rather than letting it fall to the page body, but never take it from
        // somewhere the user has moved it to.
        if (cardHadFocus && !focused.isConnected) dialog.focus({ preventScroll: true });
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

        live = document.createElement("div");
        live.className = "visually-hidden";
        live.setAttribute("role", "status");

        dialog.replaceChildren(close_, original, converted, separator, actions, form, live);

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

            // Take focus to the card before disabling the field that holds it. A disabled control hands focus
            // to <body> while staying connected, so nothing after this point could tell that it happened --
            // and the status, which only lands once the request comes back, would arrive to no focus at all.
            if (dialog.contains(deepActiveElement())) dialog.focus({ preventScroll: true });

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
         * @param {Element} [activator] - The control that was activated, which the card is placed on. Measured
         *   here and then let go of; see `anchorRect`. Defaults to the target, placing the card on the
         *   headline itself.
         */
        open(target, activator = target) {
            teardown();
            // A hide still running would otherwise remove the host from under the card we are about to show.
            motion?.cancel();
            motion = null;
            hiding = false;

            listeners = new AbortController();
            // A reopen during the closing animation is already focused inside the card; keep the opener the
            // first opening recorded, or focus would be handed back to a card that no longer exists.
            const active = deepActiveElement();
            if (active !== dialog && !dialog.contains(active)) opener = active;
            current = target;
            setHighlighted(target, true);

            // Measured now, while the page is still exactly as the user left it when they clicked, and kept
            // as offsets rather than as the element. An activator with no box of its own -- never laid out,
            // or simply the target -- puts the card on the headline, which is where it used to go.
            const box = target.getBoundingClientRect();
            const hit = activator.getBoundingClientRect();
            activatorOffset = hit.width && hit.height
                ? { top: hit.top - box.top, left: hit.left - box.left, width: hit.width, height: hit.height }
                : { top: 0, left: 0, width: box.width, height: box.height };

            const { signal } = listeners;

            // Under <html> rather than <body>, so the content script's body-scoped MutationObserver never
            // sees it. Back in before `place()`, which needs the card laid out to measure it.
            if (!host.isConnected) document.documentElement.appendChild(host);
            // Into the top layer. A reopen during the closing animation finds the host still showing, and
            // re-showing an open popover is a no-op on current Chromium but an InvalidStateError elsewhere.
            if (!host.matches(":popover-open")) host.showPopover();
            render(readTarget(target));
            dialog.hidden = false;
            place();
            // After place(), so the card is where it will stay before a screen reader is pointed at it.
            dialog.focus({ preventScroll: true });
            motion = animateCard(true);

            // Follow the headline while the page moves under it. Capture, so a scrolling container that stops
            // the event still reaches us; passive, because none of this cancels anything.
            window.addEventListener("scroll", schedulePlace, { capture: true, passive: true, signal });
            window.addEventListener("resize", schedulePlace, { signal });
            resizeObserver.observe(target);
            // The card too, not just its anchor: its own height decides where its top edge goes once it has
            // ridden up onto the activator, so a card that grows -- the comment form opening, a status line
            // arriving -- has to be placed again. This cannot loop: `place` writes only top, left and
            // transform-origin, and none of those resize the card.
            resizeObserver.observe(dialog);

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
