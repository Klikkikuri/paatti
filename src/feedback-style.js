"use strict";

/**
 * The feedback card's styling, as text, shared by the popup's <feedback-item> and the in-page dialog.
 *
 * The two render the same card on opposite sides of a shadow boundary, so neither can link the other's
 * stylesheet: page sheets do not cross into a shadow root, and a rule written for a shadow root would be
 * unscoped in the popup's light DOM. Sharing the text is what keeps them from drifting.
 *
 * `feedbackRules` therefore takes the scope its caller needs -- "feedback-item " in the popup, so the rules
 * cannot reach anything else on the page, and "" inside the shadow root, where there is nothing else to reach.
 * A template function rather than a prefix rewrite of finished CSS: that breaks on at-rules and nested blocks.
 */

/**
 * The card's own rules.
 *
 * @param {string} scope - Prefix for every selector. Include the trailing space for a descendant scope.
 * @returns {string}
 */
export function feedbackRules(scope = "") {
    return `
${scope}.feedback-card {
    padding: 10px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    list-style: none;
    text-align: left;
}

${scope}.feedback-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: 8px;
}

${scope}.feedback-row.original {
    border-left: 3px solid var(--color-warning);
}

${scope}.feedback-row.converted {
    border-left: 3px solid var(--color-success-strong);
}

${scope}.feedback-label {
    font-size: 0.7em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
}

${scope}.feedback-text {
    font-size: 0.88em;
    color: var(--color-text-primary);
    line-height: 1.35;
    font-weight: bold;
}

${scope}.feedback-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
    min-height: 24px;
}

/* Smaller than a regular push button, so it casts and travels less. */
${scope}.feedback-action-btn {
    --push-offset: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    cursor: pointer;
    font-family: inherit;
}

${scope}.feedback-action-btn.good:hover {
    background: var(--feedback-vote-yes-bg) !important;
    outline-color: var(--color-success-strong) !important;
    color: var(--feedback-vote-yes-text) !important;
}

${scope}.feedback-action-btn.bad:hover {
    background: var(--feedback-vote-no-bg) !important;
    outline-color: var(--color-danger-strong) !important;
    color: var(--feedback-vote-no-text) !important;
}

${scope}.feedback-input-container {
    margin-top: 4px;
    width: 100%;
    box-sizing: border-box;
}

${scope}.feedback-input-group {
    display: flex;
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-border-strong);
    border-radius: 6px;
    overflow: hidden;
    background: var(--color-surface);
    box-shadow: inset 0 1px 3px var(--shadow-ambient);
}

${scope}.feedback-text-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 0.85em;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text-primary);
    box-sizing: border-box;
}

${scope}.feedback-submit-button {
    background: var(--push-bg);
    border: none;
    border-left: 1px solid var(--color-border-strong);
    color: var(--color-text-primary);
    padding: 6px 12px;
    font-size: 0.8em;
    font-weight: bold;
    cursor: pointer;
}

${scope}.feedback-submit-button:hover {
    background: var(--color-info);
    color: var(--color-on-accent);
}

/* Clickbait level badge. Each level supplies a hue; the badge mixes it against the surface for its fill and
 * against the body text colour for its label, so one scale covers both themes. */
${scope}.clickbait-level-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.6em;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    line-height: 1;
    background: color-mix(in srgb, var(--severity) 16%, var(--color-surface));
    color: color-mix(in srgb, var(--severity) 55%, var(--color-text-primary));
    border: 1px solid color-mix(in srgb, var(--severity) 40%, var(--color-surface));
}

${scope}.clickbait-level-badge[data-level="0"] { --severity: var(--severity-0); }
${scope}.clickbait-level-badge[data-level="1"] { --severity: var(--severity-1); }
${scope}.clickbait-level-badge[data-level="2"] { --severity: var(--severity-2); }
${scope}.clickbait-level-badge[data-level="3"] { --severity: var(--severity-3); }
${scope}.clickbait-level-badge[data-level="4"] { --severity: var(--severity-4); }
`;
}

/**
 * The page utilities the card leans on, for the shadow root only: `.feedback-card`'s surface from
 * components.css, `.hidden` from the same, and `.push-button` from styles.css. Copied rather than shared,
 * because they are general utilities owned by the extension pages -- the card's own rules above are the part
 * that must not drift.
 */
export const FEEDBACK_BASE = `
.feedback-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: 6px;
    box-shadow: var(--push-shadow) 2px 2px;
}

.hidden {
    display: none !important;
}

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
