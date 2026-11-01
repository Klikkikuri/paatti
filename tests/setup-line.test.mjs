import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
const fake = createFakeBrowser();
const created = [];
fake.browser.tabs.create = async (props) => { created.push(props); };
globalThis.browser = fake.browser;
const { initSetupLine } = await import('../src/options/setup-line.js');
const { markWizardDone } = await import('../src/welcome-state.js');
after(() => dom.teardown());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function line() {
    document.body.innerHTML = `
        <div id="setup-line" class="setup-line hidden">
            <button data-mode="tour"></button><button data-mode="quick"></button><button data-hide></button>
        </div>`;
    return document.getElementById('setup-line');
}

beforeEach(async () => {
    await globalThis.browser.storage.sync.clear();
    created.length = 0;
});

describe('initSetupLine', () => {
    test('shows the offer on a new install', async () => {
        const el = line();
        await initSetupLine(el, () => {});
        assert.equal(el.classList.contains('hidden'), false);
    });

    test('stays hidden once the wizard is done', async () => {
        await markWizardDone();
        const el = line();
        await initSetupLine(el, () => {});
        assert.equal(el.classList.contains('hidden'), true);
    });

    test('Hide hides the offer for good, and does not finish the wizard', async () => {
        const el = line();
        await initSetupLine(el, () => {});
        el.querySelector('[data-hide]').click();
        await flush();

        assert.equal(el.classList.contains('hidden'), true);
        const again = line();
        await initSetupLine(again, () => {});
        assert.equal(again.classList.contains('hidden'), true);

        const { wizardDone } = await globalThis.browser.storage.sync.get('wizardDone');
        assert.equal(wizardDone, undefined);
    });

    for (const mode of ['tour', 'quick']) {
        test(`the ${mode} button opens the wizard in that mode and closes the popup`, async () => {
            const el = line();
            let closed = 0;
            await initSetupLine(el, () => { closed += 1; });
            el.querySelector(`[data-mode="${mode}"]`).click();
            await flush();

            assert.deepEqual(created.map((tab) => tab.url.split('?')[1]), [`mode=${mode}`]);
            assert.equal(closed, 1);
        });
    }
});
