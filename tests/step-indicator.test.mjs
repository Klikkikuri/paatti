import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser({ messages: { welcomeStepCount: 'Step $1 of $2', welcomeTourTag: 'Tour' } }).browser;
await import('../src/options/welcome/step-indicator.js');
after(() => dom.teardown());

const STEPS = [
    { id: 'a', tour: false, title: 'Strictness' },
    { id: 'b', tour: false, title: 'Marks' },
    { id: 'c', tour: true, title: 'Wrong' },
];

function mount(current) {
    const el = document.createElement('step-indicator');
    document.body.replaceChildren(el);
    el.update(STEPS, current);
    return el;
}

describe('step-indicator', () => {
    test('has one segment for each step, and marks the current one', () => {
        const el = mount(1);
        const states = [...el.querySelectorAll('.step-segment')].map((b) => b.dataset.state);
        assert.deepEqual(states, ['past', 'current', 'future']);
        assert.equal(el.querySelectorAll('[aria-current="step"]').length, 1);
        assert.equal(el.querySelector('[aria-current="step"]').dataset.state, 'current');
    });

    test('says the count and the title, and gives the narrow screen a short count', () => {
        const el = mount(1);
        assert.equal(el.querySelector('.step-count-long').textContent, 'Step 2 of 3');
        assert.equal(el.querySelector('.step-count-short').textContent, '2 / 3');
        assert.equal(el.querySelector('.step-title').textContent, 'Marks');
    });

    test('announces the current step from one live region', () => {
        const el = mount(0);
        const live = el.querySelectorAll('[aria-live]');
        assert.equal(live.length, 1);
        assert.equal(live[0].textContent, 'Step 1 of 3: Strictness');
    });

    test('names each segment by its step', () => {
        const el = mount(0);
        assert.equal(el.querySelectorAll('.step-segment')[2].getAttribute('aria-label'), 'Step 3 of 3: Wrong');
    });

    test('tags a tour step, and only a tour step', () => {
        assert.equal(mount(1).querySelector('.step-tour-tag'), null);
        assert.equal(mount(2).querySelector('.step-tour-tag').textContent, 'Tour');
    });

    test('a click on a segment reports its index and moves nothing itself', () => {
        const el = mount(0);
        const picked = [];
        el.addEventListener('step-select', (event) => picked.push(event.detail));
        el.querySelectorAll('.step-segment')[2].click();

        assert.deepEqual(picked, [2]);
        assert.equal(el.querySelector('[aria-current="step"]').dataset.state, 'current');
        assert.equal(el.querySelectorAll('.step-segment')[0].getAttribute('aria-current'), 'step');
    });
});
