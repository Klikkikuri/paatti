import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const { siteLinks } = await import('../src/options/site-links.js');

const messages = { sitePolicyLinkText: "Publisher's policy" };
const getMessage = (key) => messages[key] || '';

describe('siteLinks', () => {
    test('labels a known rel from the translations', () => {
        const links = [{ rel: 'x-publisher-policy', href: 'https://www.hs.fi/info/' }];
        assert.deepEqual(siteLinks(links, 'en', getMessage), [{ href: 'https://www.hs.fi/info/', label: "Publisher's policy" }]);
    });

    test('labels an unknown rel with its title, and leaves it out without one', () => {
        const links = [
            { rel: 'x-other', href: 'https://example.fi/a', title: 'Other' },
            { rel: 'x-untitled', href: 'https://example.fi/b' },
        ];
        assert.deepEqual(siteLinks(links, 'en', getMessage), [{ href: 'https://example.fi/a', label: 'Other' }]);
    });

    test('of the links with one rel, prefers the UI language, else the first', () => {
        const links = [
            { rel: 'x-publisher-policy', href: 'https://example.fi/en', hreflang: 'en' },
            { rel: 'x-publisher-policy', href: 'https://example.fi/fi', hreflang: 'fi' },
        ];
        assert.equal(siteLinks(links, 'fi-FI', getMessage)[0].href, 'https://example.fi/fi');
        assert.equal(siteLinks(links, 'sv', getMessage)[0].href, 'https://example.fi/en');
        assert.equal(siteLinks(links, 'fi', getMessage).length, 1);
    });

    test('drops a link that is not http(s)', () => {
        const links = [{ rel: 'x-publisher-policy', href: 'javascript:alert(1)' }];
        assert.deepEqual(siteLinks(links, 'en', getMessage), []);
        assert.deepEqual(siteLinks(undefined, 'en', getMessage), []);
    });
});
