import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, dispatchTrusted } from './helpers/dom.mjs';

const dom = installDom();
after(() => dom.teardown());

// jsdom has no ResizeObserver, and the overlay only needs one to exist.
globalThis.ResizeObserver = class { observe() {} unobserve() {} };

const { createHighlightOverlay } = await import('../src/components/highlight-overlay.js');

/** After the overlay's own scheduled draw, which was queued first. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** jsdom does no layout, and a zero-size target is drawn hidden. */
function headline(status) {
    const element = document.createElement('div');
    if (status) element.dataset.klikkikuriStatus = status;
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20 });
    document.body.append(element);
    return element;
}

const boxes = () => [...document.querySelector('klikkikuri-highlight-overlay').shadowRoot.querySelectorAll('.box')];

beforeEach(() => {
    document.body.replaceChildren();
    for (const host of document.querySelectorAll('klikkikuri-highlight-overlay')) host.remove();
});

describe('the overlay host', () => {
    test('forces visibility inline, so a page rule that hides an undefined element cannot hide the overlay', () => {
        createHighlightOverlay();
        const host = document.querySelector('klikkikuri-highlight-overlay');

        // jsdom drops the priority from its `visibility` serialization, so the hostile-css e2e proves the cascade.
        assert.equal(host.style.getPropertyValue('visibility'), 'inherit');
    });
});

describe('highlight sources', () => {
    test('clearing the hover keeps the card highlight', async () => {
        const overlay = createHighlightOverlay();
        const a = headline();
        const b = headline();

        overlay.setFeedback([a], true);
        overlay.setHover([a, b], true);
        overlay.clearHover();
        await frame();

        assert.equal(boxes().length, 1);
        assert.ok(boxes()[0].classList.contains('feedback'));
    });

    test('a hover that ends on the card element keeps the card highlight', async () => {
        const overlay = createHighlightOverlay();
        const a = headline();

        overlay.setFeedback([a], true);
        overlay.setHover([a], true);
        overlay.setHover([a], false);
        await frame();

        assert.equal(boxes().length, 1);
        assert.ok(boxes()[0].classList.contains('feedback'));
    });
});

for (const status of ['converted', 'original']) {
    describe(`a pressed ${status} pill when status highlighting goes off`, () => {
        async function press() {
            const overlay = createHighlightOverlay({
                canActivate: () => true,
                onLabelActivate: (element) => overlay.setFeedback([element], true)
            });
            headline(status);
            overlay.setStatusVisible(true);
            await frame();

            const label = boxes()[0].querySelector('.label');
            assert.equal(label.disabled, false);
            label.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
            overlay.setStatusVisible(false);
            await frame();
            return label;
        }

        test('keeps the box until the click opens the card', async () => {
            const label = await press();
            assert.equal(boxes().length, 1);

            window.dispatchEvent(new Event('pointerup'));
            dispatchTrusted(label, 'click', { bubbles: true, composed: true }, 'MouseEvent');
            await frame();

            assert.equal(boxes().length, 1);
            assert.ok(boxes()[0].classList.contains('feedback'));
        });

        test('drops the box when the press ends without a click', async () => {
            await press();

            window.dispatchEvent(new Event('pointerup'));
            await frame();

            assert.equal(boxes().length, 0);
        });
    });
}

describe('a pill click', () => {
    async function pill(onLabelActivate) {
        const overlay = createHighlightOverlay({ canActivate: () => true, onLabelActivate });
        headline('converted');
        overlay.setStatusVisible(true);
        await frame();
        return boxes()[0].querySelector('.label');
    }

    test('from the user opens the card', async () => {
        let opened = 0;
        const label = await pill(() => { opened++; });

        dispatchTrusted(label, 'click', { bubbles: true, composed: true }, 'MouseEvent');
        assert.equal(opened, 1);
    });

    test('from the page does nothing', async () => {
        let opened = 0;
        const label = await pill(() => { opened++; });

        label.click();
        assert.equal(opened, 0, 'a synthetic click opened the card');
    });
});
