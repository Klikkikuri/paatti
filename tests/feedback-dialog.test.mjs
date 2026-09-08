import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

// feedback-dialog.js reaches model.js through feedback.js, and that resolves the namespace at module
// evaluation -- so the mock has to be in place before the dynamic import below. See AGENTS.md.
const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { isAnchorGone, placeCard } = await import('../src/components/feedback-dialog.js');

/** A DOMRect-alike: the geometry reads the edges, and nothing else. */
const rect = (left, top, width, height) => ({
    left, top, width, height, right: left + width, bottom: top + height
});

const VIEWPORT = { width: 1280, height: 900 };
const CARD = { width: 320, height: 200 };

describe('placeCard', () => {
    test('puts the card top-right corner on the anchor top-right, over the pill', () => {
        const anchor = rect(200, 100, 400, 200);

        assert.deepEqual(placeCard(anchor, CARD, VIEWPORT), {
            top: 100,
            left: 280,          // anchor.right 600 - card width 320
            transformOrigin: 'top right'
        });
    });

    test('pulls the card up onto the anchor bottom edge when it would fall off the fold', () => {
        const viewport = { width: 1280, height: 760 };
        const anchor = rect(600, 652, 300, 94);        // bottom 746
        const card = { width: 320, height: 202 };

        // 652 + 202 overruns 760 - 8, so the card sits on the anchor's bottom edge instead.
        assert.deepEqual(placeCard(anchor, card, viewport), {
            top: 544,
            left: 580,
            transformOrigin: 'bottom right'
        });
    });

    test('never pulls the card below the pill, however tall the anchor', () => {
        const viewport = { width: 1280, height: 300 };
        const anchor = rect(0, 10, 400, 790);          // bottom 800, far past the fold
        const card = { width: 320, height: 290 };

        // anchor.bottom - height would be 510, well below the fold; the pill wins.
        const { top, transformOrigin } = placeCard(anchor, card, viewport);
        assert.equal(top, 10);
        assert.equal(transformOrigin, 'top right');
    });

    test('aligns to the left edge when the anchor is narrower than the card', () => {
        const anchor = rect(14, 200, 299, 100);        // right 313, so right-alignment lands at -7

        assert.deepEqual(placeCard(anchor, CARD, VIEWPORT), {
            top: 200,
            left: 14,
            transformOrigin: 'top left'
        });
    });

    test('applies both fallbacks at once', () => {
        const viewport = { width: 400, height: 300 };
        const anchor = rect(10, 200, 120, 60);         // narrow and low: bottom 260

        assert.deepEqual(placeCard(anchor, CARD, viewport), {
            top: 60,                                   // 200 + 200 > 292, so bottom 260 - 200
            left: 10,
            transformOrigin: 'bottom left'
        });
    });

    test('leaves the card on its corner when it exactly fits the margin', () => {
        // Both fallbacks are strict comparisons, so the limiting case keeps the primary placement.
        const anchor = rect(200, 492, 400, 100);
        const card = { width: 320, height: 400 };      // 492 + 400 === 900 - 8

        const flush = placeCard(anchor, card, VIEWPORT);
        assert.equal(flush.top, 492);
        assert.equal(flush.transformOrigin, 'top right');

        const narrow = rect(8, 100, 320, 50);          // right 328, so left lands exactly on the margin
        assert.equal(placeCard(narrow, CARD, VIEWPORT).left, 8);
    });

    test('honours a caller-supplied margin', () => {
        const anchor = rect(200, 600, 400, 100);       // bottom 700

        assert.equal(placeCard(anchor, CARD, VIEWPORT, 0).top, 600);
        assert.equal(placeCard(anchor, CARD, VIEWPORT, 120).top, 500);
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
