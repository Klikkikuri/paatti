import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser({
    messages: { settingSavedSuccess: 'Saved!', settingSavedError: 'Could not save', okKey: 'Custom ok' },
}).browser;

const { createToggleSetting } = await import('../src/options/components/toggle-setting.js');
const { defineComponent } = await import('../src/options/components/component-utils.js');

after(() => dom.teardown());

/** State the fake setting writes to, plus a way to push a new value at subscribers. */
let store;

beforeEach(() => { store = { value: false, subscribers: new Set(), writes: [], fail: false }; });

let seq = 0;

/** Register a setting element wired to `store`, and attach one instance. */
function mount({ layout, ...overrides } = {}) {
    const tag = `test-setting-${seq++}`;
    defineComponent(tag, createToggleSetting({
        settingKey: () => 'testKey',
        labels: () => ({ compact: 'Compact label', title: 'Title', description: 'Description' }),
        read: (el, apply) => {
            store.subscribers.add(apply);
            apply(store.value);
            return () => store.subscribers.delete(apply);
        },
        write: async (el, checked) => {
            if (store.fail) throw new Error('write refused');
            store.writes.push(checked);
            store.value = checked;
        },
        ...overrides,
    }));

    const el = document.createElement(tag);
    if (layout) el.setAttribute('layout', layout);
    document.body.append(el);
    return el;
}

const settled = () => new Promise((r) => setTimeout(r, 0));

describe('the detailed layout renders a labelled card', () => {
    test('title and description come from labels()', () => {
        const el = mount();
        assert.equal(el.querySelector('.title-text').textContent, 'Title');
        assert.equal(el.querySelector('.description-text').textContent, 'Description');
        assert.ok(el.querySelector('.setting-group'), 'expected the card wrapper');
    });

    test('decorate can append to the title', () => {
        const el = mount({ decorate: (_el, titleEl) => titleEl.append(' ', document.createElement('span')) });
        assert.ok(el.querySelector('.title-text span'), 'decorate did not run');
        assert.equal(el.querySelector('.title-text').textContent, 'Title ');
    });

    test('the toggle-button gets the id for this layout', () => {
        const el = mount({ ids: () => ({ compact: 'c-id', detailed: 'd-id' }) });
        assert.equal(el.querySelector('toggle-button').id, 'd-id');
    });
});

describe('the compact layout renders a row', () => {
    test('it uses the compact label and the shared row class', () => {
        const el = mount({ layout: 'compact' });
        assert.equal(el.querySelector('.label-text').textContent, 'Compact label');
        assert.ok(el.classList.contains('compact-setting-row'));
        assert.equal(el.querySelector('.setting-group'), null, 'compact has no card');
    });

    test('it takes the compact id', () => {
        const el = mount({ layout: 'compact', ids: () => ({ compact: 'c-id', detailed: 'd-id' }) });
        assert.equal(el.querySelector('toggle-button').id, 'c-id');
    });
});

describe('the stored value drives the control', () => {
    test('the initial value is applied on connect', () => {
        store.value = true;
        const el = mount();
        assert.equal(el.querySelector('toggle-button').checked, true);
    });

    test('a later change is applied too', () => {
        const el = mount();
        assert.equal(el.querySelector('toggle-button').checked, false);

        for (const apply of store.subscribers) apply(true);
        assert.equal(el.querySelector('toggle-button').checked, true);
    });

    test('detaching unsubscribes', () => {
        const el = mount();
        assert.equal(store.subscribers.size, 1);

        el.remove();
        assert.equal(store.subscribers.size, 0);
    });
});

describe('flipping the control writes', () => {
    test('a user click calls write with the new value', async () => {
        const el = mount();
        el.querySelector('toggle-button input').click();
        await settled();

        assert.deepEqual(store.writes, [true]);
    });

    test('clicking the card flips it too, via toggle-button', async () => {
        const el = mount();
        el.querySelector('.setting-label').click();
        await settled();

        assert.deepEqual(store.writes, [true]);
    });

    test('a click on the toggle itself is not handled twice by the card', async () => {
        const el = mount();
        el.querySelector('toggle-button input').click();
        await settled();

        assert.equal(store.writes.length, 1, 'the card listener must ignore clicks inside the toggle');
    });
});

describe('setting-saved reports the outcome', () => {
    /** Collect the events that reach the document. */
    function record() {
        const seen = [];
        const fn = (e) => seen.push(e.detail);
        document.addEventListener('setting-saved', fn);
        return { seen, stop: () => document.removeEventListener('setting-saved', fn) };
    }

    test('success emits on the detailed layout', async () => {
        const r = record();
        const el = mount();
        el.querySelector('toggle-button input').click();
        await settled();

        assert.deepEqual(r.seen, [{ key: 'testKey', value: true, success: true, message: 'Saved!' }]);
        r.stop();
    });

    test('the compact layout stays quiet -- the popup has nowhere to show it', async () => {
        const r = record();
        const el = mount({ layout: 'compact' });
        el.querySelector('toggle-button input').click();
        await settled();

        assert.deepEqual(r.seen, []);
        assert.deepEqual(store.writes, [true], 'it still writes, it just does not announce');
        r.stop();
    });

    test('a failed write reverts the control and reports the old value', async () => {
        store.fail = true;
        const r = record();
        const el = mount();
        const toggle = el.querySelector('toggle-button');

        toggle.querySelector('input').click();
        await settled();

        assert.equal(toggle.checked, false, 'the control must go back to where it was');
        assert.deepEqual(r.seen, [{ key: 'testKey', value: false, success: false, message: 'Could not save' }]);
        assert.deepEqual(store.writes, []);
        r.stop();
    });

    test('an explicit messageKey is used', async () => {
        const r = record();
        const el = mount({ messages: { savedKey: 'okKey', savedFallback: 'fallback' } });
        el.querySelector('toggle-button input').click();
        await settled();

        assert.equal(r.seen[0].message, 'Custom ok');
        r.stop();
    });
});
