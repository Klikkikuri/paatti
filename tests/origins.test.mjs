import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { originPatterns, missingOrigins } from '../src/options/origins.js';

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
    test('keeps scheme, host and path plus a wildcard, without the port or the query', () => {
        assert.deepEqual(originPatterns(['http://localhost:3000/data.json?v=2']), ['http://localhost/data.json*']);
    });

    test('deduplicates URLs that differ only by query, and keeps first-seen order', () => {
        assert.deepEqual(originPatterns([
            'http://b.test/data.json?x=1',
            'http://a.test/data.json',
            'http://b.test/data.json?x=2',
        ]), ['http://b.test/data.json*', 'http://a.test/data.json*']);
    });

    test('skips what is not an http(s) URL', () => {
        assert.deepEqual(originPatterns(['not a url', 'file:///tmp/data.json', 'ftp://x.test/a']), []);
        assert.deepEqual(originPatterns([]), []);
    });
});

describe('missingOrigins', () => {
    test('asks per pattern and drops a URL the browser already covers', async () => {
        const github = 'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json*';
        const { asked, contains } = fakeContains([github]);
        const missing = await missingOrigins([
            'https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json',
            'http://localhost:3000/data.json',
        ], contains);

        assert.deepEqual(asked, [github, 'http://localhost/data.json*']);
        assert.deepEqual(missing, ['http://localhost/data.json*']);
    });

    test('asks nothing for an empty list', async () => {
        const { asked, contains } = fakeContains();
        assert.deepEqual(await missingOrigins([], contains), []);
        assert.deepEqual(asked, []);
    });
});
