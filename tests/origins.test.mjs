import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { originPatterns, missingOrigins, canRequestOrigins } from '../src/options/origins.js';

/** A `contains` that records what it was asked and answers from `covered`. */
function fakeContains(covered = []) {
    const asked = [];
    const contains = async (pattern) => {
        asked.push(pattern);
        return covered.includes(pattern);
    };
    return { asked, contains };
}

describe('originPatterns', () => {
    test('covers the whole host, dropping the path, the port and the query', () => {
        // Not a narrowing that was lost: a host permission ignores the path, so the pattern now says what
        // the browser actually grants and what the missing-permission warning shows.
        assert.deepEqual(originPatterns(['http://localhost:3000/data.json?v=2']), ['http://localhost/*']);
    });

    test('deduplicates URLs on one host that differ by path or query, and keeps first-seen order', () => {
        assert.deepEqual(originPatterns([
            'http://b.test/data.json?x=1',
            'http://a.test/data.json',
            'http://b.test/other.json?x=2',
        ]), ['http://b.test/*', 'http://a.test/*']);
    });

    test('separates hosts that differ only by subdomain', () => {
        assert.deepEqual(originPatterns([
            'https://raw.githubusercontent.com/o/r/data.json',
            'https://githubusercontent.com/o/r/data.json',
        ]), ['https://raw.githubusercontent.com/*', 'https://githubusercontent.com/*']);
    });

    test('skips what is not an http(s) URL', () => {
        assert.deepEqual(originPatterns(['not a url', 'file:///tmp/data.json', 'ftp://x.test/a']), []);
        assert.deepEqual(originPatterns([]), []);
    });
});

describe('missingOrigins', () => {
    test('asks per pattern and drops a URL the browser already covers', async () => {
        const github = 'https://raw.githubusercontent.com/*';
        const { asked, contains } = fakeContains([github]);
        const missing = await missingOrigins([
            'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json',
            'http://localhost:3000/data.json',
        ], contains);

        assert.deepEqual(asked, [github, 'http://localhost/*']);
        assert.deepEqual(missing, ['http://localhost/*']);
    });

    test('asks nothing for an empty list', async () => {
        const { asked, contains } = fakeContains();
        assert.deepEqual(await missingOrigins([], contains), []);
        assert.deepEqual(asked, []);
    });
});

describe('canRequestOrigins', () => {
    const store = {
        host_permissions: ['https://raw.githubusercontent.com/Klikkikuri/rahti/*', 'https://www.hs.fi/*'],
        optional_host_permissions: ['https://www.ampparit.com/*'],
    };

    test('a declared origin can be requested, required or optional', () => {
        assert.equal(canRequestOrigins(['https://www.hs.fi/*'], store), true);
        assert.equal(canRequestOrigins(['https://www.ampparit.com/*'], store), true);
    });

    test('an origin the manifest does not declare cannot, and one undeclared origin is enough', () => {
        assert.equal(canRequestOrigins(['https://new.example.fi/*'], store), false);
        assert.equal(canRequestOrigins(['https://www.hs.fi/*', 'https://hs.fi/*'], store), false);
    });

    test('the wildcard and <all_urls> cover any http(s) origin', () => {
        for (const pattern of ['*://*/*', '<all_urls>']) {
            assert.equal(canRequestOrigins(['https://new.example.fi/*', 'http://other.example/*'], { optional_host_permissions: [pattern] }), true);
        }
    });

    test('compares the scheme and the host, honours a *. host, and ignores the path', () => {
        assert.equal(canRequestOrigins(['http://www.hs.fi/*'], store), false);
        assert.equal(canRequestOrigins(['https://raw.githubusercontent.com/*'], store), true);
        const sub = { host_permissions: ['https://*.example.fi/*'] };
        assert.equal(canRequestOrigins(['https://example.fi/*', 'https://www.example.fi/*'], sub), true);
        assert.equal(canRequestOrigins(['https://badexample.fi/*'], sub), false);
    });

    test('a manifest without permission lists can request nothing', () => {
        assert.equal(canRequestOrigins(['https://www.hs.fi/*'], {}), false);
    });
});
