import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
const created = [];
const updated = [];
let openTabs = [];
fake.browser.runtime.id = 'paatti-id';
fake.browser.tabs.query = async () => openTabs;
fake.browser.tabs.create = async (props) => { created.push(props); };
fake.browser.tabs.update = async (id, props) => { updated.push({ id, props }); };
globalThis.browser = fake.browser;

const {
    claimIntroCard, readWizardState, markWizardDone, hideWizardLine, wizardModeOf, openWizard, WIZARD_MODES
} = await import('../src/welcome-state.js');

beforeEach(async () => {
    await globalThis.browser.storage.sync.clear();
    created.length = 0;
    updated.length = 0;
    openTabs = [];
});

describe('claimIntroCard', () => {
    test('answers yes one time, even when many pages ask together', async () => {
        const answers = await Promise.all([claimIntroCard(), claimIntroCard(), claimIntroCard()]);
        assert.deepEqual(answers.toSorted(), [false, false, true]);
        assert.equal(await claimIntroCard(), false);
    });

    test('is not affected by a finished wizard', async () => {
        await markWizardDone();
        assert.equal(await claimIntroCard(), true);
    });
});

describe('wizard state', () => {
    test('starts open, and a claimed card does not finish it', async () => {
        await claimIntroCard();
        assert.deepEqual(await readWizardState(), { wizardDone: false, wizardLineHidden: false });
    });

    test('hiding the line does not finish the wizard', async () => {
        await hideWizardLine();
        assert.deepEqual(await readWizardState(), { wizardDone: false, wizardLineHidden: true });
    });

    test('finishing is remembered', async () => {
        await markWizardDone();
        assert.equal((await readWizardState()).wizardDone, true);
    });
});

describe('wizardModeOf', () => {
    const FROM_PAGE = { id: 'paatti-id', tab: { id: 4 } };

    const CASES = [
        ['quick from a content script', { action: 'openWizard', mode: 'quick' }, FROM_PAGE, 'quick'],
        ['tour from a content script', { action: 'openWizard', mode: 'tour' }, FROM_PAGE, 'tour'],
        ['an unknown mode', { action: 'openWizard', mode: 'evil' }, FROM_PAGE, null],
        ['no mode', { action: 'openWizard' }, FROM_PAGE, null],
        ['an extra url field, which is ignored', { action: 'openWizard', mode: 'quick', url: 'https://x.test' }, FROM_PAGE, 'quick'],
        ['another action', { action: 'other', mode: 'quick' }, FROM_PAGE, null],
        ['another extension', { action: 'openWizard', mode: 'quick' }, { id: 'other', tab: { id: 4 } }, null],
        ['a sender with no tab', { action: 'openWizard', mode: 'quick' }, { id: 'paatti-id' }, null],
        ['no message', undefined, FROM_PAGE, null],
    ];

    for (const [name, message, sender, expected] of CASES) {
        test(name, () => assert.equal(wizardModeOf(message, sender), expected));
    }

    test('names only the declared modes', () => assert.deepEqual([...WIZARD_MODES], ['quick', 'tour']));
});

describe('openWizard', () => {
    test('opens a tab with the mode in the address', async () => {
        await openWizard('tour');
        assert.deepEqual(created, [{ url: 'chrome-extension://fake/src/options/welcome/welcome.html?mode=tour' }]);
    });

    test('reuses a wizard tab that is open', async () => {
        openTabs = [{ id: 9, windowId: 2 }];
        await openWizard('quick');
        assert.deepEqual(created, []);
        assert.deepEqual(updated, [{
            id: 9,
            props: { url: 'chrome-extension://fake/src/options/welcome/welcome.html?mode=quick', active: true }
        }]);
    });
});
