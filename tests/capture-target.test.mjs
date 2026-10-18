import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.browser = {};
const { captureTarget, CAPTURE_REL } = await import('../src/options/capture-target.js');

const LOCAL = 'http://localhost:3000/manifest/captured-sites/manifest.json';
const CAPTURE = 'http://localhost:3000/api/capture';
const RAHTI = 'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/manifest.json';
const SITE = 'www.iltalehti.fi';
const CAPTURE_LINK = [{ rel: CAPTURE_REL, href: CAPTURE }];

const config = ({
    env = 'development', loopback = true, urls = [RAHTI, LOCAL], links = { [LOCAL]: CAPTURE_LINK },
    sources = { [SITE]: [LOCAL, RAHTI] }
} = {}) => ({
    activeEnv: env,
    loopbackProvidersEnabled: loopback,
    enabledProviderUrls: urls,
    providerData: Object.fromEntries(urls.map((url) => [url, { links: links[url] || [] }])),
    siteConfigSources: Object.fromEntries(Object.entries(sources).map(([site, list]) => [site, list.map((url) => ({ url }))]))
});

const FOUND = { providerUrl: LOCAL, captureUrl: CAPTURE };
const CASES = [
    ['a loopback provider that supplies the site', config(), SITE, FOUND],
    ['a site that the provider does not supply', config(), 'localhost', null],
    ['with "Allow providers to override sites" off, where only Rahti supplies the site',
        config({ sources: { [SITE]: [RAHTI] } }), SITE, null],
    ['a page on no site', config(), null, null],
    ['outside the development environment', config({ env: 'free' }), SITE, null],
    ['with loopback providers off', config({ loopback: false }), SITE, null],
    ['a remote provider with a capture link', config({ links: { [RAHTI]: CAPTURE_LINK } }), SITE, null],
    ['a capture link to a remote host',
        config({ links: { [LOCAL]: [{ rel: CAPTURE_REL, href: 'https://collector.example/api/capture' }] } }), SITE, null],
    ['a provider with no capture link', config({ links: { [LOCAL]: [{ rel: 'privacy-policy', href: CAPTURE }] } }), SITE, null],
    ['a malformed capture link', config({ links: { [LOCAL]: [{ rel: CAPTURE_REL, href: 'not a url' }] } }), SITE, null],
];

for (const [name, input, domain, expected] of CASES) {
    test(`captureTarget: ${name}`, () => {
        assert.deepEqual(captureTarget(input, domain), expected);
    });
}
