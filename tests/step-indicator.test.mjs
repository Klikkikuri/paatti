import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser({ messages: { welcomeStepCount: 'Step $1 of $2', welcomeTourTag: 'Tour' } }).browser;
await import('../src/options/welcome/step-indicator.js');
after(() => dom.teardown());

const DECK = [
    { id: 'welcome', tourOnly: false, title: 'Welcome' },
    { id: 'service', tourOnly: true, title: 'The service' },
    { id: 'strictness', tourOnly: false, title: 'Strictness' },
    { id: 'markers', tourOnly: false, title: 'Marks' },
    { id: 'popup', tourOnly: true, title: 'Popup' },
];

/** The quick flow of that deck: the cover and two setup steps, with the tour-only slides left out. */
const FLOW = [0, 2, 3];

/** A deck of nine with the real quick flow, which skips the tour-only slides. */
const NINE = ['welcome', 'service', 'browser', 'strictness', 'markers', 'sites', 'popup', 'wrong', 'ready']
    .map((id) => ({ id, tourOnly: !['welcome', 'strictness', 'markers', 'sites', 'ready'].includes(id), title: id }));
const QUICK_FLOW = [0, 3, 4, 5, 8];

function mount(current, { deck = DECK, flow = FLOW } = {}) {
    const el = document.createElement('step-indicator');
    document.body.replaceChildren(el);
    el.update({ deck, flow, current });
    return el;
}

const states = (el) => [...el.querySelectorAll('.step-segment')].map((button) => button.dataset.state);

describe('step-indicator', () => {
    test('has one segment for each step of the flow, and marks the current one', () => {
        const el = mount(2);
        assert.equal(el.querySelectorAll('.step-segment').length, 3);
        assert.deepEqual(states(el), ['past', 'current', 'future']);
        assert.equal(el.querySelectorAll('[aria-current="step"]').length, 1);
        assert.equal(el.querySelector('[aria-current="step"]').dataset.state, 'current');
    });

    test('the cover is a step of the quick flow', () => {
        const el = mount(0);
        assert.equal(el.querySelector('.step-count-long').textContent, 'Step 1 of 3');
        assert.equal(el.querySelector('.step-title').textContent, 'Welcome');
        assert.equal(el.querySelector('.step-tour-tag'), null);
        assert.equal(el.dataset.flow, 'on');
        assert.deepEqual(states(el), ['current', 'future', 'future']);
    });

    test('says the count and the title, and gives the narrow screen a short count', () => {
        const el = mount(2);
        assert.equal(el.querySelector('.step-count-long').textContent, 'Step 2 of 3');
        assert.equal(el.querySelector('.step-count-short').textContent, '2 / 3');
        assert.equal(el.querySelector('.step-title').textContent, 'Strictness');
    });

    test('announces the current step from one live region', () => {
        const el = mount(2);
        const live = el.querySelectorAll('[aria-live]');
        assert.equal(live.length, 1);
        assert.equal(live[0].textContent, 'Step 2 of 3: Strictness');
    });

    test('names each segment by its step', () => {
        const el = mount(2);
        assert.equal(el.querySelectorAll('.step-segment')[2].getAttribute('aria-label'), 'Step 3 of 3: Marks');
    });

    test('tags a tour-only step, and only a tour-only step', () => {
        assert.equal(mount(2).querySelector('.step-tour-tag'), null);
        assert.equal(mount(4).querySelector('.step-tour-tag').textContent, 'Tour');
    });

    test('a click on a segment reports its index and moves nothing itself', () => {
        const el = mount(2);
        const picked = [];
        el.addEventListener('step-select', (event) => picked.push(event.detail));
        el.querySelectorAll('.step-segment')[2].click();

        assert.deepEqual(picked, [3]);
        assert.equal(el.querySelector('[aria-current="step"]').dataset.state, 'current');
        assert.equal(el.querySelectorAll('.step-segment')[1].getAttribute('aria-current'), 'step');
    });

    test('a click reports the deck index, not the position in a flow that skips slides', () => {
        const el = mount(5, { deck: NINE, flow: QUICK_FLOW });
        const picked = [];
        el.addEventListener('step-select', (event) => picked.push(event.detail));
        el.querySelectorAll('.step-segment')[2].click();

        assert.equal(el.querySelectorAll('.step-segment').length, 5);
        assert.equal(el.querySelectorAll('.step-segment')[2].getAttribute('aria-label'), 'Step 3 of 5: markers');
        assert.deepEqual(picked, [4]);
    });

    test('a slide outside the flow shows its title alone', () => {
        const el = mount(1);
        assert.equal(el.querySelector('[aria-current="step"]'), null);
        assert.equal(el.querySelector('.step-count-long'), null);
        assert.equal(el.querySelector('.step-count-short'), null);
        assert.equal(el.querySelector('.step-separator'), null);
        assert.equal(el.querySelector('.step-title').textContent, 'The service');
    });

    test('the live region says the title without a count off the flow', () => {
        const live = mount(1).querySelectorAll('[aria-live]');
        assert.equal(live.length, 1);
        assert.equal(live[0].textContent, 'The service');
    });

    test('no segment is current off the flow, and each one is on its side of the slide', () => {
        assert.deepEqual(states(mount(1)), ['past', 'future', 'future']);
        assert.deepEqual(states(mount(4)), ['past', 'past', 'past']);
    });

    test('carries the flow state on the host', () => {
        assert.equal(mount(2).dataset.flow, 'on');
        assert.equal(mount(1).dataset.flow, 'off');
    });

    test('keeps the segment buttons, so the focus of a reader stays', () => {
        const el = mount(2);
        const button = el.querySelectorAll('.step-segment')[2];
        button.focus();

        el.update({ deck: DECK, flow: FLOW, current: 3 });

        assert.equal(document.activeElement, button);
        assert.equal(el.querySelectorAll('.step-segment')[2], button);
        assert.equal(button.dataset.state, 'current');
    });

    test('keeps one live region, so a change inside it is announced', () => {
        const el = mount(2);
        const live = el.querySelector('[aria-live]');

        el.update({ deck: DECK, flow: FLOW, current: 3 });

        assert.equal(el.querySelector('[aria-live]'), live);
        assert.equal(live.textContent, 'Step 3 of 3: Marks');
    });

    test('builds new segments when the flow changes length', () => {
        const el = mount(2);
        el.update({ deck: NINE, flow: QUICK_FLOW, current: 5 });

        assert.equal(el.querySelectorAll('.step-segment').length, 5);
        assert.equal(el.querySelector('.step-count-long').textContent, 'Step 4 of 5');
    });
});
