import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getFaviconKey,
    makeFaviconEntry,
    isFaviconExpired,
    FAVICON_TTL_MS,
    FAVICON_NEGATIVE_TTL_MS
} from '../src/faviconCache.js';

const dataUri = 'data:image/png;base64,iVBORw0KGgo=';

test('getFaviconKey returns correct domain key', () => {
    assert.equal(getFaviconKey('www.iltalehti.fi'), 'favicon_www.iltalehti.fi');
});

test('makeFaviconEntry creates valid envelope for positive data', () => {
    const entry = makeFaviconEntry(dataUri);
    assert.equal(entry.v, 1);
    assert.equal(entry.data, dataUri);
    assert.equal(typeof entry.cachedAt, 'number');
});

test('makeFaviconEntry creates valid envelope for negative data', () => {
    const entry = makeFaviconEntry(null);
    assert.equal(entry.v, 1);
    assert.equal(entry.data, null);
    assert.equal(typeof entry.cachedAt, 'number');
});

test('fresh positive entry is not expired', () => {
    assert.equal(isFaviconExpired(makeFaviconEntry(dataUri)), false);
});

test('expired positive entry is detected as expired', () => {
    const entry = { v: 1, data: dataUri, cachedAt: Date.now() - (FAVICON_TTL_MS + 1000) };
    assert.equal(isFaviconExpired(entry), true);
});

test('fresh negative entry is not expired', () => {
    assert.equal(isFaviconExpired(makeFaviconEntry(null)), false);
});

test('expired negative entry is detected as expired', () => {
    const entry = { v: 1, data: null, cachedAt: Date.now() - (FAVICON_NEGATIVE_TTL_MS + 1000) };
    assert.equal(isFaviconExpired(entry), true);
});

test('malformed and old schema entries are treated as expired', () => {
    assert.equal(isFaviconExpired(null), true, 'null');
    assert.equal(isFaviconExpired('data:image/png;base64,abc'), true, 'raw string');
    assert.equal(isFaviconExpired({ v: 2, data: dataUri, cachedAt: Date.now() }), true, 'wrong version');
    assert.equal(isFaviconExpired({ v: 1, data: dataUri }), true, 'missing cachedAt');
});
