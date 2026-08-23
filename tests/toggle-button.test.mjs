import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser().browser;

// Dynamic: the module builds its templates and calls customElements.define at evaluation,
// so a static import would be hoisted above installDom() and run with no document.
await import('../src/options/components/toggle-button.js');

after(() => dom.teardown());

/** Attach a fresh element, so each test starts from connectedCallback. */
function attach(attributes = {}) {
    const el = document.createElement('toggle-button');
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    document.body.append(el);
    return el;
}

describe('toggle-button renders the layout its type asks for', () => {
    test('switch is the default, and wraps the input in a slider label', () => {
        const el = attach();
        assert.ok(el.querySelector('label.toggle-switch'), 'expected the slider label');
        assert.ok(el.querySelector('.toggle-slider'), 'expected the slider span');
    });

    test('toggle is a bare checkbox carrying the popup marker classes', () => {
        const el = attach({ type: 'toggle' });
        const input = el.querySelector('input');
        assert.equal(el.querySelector('label.toggle-switch'), null);
        // popup.js:65 greys settings out by querying .settingsview .conversion-switch,
        // so both classes are behaviour, not decoration.
        assert.ok(input.classList.contains('toggle'));
        assert.ok(input.classList.contains('conversion-switch'));
    });
});

describe('checked reflects between the attribute, the property and the input', () => {
    test('the attribute seeds the input', () => {
        const el = attach({ checked: '' });
        assert.equal(el.querySelector('input').checked, true);
        assert.equal(el.checked, true);
    });

    test('the property writes through to both the input and the attribute', () => {
        const el = attach();
        el.checked = true;
        assert.equal(el.querySelector('input').checked, true);
        assert.equal(el.hasAttribute('checked'), true);

        el.checked = false;
        assert.equal(el.querySelector('input').checked, false);
        assert.equal(el.hasAttribute('checked'), false);
    });

    test('disabled reflects the same way', () => {
        const el = attach();
        el.disabled = true;
        assert.equal(el.querySelector('input').disabled, true);
        assert.equal(el.hasAttribute('disabled'), true);
    });
});

describe('a user change emits toggle-change', () => {
    test('the event bubbles and carries the new state', () => {
        const el = attach();
        const seen = [];
        document.addEventListener('toggle-change', (e) => seen.push(e.detail.checked));

        el.querySelector('input').click();
        el.querySelector('input').click();

        assert.deepEqual(seen, [true, false]);
    });

    test('the attribute tracks what the user did', () => {
        const el = attach();
        el.querySelector('input').click();
        assert.equal(el.hasAttribute('checked'), true);
    });
});
