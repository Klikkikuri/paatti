import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser().browser;

await import('../src/options/components/feedback-item.js');

after(() => dom.teardown());

const ITEM = {
    originalTitle: 'Original headline',
    convertedTitle: 'Aligned headline',
    clickbaitLevel: 2,
    isMainPage: false,
    highlightId: 'kk-hl-1',
};

/**
 * Record the signal each document-level click registration was given, so a listener that
 * outlives its render is visible as a second un-aborted signal.
 */
function watchDocumentClicks() {
    const signals = [];
    const original = document.addEventListener.bind(document);
    document.addEventListener = (type, fn, options) => {
        if (type === 'click') signals.push(options?.signal ?? null);
        return original(type, fn, options);
    };
    return {
        live: () => signals.filter((s) => s && !s.aborted).length,
        unsignalled: () => signals.filter((s) => s === null).length,
        total: () => signals.length,
        restore: () => { document.addEventListener = original; },
    };
}

describe('feedback-item does not accumulate document listeners', () => {
    test('a re-render drops the previous outside-click listener', () => {
        const watch = watchDocumentClicks();
        const el = document.createElement('feedback-item');
        document.body.append(el);

        // popup.js re-renders these on every list refresh by re-assigning `item`.
        el.item = ITEM;
        el.item = { ...ITEM };
        el.item = { ...ITEM };

        assert.equal(watch.total(), 3, 'expected one registration per render');
        assert.equal(watch.unsignalled(), 0, 'every registration must carry an abort signal');
        assert.equal(watch.live(), 1, 'only the newest render may still be listening');

        el.remove();
        assert.equal(watch.live(), 0, 'detaching must drop the last listener too');

        watch.restore();
    });

    test('re-attaching wires the element up again', () => {
        const watch = watchDocumentClicks();
        const el = document.createElement('feedback-item');
        document.body.append(el);
        el.item = ITEM;

        el.remove();
        assert.equal(watch.live(), 0);

        document.body.append(el);
        el.item = { ...ITEM };
        assert.equal(watch.live(), 1, 'a re-attached element must listen again, exactly once');

        el.remove();
        watch.restore();
    });
});
