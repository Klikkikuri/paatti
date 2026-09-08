import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
const fake = createFakeBrowser({
    messages: {
        clickbaitLevelWarningTitle: 'Also replaces neutral headlines',
        clickbaitLevelWarningText: 'Paatti replaces them too.',
        clickbaitLevelWarningDismiss: 'Got it',
    },
});
globalThis.browser = fake.browser;

// Dynamic: the module builds its templates and calls customElements.define at evaluation,
// so a static import would be hoisted above installDom() and run with no document.
await import('../src/options/components/clickbait-level-vertical.js');

after(() => dom.teardown());

// Never fake.reset(): it clears onChanged.listeners, which drops the listener config.js
// registered at module evaluation, and every later republish would silently stop. clear() is
// the safe one -- it empties the area and dispatches onChanged the way a real write does.
beforeEach(async () => {
    document.body.replaceChildren();
    await globalThis.browser.storage.local.clear();
    await globalThis.browser.storage.sync.clear();
    await flush();
});

/** One turn drains config.js's publish chain: everything it awaits resolves as a microtask. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function storeLevel(clickbaitLevel) {
    await globalThis.browser.storage.local.set({ userPreferences: { clickbaitLevel } });
    await flush();
}

/** The acknowledgement is synced, not local, so it follows the person between devices. */
async function storeAcknowledged(seen) {
    await globalThis.browser.storage.sync.set({ clickbaitLevelWarningSeen: seen });
    await flush();
}

/** Attach one slider and wait out its first config callback. */
async function mount() {
    const el = document.createElement('clickbait-level-vertical');
    document.body.append(el);
    await flush();
    return el.querySelector('.level-warning');
}

describe('the "all headlines" warning follows the stored level and the acknowledgement', () => {
    test('stays hidden at the default level', async () => {
        await storeLevel(2);
        const warning = await mount();
        assert.ok(warning, 'expected the panel to be in the subtree');
        assert.ok(warning.classList.contains('hidden'));
    });

    test('shows at level 0 while unacknowledged', async () => {
        await storeLevel(0);
        const warning = await mount();
        assert.equal(warning.classList.contains('hidden'), false);
    });

    test('stays hidden at level 0 once acknowledged', async () => {
        await storeLevel(0);
        await storeAcknowledged(true);
        const warning = await mount();
        assert.ok(warning.classList.contains('hidden'));
    });

    test('goes away when the level moves off 0', async () => {
        await storeAcknowledged(false);
        await storeLevel(0);
        const warning = await mount();

        await storeLevel(2);
        assert.ok(warning.classList.contains('hidden'));
    });
});

describe('dismissing the warning', () => {
    test('stores the acknowledgement in sync storage and takes the panel away', async () => {
        await storeAcknowledged(false);
        await storeLevel(0);
        const warning = await mount();

        warning.querySelector('.level-warning-dismiss').click();
        await flush();

        const sync = await globalThis.browser.storage.sync.get('clickbaitLevelWarningSeen');
        assert.equal(sync.clickbaitLevelWarningSeen, true);

        const { userPreferences } = await globalThis.browser.storage.local.get('userPreferences');
        assert.equal(userPreferences.clickbaitLevel, 0, 'the level itself must be untouched');
        assert.ok(warning.classList.contains('hidden'));
    });

    test('carries the localized strings', async () => {
        await storeAcknowledged(false);
        await storeLevel(0);
        const warning = await mount();

        assert.equal(warning.querySelector('.level-warning-title').textContent, 'Also replaces neutral headlines');
        assert.equal(warning.querySelector('.level-warning-dismiss').textContent, 'Got it');
    });
});
