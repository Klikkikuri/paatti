import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { mergeManifest, storeManifest, buildManifest } = await import('../tools/manifest.mjs');
const { ARBITRARY_ORIGINS } = await import('../src/options/origins.js');

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

describe('mergeManifest', () => {
    test('overrides, recurses into objects, deletes on null, replaces arrays, leaves the base alone', () => {
        const before = { a: 1, nested: { keep: true, drop: 1, deep: { x: 1 } }, list: [1, 2, 3] };
        const snapshot = structuredClone(before);
        const merged = mergeManifest(before, {
            a: 2,
            nested: { drop: null, deep: { y: 2 } },
            list: [9],
            added: 'yes',
        });

        assert.deepEqual(merged, { a: 2, nested: { keep: true, deep: { x: 1, y: 2 } }, list: [9], added: 'yes' });
        assert.deepEqual(before, snapshot);
    });
});

describe('storeManifest', () => {
    test('adds the revision to the fourth version component, present or not', () => {
        assert.equal(storeManifest({ version: '1.2.3' }, '1').version, '1.2.3.1');
        assert.equal(storeManifest({ version: '1.2.3.1' }, '1').version, '1.2.3.2');
        assert.equal(storeManifest({ version: '1.2.3.1' }, '2').version, '1.2.3.3');
        assert.equal(storeManifest({ version: '1.2' }, '1').version, '1.2.0.1');
    });

    test('drops update_url, on a tree with and without a gecko block', () => {
        const firefox = storeManifest(base, '1');
        assert.equal(firefox.browser_specific_settings.gecko.update_url, undefined);
        assert.equal(firefox.browser_specific_settings.gecko.id, base.browser_specific_settings.gecko.id);
        assert.notEqual(base.browser_specific_settings.gecko.update_url, undefined);

        assert.deepEqual(storeManifest({ version: '1.2.3' }, '1'), { version: '1.2.3.1' });
    });

    test('drops the wildcard origin and keeps the named optional origins', () => {
        for (const browser of ['chrome', 'firefox']) {
            const store = storeManifest(buildManifest(browser), '1');
            assert.ok(!store.optional_host_permissions.includes(ARBITRARY_ORIGINS));
            assert.ok(store.optional_host_permissions.includes('https://www.ampparit.com/*'));
        }
    });

    test('drops the wildcard web_accessible_resources group but keeps the named one', () => {
        for (const browser of ['chrome', 'firefox']) {
            const store = storeManifest(buildManifest(browser), '1');
            assert.equal(store.web_accessible_resources.length, 1);
            assert.ok(!store.web_accessible_resources[0].matches.includes(ARBITRARY_ORIGINS));
            assert.ok(store.web_accessible_resources[0].matches.includes('https://www.hs.fi/*'));
        }
    });

    test('rejects a revision that is not a number above zero, and a version with more than four parts', () => {
        for (const bad of ['x', '', '0', '01']) {
            assert.throws(() => storeManifest({ version: '1.2.3' }, bad), /not a number above zero/);
        }
        assert.throws(() => storeManifest({ version: '1.2.3.4.5' }, '1'), /more than four/);
    });
});

describe('the real overlays', () => {
    test('chrome carries no Firefox-only keys', () => {
        const chrome = buildManifest('chrome');
        assert.equal(chrome.browser_specific_settings, undefined);
        assert.equal(chrome.background.scripts, undefined);
        assert.equal(chrome.background.service_worker, base.background.service_worker);
        assert.equal(chrome.action.default_area, undefined);
        assert.equal(chrome.minimum_chrome_version, base.minimum_chrome_version);
    });

    test('firefox carries no Chrome-only keys and keeps the self-hosting keys', () => {
        const firefox = buildManifest('firefox');
        assert.equal(firefox.minimum_chrome_version, undefined);
        assert.equal(firefox.background.service_worker, undefined);
        assert.deepEqual(firefox.background.scripts, base.background.scripts);
        assert.deepEqual(firefox.browser_specific_settings.gecko_android, {});
        const gecko = base.browser_specific_settings.gecko;
        assert.equal(firefox.browser_specific_settings.gecko.update_url, gecko.update_url);
    });

    test('both keep what the extension needs at runtime', () => {
        assert.ok(base.optional_host_permissions.includes(ARBITRARY_ORIGINS));
        for (const browser of ['chrome', 'firefox']) {
            const merged = buildManifest(browser);
            assert.equal(merged.version, base.version);
            assert.deepEqual(merged.permissions, base.permissions);
            assert.deepEqual(merged.host_permissions, base.host_permissions);
            assert.deepEqual(merged.optional_host_permissions, base.optional_host_permissions);
            assert.deepEqual(merged.web_accessible_resources, base.web_accessible_resources);
        }
    });

    test('a missing overlay names the file', () => {
        assert.throws(() => buildManifest('opera'), /manifest\.opera\.json/);
    });
});

describe('the wildcard web_accessible_resources group', () => {
    // Not needed by a runtime-added site's content script: the wasm module is fetched by the
    // background page alone, and nothing under src/ references the icon via runtime.getURL().
    const NOT_NEEDED_AT_RUNTIME = new Set(['build/js.wasm', 'icons/klikkikuri-48.png']);

    const [named, wildcard] = base.web_accessible_resources;

    test('matches only the wildcard host pattern, distinct from the named group', () => {
        assert.deepEqual(wildcard.matches, [ARBITRARY_ORIGINS]);
        assert.ok(!named.matches.includes(ARBITRARY_ORIGINS));
    });

    test('carries exactly the named group\'s resources minus what only the background page needs', () => {
        const expected = named.resources.filter((resource) => !NOT_NEEDED_AT_RUNTIME.has(resource));
        assert.deepEqual(wildcard.resources, expected);
    });

    test('never carries build/js.wasm: a provider site has no business loading the wasm module directly', () => {
        assert.ok(!wildcard.resources.includes('build/js.wasm'));
    });
});
