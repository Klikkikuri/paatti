import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.browser = {};
const { captureTarget, capturePageLinks, CAPTURE_REL, GENERIC_CAPTURE_RULE } = await import('../src/options/capture-target.js');

// The gate that keeps the devmode capture dormant in a store install, read from the source: the behaviour
// tests above cover the gate only as it is, not as later edits could leave it.
const GATE = {
    developmentEnv: /config\.activeEnv !== "development"/,
    loopbackProviders: /config\.loopbackProvidersEnabled/,
};
const CAPTURE_TARGET_SOURCE = readFileSync(new URL('../src/options/capture-target.js', import.meta.url), 'utf8');

const LOCAL = 'http://localhost:3000/manifest/ilta-pulu/manifest.json';
const CAPTURE = 'http://localhost:3000/api/capture';
const RAHTI = 'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/manifest.json';

const config = ({ env = 'development', loopback = true, urls = [LOCAL], links = { [LOCAL]: [{ rel: CAPTURE_REL, href: CAPTURE }] } } = {}) => ({
    activeEnv: env,
    loopbackProvidersEnabled: loopback,
    enabledProviderUrls: urls,
    providerData: Object.fromEntries(urls.map((url) => [url, { links: links[url] || [] }]))
});

test('captureTarget keeps its gate in the source: the development environment and loopback providers', () => {
    for (const [name, pattern] of Object.entries(GATE)) {
        assert.match(CAPTURE_TARGET_SOURCE, pattern, `the ${name} condition is missing from capture-target.js`);
    }
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

const PAGE_URL = 'https://example.org/news/';
const anchor = (href, textContent) => ({ href, textContent });
const PAGE_LINKS = [
    anchor('https://example.org/story/1', ' Story one \n'),
    anchor('http://other.example/a', 'Other'),
    anchor('javascript:void(0)', 'Menu'),
    anchor('mailto:news@example.org', 'Mail'),
    anchor('https://example.org/story/2', ' \n '),
];
const CARD_LINK = anchor('https://example.org/story/3', 'Image only');
const CARD = {
    querySelectorAll: (selector) => (selector === 'a.card-link' ? [CARD_LINK] : []),
    querySelector: (selector) => (selector === 'h2' ? { textContent: ' Card headline ' } : null),
};
const PAGE = { 'a[href]': PAGE_LINKS, 'div.card': [CARD] };
const CARD_RULE = { container: 'div.card', link: 'a.card-link', title: 'h2' };

const SCAN_CASES = [
    ['the generic rule keeps the http(s) links with text, in page order', [GENERIC_CAPTURE_RULE], [
        { href: 'https://example.org/story/1', title: 'Story one' },
        { href: 'http://other.example/a', title: 'Other' },
    ]],
    ['a site rule takes the link and the title from the container', [CARD_RULE], [
        { href: 'https://example.org/story/3', title: 'Card headline' },
    ]],
    ['a container that the page does not have gives no link', [{ container: 'nav', link: 'self', title: 'self' }], []],
];

for (const [name, rules, links] of SCAN_CASES) {
    test(`capturePageLinks: ${name}`, () => {
        globalThis.window = { location: { href: PAGE_URL } };
        globalThis.document = { querySelectorAll: (selector) => PAGE[selector] || [] };
        try {
            assert.deepEqual(capturePageLinks(rules), { pageUrl: PAGE_URL, rules, links });
        } finally {
            delete globalThis.window;
            delete globalThis.document;
        }
    });
}
