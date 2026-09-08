import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
const fake = createFakeBrowser({
    messages: {
        databaseUpdateBtn: 'Update Database',
        databaseUpdateBtnUpdating: 'Updating...',
        databaseUpdateSuccess: 'Updated!',
        databaseUpdateFailed: 'Failed!',
        databaseNeverUpdated: 'Never updated',
        databaseGenerationNever: 'No generation date',
        databaseLastUpdated: 'Last updated $1',
        databaseGenerationDate: 'Generated $1',
    },
});
globalThis.browser = fake.browser;

await import('../src/options/components/database-status-setting.js');

after(() => dom.teardown());

/** What the component's update button asks the background to do. */
let updateResponse;

beforeEach(() => {
    updateResponse = { success: true };
    globalThis.browser.runtime.sendMessage = async () => updateResponse;
    document.body.replaceChildren();
});

const settled = () => new Promise((r) => setTimeout(r, 0));

/** Attach one instance and wait out its async loadState. */
async function mount(layout = 'compact') {
    const el = document.createElement('database-status-setting');
    el.setAttribute('layout', layout);
    document.body.append(el);
    await settled();
    return el;
}

/** Collect the setting-saved events that reach the document. */
function record() {
    const seen = [];
    const fn = (e) => seen.push(e.detail);
    document.addEventListener('setting-saved', fn);
    return { seen, stop: () => document.removeEventListener('setting-saved', fn) };
}

// The popup carries one in the settings view and one in the home view. Ids would collide, so the
// compact template's handles are classes and every lookup is scoped to the instance.
describe('two compact instances in one document', () => {
    test('each finds its own button and its own timestamps', async () => {
        const first = await mount();
        const second = await mount();

        for (const el of [first, second]) {
            assert.equal(el.querySelectorAll('.db-update-btn').length, 1);
            assert.equal(el.querySelector('.db-update-btn').textContent, 'Update Database');
            assert.equal(el.querySelector('.db-last-updated').textContent, 'Never updated');
            assert.equal(el.querySelector('.db-generation-date').textContent, 'No generation date');
        }
    });

    test('clicking one drives only that one', async () => {
        const first = await mount();
        const second = await mount();

        let release;
        globalThis.browser.runtime.sendMessage = () => new Promise((r) => { release = r; });

        first.querySelector('.db-update-btn').click();
        await settled();

        assert.equal(first.querySelector('.db-update-btn').textContent, '◦◦◦');
        assert.equal(second.querySelector('.db-update-btn').textContent, 'Update Database');

        release({ success: true });
        await settled();
    });
});

// These were suppressed on the compact layout while the popup had nowhere to show a result.
// It now reports them on the home view, so both layouts announce what happened.
describe('the compact layout announces its update', () => {
    test('success emits', async () => {
        const el = await mount();
        const r = record();

        el.querySelector('.db-update-btn').click();
        await settled();

        assert.deepEqual(r.seen, [{ key: 'databaseUpdate', success: true, message: 'Updated!' }]);
        r.stop();
    });

    test('a refused update emits the reason the background gave', async () => {
        updateResponse = { success: false, error: 'no route to host' };
        const el = await mount();
        const r = record();

        el.querySelector('.db-update-btn').click();
        await settled();

        assert.deepEqual(r.seen, [
            { key: 'databaseUpdate', success: false, message: 'Failed!: no route to host' }
        ]);
        r.stop();
    });

    test('a thrown update still emits', async () => {
        const el = await mount();
        globalThis.browser.runtime.sendMessage = async () => { throw new Error('port closed'); };
        const r = record();

        el.querySelector('.db-update-btn').click();
        await settled();

        assert.deepEqual(r.seen, [{ key: 'databaseUpdate', success: false, message: 'Failed!' }]);
        r.stop();
    });

    test('the button is restored whatever happened', async () => {
        updateResponse = { success: false };
        const el = await mount();

        el.querySelector('.db-update-btn').click();
        await settled();

        const btn = el.querySelector('.db-update-btn');
        assert.equal(btn.disabled, false);
        assert.equal(btn.textContent, 'Update Database');
    });
});
