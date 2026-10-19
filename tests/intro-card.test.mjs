import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';
import { installDom, dispatchTrusted } from './helpers/dom.mjs';

const dom = installDom();
after(() => dom.teardown());

// jsdom has no popover API; the card only needs the two calls to exist.
HTMLElement.prototype.showPopover = function () { this.setAttribute('data-shown', ''); };
HTMLElement.prototype.hidePopover = function () { this.removeAttribute('data-shown'); };

const fake = createFakeBrowser({
    messages: { introCardText: 'Klikkikuri activated for the first time on this page.', introCardTour: 'Tour' },
});
const sent = [];
fake.browser.runtime.sendMessage = async (message) => { sent.push(message); };
globalThis.browser = fake.browser;

const { showIntroCard, INTRO_CARD_SECONDS, INTRO_CARD_FADE_SECONDS } = await import('../src/components/intro-card.js');

const HOST = 'klikkikuri-intro-card';
const log = () => {};
const cardHost = () => document.querySelector(HOST);
const shadow = () => cardHost().shadowRoot;
const flush = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
    document.documentElement.querySelectorAll(HOST).forEach((el) => el.remove());
    sent.length = 0;
});

describe('showIntroCard', () => {
    test('puts one host under the root element, in the top layer', async () => {
        await showIntroCard({ browser: fake.browser, log });

        assert.equal(document.querySelectorAll(HOST).length, 1);
        assert.equal(cardHost().parentElement, document.documentElement);
        assert.equal(cardHost().hasAttribute('data-shown'), true);
    });

    test('says what happened, and names itself as a group', async () => {
        await showIntroCard({ browser: fake.browser, log });

        assert.match(shadow().querySelector('.text').textContent, /activated for the first time/);
        const card = shadow().querySelector('.card');
        assert.equal(card.getAttribute('role'), 'group');
        assert.ok(card.getAttribute('aria-label'));
    });

    test('uses the localized text when there is one, and English when there is none', async () => {
        await showIntroCard({ browser: fake.browser, log });

        const labels = [...shadow().querySelectorAll('button')].map((b) => b.textContent);
        assert.deepEqual(labels, ['Quick setup', 'Tour', 'Not now']);
    });

    test('puts nothing of the extension address in the page', async () => {
        await showIntroCard({ browser: fake.browser, log });

        const markup = cardHost().outerHTML + shadow().innerHTML.replace(/<style>[\s\S]*?<\/style>/g, '');
        assert.doesNotMatch(markup, /(moz|chrome)-extension:/);
        assert.equal(shadow().querySelector('img'), null);
        assert.ok(shadow().querySelector('.logo svg'), 'the logo is inline markup');
    });

    test('adopts the shared theme sheets, and still shows when they cannot load', async () => {
        await showIntroCard({ browser: fake.browser, log });

        assert.ok(shadow().querySelector('.card').classList.contains('feedback-card'));
        assert.ok(shadow().querySelector('.push-button'));
    });

    test('does not take focus', async () => {
        const before = document.activeElement;
        await showIntroCard({ browser: fake.browser, log });
        assert.equal(document.activeElement, before);
    });
});

describe('the buttons', () => {
    const CASES = [
        ['Tour', '.tour', { action: 'openWizard', mode: 'tour' }],
        ['Quick setup', '.quick', { action: 'openWizard', mode: 'quick' }],
    ];

    for (const [name, selector, message] of CASES) {
        test(`${name} asks for the wizard in that mode, and closes the card`, async () => {
            await showIntroCard({ browser: fake.browser, log });
            dispatchTrusted(shadow().querySelector(selector), 'click');
            await flush(450);

            assert.deepEqual(sent, [message]);
            assert.equal(cardHost(), null);
        });
    }

    test('a click that the page dispatched asks for nothing', async () => {
        await showIntroCard({ browser: fake.browser, log });
        shadow().querySelector('.quick').dispatchEvent(new Event('click'));
        await flush(10);

        assert.deepEqual(sent, []);
        assert.ok(cardHost());
    });

    test('Not now closes the card and asks for nothing', async () => {
        await showIntroCard({ browser: fake.browser, log });
        dispatchTrusted(shadow().querySelector('.later'), 'click');
        await flush(450);

        assert.deepEqual(sent, []);
        assert.equal(cardHost(), null);
    });
});

describe('closing', () => {
    test('Escape closes the card', async () => {
        await showIntroCard({ browser: fake.browser, log });
        shadow().querySelector('.later').dispatchEvent(Object.assign(new Event('keydown', { bubbles: true }), { key: 'Escape' }));
        await flush(450);

        assert.equal(cardHost(), null);
    });

    test('the card hides itself when its bar has run out', async () => {
        await showIntroCard({ browser: fake.browser, log });
        shadow().querySelector('.bar').dispatchEvent(new Event('animationend'));
        await flush(450);

        assert.equal(cardHost(), null);
    });

    test('the bar runs for the stated time', async () => {
        await showIntroCard({ browser: fake.browser, log });
        const css = [...shadow().querySelectorAll('style')].map((style) => style.textContent).join('\n');
        assert.match(css, new RegExp(`run-out ${INTRO_CARD_SECONDS}s`));
    });

    test('the card fades over the last seconds of the bar, and a hover or focus switches both off', async () => {
        await showIntroCard({ browser: fake.browser, log });
        const css = [...shadow().querySelectorAll('style')].map((style) => style.textContent).join('\n');

        assert.match(css, new RegExp(`animation: fade-out ${INTRO_CARD_FADE_SECONDS}s linear ${INTRO_CARD_SECONDS - INTRO_CARD_FADE_SECONDS}s`));
        assert.match(css, /\.fade:hover,\s*\.fade:focus-within \{\s*animation: none;/);
        assert.match(css, /\.fade:hover \.bar,\s*\.fade:focus-within \.bar \{\s*animation: none;/);
        assert.ok(shadow().querySelector('.fade > .card'));
    });

    test('close() twice is harmless', async () => {
        const card = await showIntroCard({ browser: fake.browser, log });
        card.close();
        card.close();
        await flush(450);

        assert.equal(cardHost(), null);
    });
});
