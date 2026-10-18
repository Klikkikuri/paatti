import test, { describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
const fake = createFakeBrowser();
globalThis.browser = fake.browser;

await import('../src/options/components/site-list-setting.js');

after(() => dom.teardown());

const DEFAULT = 'https://default.example/manifest.json';
const SITE = 'news.example';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Stores the default provider's one site with these origins. */
async function seedSite(origins) {
    await fake.browser.storage.local.set({ [`provider:${DEFAULT}`]: {
        siteConfigs: { [SITE]: { name: SITE, enabled: true, origins, rules: [] } }
    } });
    await settled();
}

const row = (list) => list.querySelector(`site-toggle-setting[domain="${SITE}"]`);

beforeEach(async () => {
    await fake.browser.storage.local.clear();
    await fake.browser.storage.sync.clear();
    await fake.browser.storage.local.set({
        userPreferences: { environmentConfigs: { free: { defaultProviders: [DEFAULT] } } }
    });
    await fake.browser.storage.sync.set({ providers: [{ url: DEFAULT, enabled: true }] });
    document.body.replaceChildren();
});

describe('site-list-setting', () => {
    test('renders the row again when a provider changes the origins of a site', async () => {
        await seedSite([`https://${SITE}/*`]);
        const list = document.createElement('site-list-setting');
        document.body.append(list);
        await settled();

        await seedSite([`https://${SITE}/*`, `https://m.${SITE}/*`]);

        assert.deepEqual(JSON.parse(row(list).getAttribute('origins')), [`https://${SITE}/*`, `https://m.${SITE}/*`]);
        list.remove();
    });

    test('keeps the row when the user turns the site off', async () => {
        await seedSite([`https://${SITE}/*`]);
        const list = document.createElement('site-list-setting');
        document.body.append(list);
        await settled();
        const before = row(list);

        await fake.browser.storage.sync.set({ userSiteOverrides: { [SITE]: { enabled: false } } });
        await settled();

        assert.equal(row(list), before);
        list.remove();
    });
});
