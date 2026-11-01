import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser().browser;
const { siteStatusOf } = await import('../src/options/components/site-toggle.js');
after(() => dom.teardown());

describe('siteStatusOf', () => {
    const CASES = [
        ['on, with permission', true, true, 'siteStatusOn'],
        ['on, whatever the permission', true, false, 'siteStatusOn'],
        ['off, with permission', false, true, 'siteStatusOff'],
        ['off, and the browser has not granted it', false, false, 'siteStatusNeedsPermission'],
    ];

    for (const [name, enabled, hasPermission, key] of CASES) {
        test(name, () => assert.equal(siteStatusOf(enabled, hasPermission).key, key));
    }

    test('every state has English text for a missing translation', () => {
        for (const [enabled, hasPermission] of [[true, true], [false, true], [false, false]]) {
            assert.ok(siteStatusOf(enabled, hasPermission).fallback);
        }
    });
});
