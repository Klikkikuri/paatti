import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.browser = {};
const { captureTarget, CAPTURE_REL } = await import('../src/options/capture-target.js');

const LOCAL = 'http://localhost:3000/manifest/ilta-pulu/manifest.json';
const CAPTURE = 'http://localhost:3000/api/capture';
const RAHTI = 'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/manifest.json';

const config = ({ env = 'development', loopback = true, urls = [LOCAL], links = { [LOCAL]: [{ rel: CAPTURE_REL, href: CAPTURE }] } } = {}) => ({
    activeEnv: env,
    loopbackProvidersEnabled: loopback,
    enabledProviderUrls: urls,
    providerData: Object.fromEntries(urls.map((url) => [url, { links: links[url] || [] }]))
});

const CASES = [
    ['a loopback provider with a loopback capture link', config(), { providerUrl: LOCAL, captureUrl: CAPTURE }],
    ['outside the development environment', config({ env: 'free' }), null],
    ['with loopback providers off', config({ loopback: false }), null],
    ['with no provider', config({ urls: [] }), null],
    ['a remote provider with a capture link', config({ urls: [RAHTI], links: { [RAHTI]: [{ rel: CAPTURE_REL, href: CAPTURE }] } }), null],
    ['a loopback provider whose capture link is remote',
        config({ links: { [LOCAL]: [{ rel: CAPTURE_REL, href: 'https://collector.example/api/capture' }] } }), null],
    ['a loopback provider with no capture link', config({ links: { [LOCAL]: [{ rel: 'privacy-policy', href: CAPTURE }] } }), null],
    ['a malformed capture link', config({ links: { [LOCAL]: [{ rel: CAPTURE_REL, href: 'not a url' }] } }), null],
    ['the first suitable provider in list order',
        config({ urls: [RAHTI, LOCAL], links: { [RAHTI]: [], [LOCAL]: [{ rel: CAPTURE_REL, href: CAPTURE }] } }),
        { providerUrl: LOCAL, captureUrl: CAPTURE }],
];

for (const [name, input, expected] of CASES) {
    test(`captureTarget: ${name}`, () => {
        assert.deepEqual(captureTarget(input), expected);
    });
}
