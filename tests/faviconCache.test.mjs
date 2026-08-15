import {
    getFaviconKey,
    makeFaviconEntry,
    isFaviconExpired,
    FAVICON_TTL_MS,
    FAVICON_NEGATIVE_TTL_MS
} from '../src/faviconCache.js';

/**
 * Runs unit tests for faviconCache module.
 */
function runFaviconCacheTests() {
    console.log('Running faviconCache verification tests...');
    let failed = false;

    // Test 1: getFaviconKey
    const domain = 'www.iltalehti.fi';
    const key = getFaviconKey(domain);
    if (key !== 'favicon_www.iltalehti.fi') {
        console.error(`❌ getFaviconKey failed: expected "favicon_www.iltalehti.fi", got "${key}"`);
        failed = true;
    } else {
        console.log('✅ Passed: getFaviconKey returns correct domain key');
    }

    // Test 2: makeFaviconEntry positive
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const entry = makeFaviconEntry(dataUri);
    if (entry.v !== 1 || entry.data !== dataUri || typeof entry.cachedAt !== 'number') {
        console.error('❌ makeFaviconEntry failed for positive data', entry);
        failed = true;
    } else {
        console.log('✅ Passed: makeFaviconEntry creates valid envelope for positive data');
    }

    // Test 3: makeFaviconEntry negative
    const negativeEntry = makeFaviconEntry(null);
    if (negativeEntry.v !== 1 || negativeEntry.data !== null || typeof negativeEntry.cachedAt !== 'number') {
        console.error('❌ makeFaviconEntry failed for null data', negativeEntry);
        failed = true;
    } else {
        console.log('✅ Passed: makeFaviconEntry creates valid envelope for negative data');
    }

    // Test 4: isFaviconExpired - fresh positive entry
    if (isFaviconExpired(entry)) {
        console.error('❌ isFaviconExpired returned true for fresh positive entry');
        failed = true;
    } else {
        console.log('✅ Passed: fresh positive entry is not expired');
    }

    // Test 5: isFaviconExpired - expired positive entry
    const expiredPositiveEntry = {
        v: 1,
        data: dataUri,
        cachedAt: Date.now() - (FAVICON_TTL_MS + 1000)
    };
    if (!isFaviconExpired(expiredPositiveEntry)) {
        console.error('❌ isFaviconExpired returned false for expired positive entry');
        failed = true;
    } else {
        console.log('✅ Passed: expired positive entry is detected as expired');
    }

    // Test 6: isFaviconExpired - fresh negative entry
    if (isFaviconExpired(negativeEntry)) {
        console.error('❌ isFaviconExpired returned true for fresh negative entry');
        failed = true;
    } else {
        console.log('✅ Passed: fresh negative entry is not expired');
    }

    // Test 7: isFaviconExpired - expired negative entry
    const expiredNegativeEntry = {
        v: 1,
        data: null,
        cachedAt: Date.now() - (FAVICON_NEGATIVE_TTL_MS + 1000)
    };
    if (!isFaviconExpired(expiredNegativeEntry)) {
        console.error('❌ isFaviconExpired returned false for expired negative entry');
        failed = true;
    } else {
        console.log('✅ Passed: expired negative entry is detected as expired');
    }

    // Test 8: isFaviconExpired - malformed / old schema entries
    if (!isFaviconExpired(null)) {
        console.error('❌ isFaviconExpired returned false for null');
        failed = true;
    }
    if (!isFaviconExpired('data:image/png;base64,abc')) {
        console.error('❌ isFaviconExpired returned false for raw string');
        failed = true;
    }
    if (!isFaviconExpired({ v: 2, data: dataUri, cachedAt: Date.now() })) {
        console.error('❌ isFaviconExpired returned false for wrong version');
        failed = true;
    }
    if (!isFaviconExpired({ v: 1, data: dataUri })) {
        console.error('❌ isFaviconExpired returned false for missing cachedAt');
        failed = true;
    }
    console.log('✅ Passed: malformed/old schema entries are treated as expired');

    if (failed) {
        process.exit(1);
    }
    console.log('\nAll faviconCache tests passed successfully!');
}

runFaviconCacheTests();
