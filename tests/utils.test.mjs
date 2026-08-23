import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

// One stable namespace object, as at runtime: the cases below swap `tabs.query`, they do not
// replace globalThis.browser -- browser-api.js resolves it once, at the import below.
const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const { parseSemVer, sanitizeUrlForFeedback, canAppendSpan, getActiveTab, getCurrentTabHostname } =
    await import('../src/utils.js');

describe('sanitizeUrlForFeedback', () => {
    const cases = [
        {
            name: 'strips utm_*, fbclid, ref and session parameters while preserving content parameters',
            input: 'https://example.com/article?utm_source=twitter&utm_medium=social&id=123&fbclid=abc1234&ref=homepage&sid=sess99',
            expected: 'https://example.com/article?id=123'
        },
        {
            name: 'leaves URLs without tracking parameters untouched',
            input: 'https://example.com/search?q=news&page=2',
            expected: 'https://example.com/search?q=news&page=2'
        },
        {
            name: 'handles empty or invalid URL strings gracefully',
            input: 'not-a-valid-url',
            expected: 'not-a-valid-url'
        }
    ];

    for (const { name, input, expected } of cases) {
        test(name, () => assert.equal(sanitizeUrlForFeedback(input), expected));
    }
});

describe('parseSemVer', () => {
    const cases = [
        {
            name: 'parses a 4-part version into major, minor and patch',
            input: '0.1.2.3',
            expected: { major: 0, minor: 1, patch: 2 }
        },
        { name: 'parses a standard 3-part version', input: '1.2.3', expected: { major: 1, minor: 2, patch: 3 } },
        {
            name: 'parses a 2-part version with a default patch level',
            input: '1.2',
            expected: { major: 1, minor: 2, patch: 0 }
        },
        { name: 'returns null for a non-numeric version', input: 'invalid', expected: null },
        { name: 'returns null for empty or non-string input', input: null, expected: null }
    ];

    for (const { name, input, expected } of cases) {
        test(name, () => assert.deepEqual(parseSemVer(input), expected));
    }
});

describe('canAppendSpan', () => {
    const html = 'http://www.w3.org/1999/xhtml';
    const cases = [
        {
            name: 'returns true for a valid HTML element with replaceChildren',
            input: { nodeType: 1, tagName: 'H2', namespaceURI: html, replaceChildren: () => {} },
            expected: true
        },
        {
            name: 'returns false for an SVG element',
            input: { nodeType: 1, tagName: 'text', namespaceURI: 'http://www.w3.org/2000/svg', replaceChildren: () => {} },
            expected: false
        },
        {
            name: 'returns false for an INPUT element',
            input: { nodeType: 1, tagName: 'INPUT', namespaceURI: html, replaceChildren: () => {} },
            expected: false
        },
        {
            name: 'returns false for a non-element node',
            input: { nodeType: 3, tagName: '#text' },
            expected: false
        }
    ];

    for (const { name, input, expected } of cases) {
        test(name, () => assert.equal(canAppendSpan(input), expected));
    }
});

describe('getActiveTab and getCurrentTabHostname', () => {
    test('reads the tab from a currentWindow query', async () => {
        fake.browser.tabs.query = async (queryInfo) => (queryInfo.currentWindow
            ? [{ id: 1, url: 'https://www.hs.fi/kotimaa/art-12345.html' }]
            : [{ id: 2, url: 'https://other.fi' }]);

        assert.equal((await getActiveTab())?.id, 1);
        assert.equal(await getCurrentTabHostname(), 'www.hs.fi');
    });

    test('falls back to an active query when currentWindow is empty (Firefox Android)', async () => {
        fake.browser.tabs.query = async (queryInfo) => {
            if (queryInfo.currentWindow) return [];
            return queryInfo.active ? [{ id: 42, url: 'https://yle.fi/uutiset/18-1234' }] : [];
        };

        assert.equal((await getActiveTab())?.id, 42);
        assert.equal(await getCurrentTabHostname(), 'yle.fi');
    });

    test('returns a null hostname when the tab lacks a URL', async () => {
        fake.browser.tabs.query = async () => [{ id: 99 }];

        assert.equal(await getCurrentTabHostname(), null);
    });

    test('returns null for both when no tabs match', async () => {
        fake.browser.tabs.query = async () => [];

        assert.equal(await getActiveTab(), null);
        assert.equal(await getCurrentTabHostname(), null);
    });
});
