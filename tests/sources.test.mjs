import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { getConfig } = await import('../src/config.js');
const { model, signUrls } = await import('../src/model.js');
const { setProviderEnabled, removeProvider } = await import('../src/providers.js');

const DEFAULT = 'https://default.example/manifest.json';
const DEFAULT_B = 'https://default-b.example/manifest.json';
const PROVIDER = 'https://provider.example/manifest.json';
const PROVIDER_B = 'https://provider-b.example/manifest.json';
const SITE = 'news.example';
const LINK = `https://${SITE}/story`;
const UNCLAIMED_LINK = 'https://no-provider.example/story';

/** Stands in for Suola: a sign tells which rules made it. */
const hashUrl = (url, name) => (name ? `${name}|${url}` : `base|${url}`);
const named = (provider, url = LINK) => hashUrl(url, provider);
const base = (url = LINK) => hashUrl(url);

beforeEach(async () => {
    await fake.browser.storage.local.clear();
    await fake.browser.storage.sync.clear();
});

/** The active ("free") environment's default providers and shadowing setting. */
async function setEnvironment({ defaults = [DEFAULT], shadowing = false } = {}) {
    await fake.browser.storage.local.set({
        userPreferences: { environmentConfigs: { free: { defaultProviders: defaults, providerShadowingEnabled: shadowing } } }
    });
}

/**
 * Appends a provider to the sync list with its resolved data.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string[]} [options.origins] - The origins of its site `SITE`; no site when absent.
 * @param {object} [options.rahtiData]
 * @param {object|null} [options.suolaRules]
 */
async function seedProvider(url, { origins, rahtiData = {}, suolaRules = null } = {}) {
    const { providers = [] } = await fake.browser.storage.sync.get('providers');
    await fake.browser.storage.sync.set({ providers: [...providers, { url, enabled: true }] });
    const siteConfigs = origins ? { [SITE]: { name: SITE, enabled: true, origins, rules: [] } } : {};
    await fake.browser.storage.local.set({ [`provider:${url}`]: { siteConfigs, rahtiData, suolaRules } });
}

/** The user's own site toggle. */
async function turnOnSite() {
    await fake.browser.storage.sync.set({ userSiteOverrides: { [SITE]: { enabled: true } } });
}

/** Signs `href` as the background does, with every provider's named set active unless told otherwise. */
async function lookup(href = LINK, { activeNames } = {}) {
    const config = await getConfig();
    const signs = signUrls(config, [href], { hashUrl, activeNames: activeNames ?? new Set(config.enabledProviderUrls) });
    return { signs: signs[href], entry: (await model.read.getRahtiEntries(signs))[href] };
}

const sourcesOf = (signs) => signs.layers.map(({ source }) => source);

describe('the default providers', () => {
    test('answer for a host no provider covers, under the base sign', async () => {
        await setEnvironment();
        await seedProvider(DEFAULT, { rahtiData: { [base(UNCLAIMED_LINK)]: { title: 'Default' } } });

        const { signs, entry } = await lookup(UNCLAIMED_LINK);

        assert.deepEqual(signs, { layers: [{ source: DEFAULT, sign: base(UNCLAIMED_LINK) }], officialSign: base(UNCLAIMED_LINK) });
        assert.deepEqual(entry, { title: 'Default' });
    });

    test('sign a host the default claims under its named set, also when the site is off', async () => {
        await setEnvironment();
        await seedProvider(DEFAULT, { origins: [`https://${SITE}/*`], suolaRules: {}, rahtiData: { [named(DEFAULT)]: { title: 'Default' } } });

        const { signs, entry } = await lookup();

        assert.deepEqual(signs, { layers: [{ source: DEFAULT, sign: named(DEFAULT) }], officialSign: named(DEFAULT) });
        assert.deepEqual(entry, { title: 'Default' });
    });

    test('whose Suola rules were refused give the base sign as the official one', async () => {
        await setEnvironment();
        await seedProvider(DEFAULT, { origins: [`https://${SITE}/*`], suolaRules: {} });

        const { signs } = await lookup(LINK, { activeNames: new Set() });

        assert.deepEqual(signs, { layers: [{ source: DEFAULT, sign: null }], officialSign: base() });
    });

    test('merge with a later default winning on a colliding sign', async () => {
        await setEnvironment({ defaults: [DEFAULT, DEFAULT_B] });
        await seedProvider(DEFAULT, { rahtiData: { [base()]: { title: 'From A' } } });
        await seedProvider(DEFAULT_B, { rahtiData: { [base()]: { title: 'From B' } } });

        assert.deepEqual((await lookup()).entry, { title: 'From B' });
    });

    for (const [name, disable] of [['disabling', (url) => setProviderEnabled(url, false)], ['removing', removeProvider]]) {
        test(`${name} the default makes its entries unavailable`, async () => {
            await setEnvironment();
            await seedProvider(DEFAULT, { rahtiData: { [base()]: { title: 'Default' } } });
            assert.deepEqual((await lookup()).entry, { title: 'Default' });

            await disable(DEFAULT);

            assert.equal((await lookup()).entry, null);
        });
    }

    test('none configured gives null, and the base sign as the official one', async () => {
        await setEnvironment({ defaults: [] });

        const { signs, entry } = await lookup();

        assert.deepEqual(signs, { layers: [], officialSign: base() });
        assert.equal(entry, null);
    });
});

describe('a third-party provider site', () => {
    const OWN = [`https://${SITE}/*`];

    test('that the user left off has no layer, so the default answers', async () => {
        await setEnvironment({ shadowing: true });
        await seedProvider(DEFAULT, { rahtiData: { [base()]: { title: 'Default' } } });
        await seedProvider(PROVIDER, { origins: OWN, suolaRules: {}, rahtiData: { [named(PROVIDER)]: { title: 'Provider' } } });

        const { signs, entry } = await lookup();

        assert.deepEqual(sourcesOf(signs), [DEFAULT]);
        assert.deepEqual(entry, { title: 'Default' });
    });

    const precedence = [
        { shadowing: true, provider: 'Provider', official: 'Default', expected: 'Provider', order: [PROVIDER, DEFAULT] },
        { shadowing: true, provider: null, official: 'Default', expected: 'Default', order: [PROVIDER, DEFAULT] },
        { shadowing: false, provider: 'Provider', official: 'Default', expected: 'Default', order: [DEFAULT, PROVIDER] },
        { shadowing: false, provider: 'Provider', official: null, expected: 'Provider', order: [DEFAULT, PROVIDER] },
    ];
    for (const { shadowing, provider, official, expected, order } of precedence) {
        test(`that is on, shadowing ${shadowing ? 'on' : 'off'}, provider ${provider ? 'hit' : 'miss'}, default ${official ? 'hit' : 'miss'} → ${expected}`, async () => {
            await setEnvironment({ shadowing });
            await seedProvider(DEFAULT, { rahtiData: official ? { [base()]: { title: official } } : {} });
            await seedProvider(PROVIDER, { origins: OWN, suolaRules: {}, rahtiData: provider ? { [named(PROVIDER)]: { title: provider } } : {} });
            await turnOnSite();

            const { signs, entry } = await lookup();

            assert.deepEqual(sourcesOf(signs), order);
            assert.equal(signs.officialSign, base());
            assert.deepEqual(entry, { title: expected });
        });
    }

    test('signs under the base rules when its provider has no Suola rules', async () => {
        await setEnvironment({ shadowing: true });
        await seedProvider(DEFAULT);
        await seedProvider(PROVIDER, { origins: OWN, rahtiData: { [base()]: { title: 'Provider' } } });
        await turnOnSite();

        const { signs, entry } = await lookup(LINK, { activeNames: new Set() });

        assert.deepEqual(signs.layers, [{ source: PROVIDER, sign: base() }, { source: DEFAULT, sign: base() }]);
        assert.deepEqual(entry, { title: 'Provider' });
    });

    test('whose Suola rules were refused is skipped, not signed under the base rules', async () => {
        await setEnvironment({ shadowing: true });
        await seedProvider(DEFAULT, { rahtiData: { [base()]: { title: 'Default' } } });
        await seedProvider(PROVIDER, { origins: OWN, suolaRules: {}, rahtiData: { [base()]: { title: 'Provider' } } });
        await turnOnSite();

        const { signs, entry } = await lookup(LINK, { activeNames: new Set([DEFAULT]) });

        assert.deepEqual(signs.layers[0], { source: PROVIDER, sign: null });
        assert.deepEqual(entry, { title: 'Default' });
    });

    test('shadowed by a later provider is the next layer down', async () => {
        await setEnvironment({ shadowing: true });
        await seedProvider(DEFAULT, { rahtiData: { [base()]: { title: 'Default' } } });
        await seedProvider(PROVIDER, { origins: OWN, suolaRules: {}, rahtiData: { [named(PROVIDER)]: { title: 'Earlier' } } });
        await seedProvider(PROVIDER_B, { origins: OWN, suolaRules: {}, rahtiData: {} });
        await turnOnSite();

        const { signs, entry } = await lookup();

        assert.deepEqual(sourcesOf(signs), [PROVIDER_B, PROVIDER, DEFAULT]);
        assert.deepEqual(entry, { title: 'Earlier' });
    });

    test('shadowed by a later provider has no layer for a host only the later one covers', async () => {
        const mobileLink = `https://m.${SITE}/story`;
        await setEnvironment({ shadowing: true });
        await seedProvider(DEFAULT);
        await seedProvider(PROVIDER, { origins: OWN, suolaRules: {} });
        await seedProvider(PROVIDER_B, { origins: [...OWN, `https://m.${SITE}/*`], suolaRules: {} });
        await turnOnSite();

        assert.deepEqual(sourcesOf((await lookup(mobileLink)).signs), [PROVIDER_B, DEFAULT]);
    });
});

describe('signUrls', () => {
    test('makes the base sign once for each URL', async () => {
        await setEnvironment({ defaults: [DEFAULT, DEFAULT_B], shadowing: true });
        await seedProvider(DEFAULT);
        await seedProvider(DEFAULT_B);
        await seedProvider(PROVIDER, { origins: [`https://${SITE}/*`] });
        await turnOnSite();
        const calls = [];

        signUrls(await getConfig(), [LINK, UNCLAIMED_LINK], {
            hashUrl: (...args) => { calls.push(args); return hashUrl(...args); }, activeNames: new Set()
        });

        assert.deepEqual(calls, [[LINK], [UNCLAIMED_LINK]]);
    });

    test('gives null for a URL it cannot parse', async () => {
        await setEnvironment();

        assert.deepEqual(signUrls(await getConfig(), ['not a url'], { hashUrl, activeNames: new Set() }), { 'not a url': null });
    });
});

test('getRahtiEntries reads no storage after the config is loaded', async () => {
    await setEnvironment();
    await seedProvider(DEFAULT, { rahtiData: { [base()]: { title: 'Default' } } });
    const config = await getConfig();
    const signs = signUrls(config, [LINK, UNCLAIMED_LINK], { hashUrl, activeNames: new Set() });
    const reads = fake.reads.local;

    const entries = await model.read.getRahtiEntries(signs);

    assert.equal(fake.reads.local, reads);
    assert.deepEqual(entries, { [LINK]: { title: 'Default' }, [UNCLAIMED_LINK]: null });
});
