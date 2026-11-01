import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';
import { installDom, dispatchTrusted } from './helpers/dom.mjs';

const dom = installDom();
after(() => dom.teardown());

// feedback-dialog.js reaches model.js through feedback.js, and that resolves the namespace at module
// evaluation -- so the mock has to be in place before the dynamic import below. See AGENTS.md.
const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { anchorRect, createFeedbackDialog, isAnchorGone, placeCard } = await import('../src/components/feedback-dialog.js');

/** A DOMRect-alike: the geometry reads the edges, and nothing else. */
const rect = (left, top, width, height) => ({
    left, top, width, height, right: left + width, bottom: top + height
});

const VIEWPORT = { width: 1280, height: 900 };
const CARD = { width: 320, height: 200 };

describe('placeCard', () => {
    // Measured on the iltalehti front page: a card-grid article, the converted badge leading its headline,
    // and the debug pill inset from the same article's top-right corner.
    const ARTICLE = rect(14, 245, 299, 297);
    const BADGE = rect(21, 434, 22, 22);
    const PILL = rect(203, 251, 104, 20);

    test('starts on the activator, top and left edges aligned', () => {
        assert.deepEqual(placeCard(BADGE, ARTICLE, CARD, VIEWPORT), {
            top: 434,
            left: 21,
            transformOrigin: '11px 11px'      // the badge's centre, 11px inside the card on both axes
        });
    });

    test('hangs the card from the trailing edge for an activator on that side of the headline', () => {
        // The pill's case. Left-aligning a 320px card on it would send the card out across the column
        // beside the article; hanging it from the pill's right edge keeps it over the article instead.
        const { left } = placeCard(PILL, ARTICLE, CARD, VIEWPORT);

        assert.equal(left, 8);                 // right 307 - card 320 = -13, pulled back to the margin
        assert.ok(left < ARTICLE.left + ARTICLE.width, 'card starts within the article');
    });

    test('rides up onto the activator bottom edge when the card would fall off the fold', () => {
        const viewport = { width: 1280, height: 560 };
        const anchor = rect(600, 500, 22, 22);            // bottom 522, so 500 + 200 overruns 560 - 8
        const container = rect(590, 400, 300, 200);

        const { top, transformOrigin } = placeCard(anchor, container, CARD, viewport);
        assert.equal(top, 322);                            // bottom 522 - card height 200
        assert.equal(transformOrigin, '11px 189px');       // still the badge's centre, now near the card's foot
    });

    test('keeps the card on the activator past the fold rather than clamping to it', () => {
        // Vertical placement is never clamped: the card rides off the fold with its headline and closes
        // when isAnchorGone catches up.
        const viewport = { width: 1280, height: 300 };
        const anchor = rect(100, 280, 22, 22);             // bottom 302, already past the fold

        assert.equal(placeCard(anchor, rect(90, 200, 300, 150), CARD, viewport).top, 102);
    });

    test('leaves the card on the activator when it exactly fits the margin', () => {
        // The comparison is strict, so the limiting case keeps the primary placement.
        const anchor = rect(100, 692, 22, 22);             // 692 + 200 === 900 - 8

        assert.equal(placeCard(anchor, rect(90, 600, 300, 200), CARD, VIEWPORT).top, 692);
    });

    test('clamps to the right margin for an activator past the viewport edge', () => {
        const anchor = rect(1400, 200, 22, 22);
        const container = rect(1390, 150, 300, 200);       // leading side of its own container

        assert.equal(placeCard(anchor, container, CARD, VIEWPORT).left, 952);   // 1280 - 8 - 320
    });

    test('pins the origin to the card edge when the activator centre falls outside it', () => {
        // Clamped away from its activator, the card can no longer grow from the point it was opened at, so
        // the origin sits on the nearest edge instead of drifting outside the card.
        const anchor = rect(1400, 200, 22, 22);
        const container = rect(1390, 150, 300, 200);

        assert.equal(placeCard(anchor, container, CARD, VIEWPORT).transformOrigin, '320px 11px');
    });

    test('honours a caller-supplied margin', () => {
        const anchor = rect(100, 690, 22, 22);             // bottom 712
        const container = rect(90, 600, 300, 200);

        assert.equal(placeCard(anchor, container, CARD, VIEWPORT, 0).top, 690);
        assert.equal(placeCard(anchor, container, CARD, VIEWPORT, 120).top, 512);   // 712 - 200
    });
});

describe('anchorRect', () => {
    test('rides the container, keeping the activator own size', () => {
        // The arithmetic that makes a rebuilt badge a non-event: the offset is measured once and the rect
        // is derived from the container from then on, so nothing holds the badge itself.
        const offset = { top: 194, left: 7, width: 22, height: 22 };

        assert.deepEqual(anchorRect({ top: 245, left: 313 }, offset), {
            top: 439, left: 320, bottom: 461, right: 342, width: 22, height: 22
        });

        // Scrolled 100px up, the anchor moves by exactly that and nothing else changes.
        assert.deepEqual(anchorRect({ top: 145, left: 313 }, offset), {
            top: 339, left: 320, bottom: 361, right: 342, width: 22, height: 22
        });
    });
});

describe('isAnchorGone', () => {
    test('keeps an anchor that is fully or partly on screen', () => {
        assert.equal(isAnchorGone(rect(0, 100, 400, 100), VIEWPORT), false);
        assert.equal(isAnchorGone(rect(0, -50, 400, 100), VIEWPORT), false);    // half above the fold
        assert.equal(isAnchorGone(rect(0, 850, 400, 100), VIEWPORT), false);    // half below it
        assert.equal(isAnchorGone(rect(-10, 100, 400, 100), VIEWPORT), false);
    });

    test('drops an anchor that has collapsed to nothing', () => {
        assert.equal(isAnchorGone(rect(0, 100, 0, 100), VIEWPORT), true);
        assert.equal(isAnchorGone(rect(0, 100, 400, 0), VIEWPORT), true);
    });

    test('drops an anchor scrolled fully past an edge', () => {
        assert.equal(isAnchorGone(rect(0, -100, 400, 100), VIEWPORT), true);    // bottom exactly 0
        assert.equal(isAnchorGone(rect(0, 900, 400, 100), VIEWPORT), true);     // top exactly the fold
        assert.equal(isAnchorGone(rect(-400, 100, 400, 100), VIEWPORT), true);  // right exactly 0
        assert.equal(isAnchorGone(rect(1280, 100, 400, 100), VIEWPORT), true);  // left exactly the width
    });
});

describe('the card submits only what the user does', () => {
    // What jsdom does not have, and the card needs only to exist: popover, animation, observers, the sheets.
    globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.ResizeObserver = class { observe() {} unobserve() {} };
    globalThis.fetch = async () => ({ text: async () => '' });
    dom.window.HTMLElement.prototype.showPopover = function () {};
    dom.window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() });
    Object.defineProperty(dom.window.ShadowRoot.prototype, 'adoptedStyleSheets', { value: [], writable: true });

    let sent;
    let root;

    beforeEach(() => {
        for (const host of document.querySelectorAll('klikkikuri-feedback-dialog')) host.remove();
        document.body.replaceChildren();
        sent = [];

        const dialog = createFeedbackDialog({
            browser: {
                ...fake.browser,
                runtime: {
                    ...fake.browser.runtime,
                    sendMessage: async (message) => {
                        sent.push(message);
                        return { success: true };
                    }
                }
            },
            getDatabaseStatus: async () => ({ databaseGenerationDate: '2026-10-17T12:57:49Z' }),
            log: () => {}
        });

        const target = document.createElement('div');
        Object.assign(target.dataset, {
            klikkikuriUrlSign: 'abc123',
            klikkikuriOriginalTitle: 'Tämä yksi temppu',
            klikkikuriConvertedTitle: 'Kunta korotti veroja',
            klikkikuriClickbaitLevel: '3'
        });
        // jsdom does no layout, and a card whose headline has no box closes at once.
        target.getBoundingClientRect = () => ({ left: 10, top: 10, width: 300, height: 40, right: 310, bottom: 50 });
        document.body.append(target);

        dialog.open(target);
        root = document.querySelector('klikkikuri-feedback-dialog').shadowRoot;
    });

    /** Lets the submission's awaits finish, so a message that would be sent has been sent. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    const el = (selector) => root.querySelector(selector);
    const submitted = () => sent.filter((message) => message.action === 'submitFeedback').map(({ payload }) => payload);
    const trustedClick = (target) => dispatchTrusted(target, 'click', { bubbles: true, composed: true }, 'MouseEvent');
    const enter = { key: 'Enter', bubbles: true, cancelable: true };

    /** The user's "Is no good" opens the comment form; jsdom would let a test type into a hidden one. */
    const openCommentForm = () => {
        trustedClick(el('.feedback-action-btn.bad'));
        assert.ok(!el('.feedback-input-container').classList.contains('hidden'), '"Is no good" did not open the form');
    };

    test('forces visibility inline, so a page rule that hides an undefined element cannot hide the card', () => {
        const host = document.querySelector('klikkikuri-feedback-dialog');

        // jsdom drops the priority from its `visibility` serialization, so the hostile-css e2e proves the cascade.
        assert.equal(host.style.getPropertyValue('visibility'), 'inherit');
    });

    test('a synthetic click on "Is good" sends nothing', async () => {
        el('.feedback-action-btn.good').click();
        await settle();

        assert.deepEqual(submitted(), []);
    });

    test('a synthetic click on Submit sends nothing', async () => {
        trustedClick(el('.feedback-action-btn.bad'));
        el('.feedback-text-input').value = 'fake comment';
        el('.feedback-submit-button').click();
        await settle();

        assert.deepEqual(submitted(), []);
    });

    test('a synthetic Enter in the comment field sends nothing', async () => {
        trustedClick(el('.feedback-action-btn.bad'));
        el('.feedback-text-input').value = 'fake comment';
        el('.feedback-text-input').dispatchEvent(new dom.window.KeyboardEvent('keydown', enter));
        await settle();

        assert.deepEqual(submitted(), []);
    });

    test('the user\'s click on "Is good" submits positive feedback', async () => {
        trustedClick(el('.feedback-action-btn.good'));
        await settle();

        const [payload, ...rest] = submitted();
        assert.equal(rest.length, 0);
        assert.equal(payload.feedbackType, 'good_conversion');
        assert.equal(payload.urlSign, 'abc123');
    });

    test('the user\'s click on Submit submits negative feedback with the comment', async () => {
        openCommentForm();
        el('.feedback-text-input').value = 'Otsikko ei vastaa juttua';
        trustedClick(el('.feedback-submit-button'));
        await settle();

        const [payload, ...rest] = submitted();
        assert.equal(rest.length, 0);
        assert.equal(payload.feedbackType, 'bad_conversion');
        assert.equal(payload.comment, 'Otsikko ei vastaa juttua');
    });

    test('the user\'s Enter in the comment field submits negative feedback', async () => {
        openCommentForm();
        el('.feedback-text-input').value = 'Otsikko ei vastaa juttua';
        dispatchTrusted(el('.feedback-text-input'), 'keydown', enter, 'KeyboardEvent');
        await settle();

        const [payload, ...rest] = submitted();
        assert.equal(rest.length, 0);
        assert.equal(payload.feedbackType, 'bad_conversion');
        assert.equal(payload.comment, 'Otsikko ei vastaa juttua');
    });
});
