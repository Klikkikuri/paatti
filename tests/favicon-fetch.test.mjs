import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

// Every input comes from a page, so these cases are all about what the module refuses. The module
// holds its in-flight set and its rate-limit window at module scope, so each scenario imports a fresh
// copy through a distinct query string -- the trick tests/browser-namespace.test.mjs uses.
//
// The fake browser is shared, and has to be: a query string busts the cache for favicon-fetch.js
// alone, while the `./browser-api.js` it imports keeps resolving to one cached module holding
// whichever namespace was in place when it first ran. So it goes up once, here, and storage is reset
// per scenario instead.
const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const local = fake.browser.storage.local;
let caseNumber = 0;

/**
 * A fresh module over the shared fake browser, with a recording `fetch`.
 *
 * @param {object} [options]
 * @param {Response|(() => Response)} [options.response] - What the recorded fetch answers with.
 * @param {object} [options.stored] - Initial browser.storage.local contents.
 */
async function scenario({ response = imageResponse(), stored = {} } = {}) {
    await local.clear();
    if (Object.keys(stored).length > 0) await local.set(stored);

    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return typeof response === 'function' ? response() : response;
    };

    const module = await import(`../src/favicon-fetch.js?case=${++caseNumber}`);
    return { ...module, calls, stored: () => local.get(null) };
}

/** A plausible favicon response: one pixel of PNG, typed as an image. */
function imageResponse(headers = { 'content-type': 'image/png' }) {
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers });
}

describe('storeFavicon refuses what the page chose', () => {
    test('issues no fetch at all for a private address', async () => {
        const { storeFavicon, calls, stored } = await scenario();

        await storeFavicon('https://www.iltalehti.fi/article', 'http://192.168.1.1/api/shutdown');

        assert.deepEqual(calls, [], 'a request left for the private address');
        assert.deepEqual(await stored(), {}, 'something was written');
    });

    test('issues no fetch for loopback under any spelling', async () => {
        for (const url of ['http://127.0.0.1/f.ico', 'http://2130706433/f.ico', 'http://[::1]/f.ico']) {
            const { storeFavicon, calls } = await scenario();
            await storeFavicon('https://www.iltalehti.fi/article', url);
            assert.deepEqual(calls, [], `a request left for ${url}`);
        }
    });

    test('refuses a scheme that is not http(s)', async () => {
        const { storeFavicon, calls, stored } = await scenario();

        await storeFavicon('https://www.iltalehti.fi/article', 'file:///etc/passwd');

        assert.deepEqual(calls, []);
        assert.deepEqual(await stored(), {});
    });

    test('writes nothing when there is no sender URL to take the domain from', async () => {
        const { storeFavicon, calls, stored } = await scenario();

        await storeFavicon(undefined, 'https://www.iltalehti.fi/favicon.ico');

        assert.deepEqual(calls, []);
        assert.deepEqual(await stored(), {});
    });
});

describe('storeFavicon takes the domain from the sender', () => {
    test('a message that disagrees with the sender writes under the sender only', async () => {
        // A domain in the message is not read at all, so a page cannot name the key its favicon lands
        // under and poison the favicon the options page shows for an unrelated site.
        const { storeFavicon, stored } = await scenario();

        await storeFavicon('https://www.iltalehti.fi/article', 'https://www.iltalehti.fi/favicon.ico');

        assert.deepEqual(Object.keys(await stored()).sort(), ['favicon_iltalehti.fi', 'favicon_www.iltalehti.fi']);
    });

    test('fetches a favicon on a CDN, and files it under the sender all the same', async () => {
        // iltalehti.fi serves its only favicon from assets.ilcdn.fi, so a cross-origin URL is ordinary.
        // safeFetch judges the address; the key stays the sender's.
        const { storeFavicon, calls, stored } = await scenario();

        await storeFavicon('https://www.iltalehti.fi/article', 'https://assets.ilcdn.test/favicon.ico');

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://assets.ilcdn.test/favicon.ico');
        assert.deepEqual(Object.keys(await stored()).sort(), ['favicon_iltalehti.fi', 'favicon_www.iltalehti.fi']);
    });

    test('stores the fetched image under the domain and its www sibling', async () => {
        const { storeFavicon, stored } = await scenario();

        await storeFavicon('https://hs.fi/article', 'https://hs.fi/favicon.ico');

        const entries = await stored();
        assert.match(entries['favicon_hs.fi'].data, /^data:image\/png;base64,/);
        assert.deepEqual(entries['favicon_www.hs.fi'], entries['favicon_hs.fi']);
    });

    test('does not fetch again while an entry is still fresh', async () => {
        const fresh = { v: 1, data: 'data:image/png;base64,iVBORw0KGgo=', cachedAt: Date.now() };
        const { storeFavicon, calls } = await scenario({ stored: { 'favicon_www.hs.fi': fresh } });

        await storeFavicon('https://www.hs.fi/article', 'https://www.hs.fi/favicon.ico');

        assert.deepEqual(calls, [], 'a fresh entry was refetched');
    });
});

describe('storeFavicon bounds the response', () => {
    test('does not store a response that is not an image, and stops retrying it', async () => {
        const html = new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
        const { storeFavicon, stored } = await scenario({ response: html });

        await storeFavicon('https://www.hs.fi/a', 'https://www.hs.fi/favicon.ico');

        assert.equal((await stored())['favicon_www.hs.fi'].data, null, 'an HTML body was stored');
    });

    test('does not store an oversized response', async () => {
        const { MAX_FAVICON_BYTES, storeFavicon, stored } = await scenario({
            response: new Response(new Uint8Array(64 * 1024 + 1), { headers: { 'content-type': 'image/png' } })
        });

        await storeFavicon('https://www.hs.fi/a', 'https://www.hs.fi/favicon.ico');

        assert.equal(MAX_FAVICON_BYTES, 64 * 1024);
        assert.equal((await stored())['favicon_www.hs.fi'], undefined, 'an oversized body was stored');
    });

    test('negatively caches a non-2xx response', async () => {
        const { storeFavicon, stored } = await scenario({ response: new Response('', { status: 404 }) });

        await storeFavicon('https://www.hs.fi/a', 'https://www.hs.fi/favicon.ico');

        assert.equal((await stored())['favicon_www.hs.fi'].data, null);
    });

    test('stores nothing when the request throws', async () => {
        const { storeFavicon, stored } = await scenario({
            response: () => { throw new Error('network down'); }
        });

        await storeFavicon('https://www.hs.fi/a', 'https://www.hs.fi/favicon.ico');

        assert.deepEqual(await stored(), {}, 'a transient failure was cached');
    });
});

describe('storeFavicon rate limit', () => {
    test('rotating subdomains do not defeat it', async () => {
        // The TTL and the in-flight guard both key on the domain, which a page varies freely by serving
        // the content script from a fresh subdomain. This is the guard that does not.
        const { MAX_FAVICON_FETCHES, storeFavicon, calls } = await scenario({
            response: () => imageResponse()
        });

        for (let index = 0; index < MAX_FAVICON_FETCHES + 10; index++) {
            const origin = `https://sub${index}.example.test`;
            await storeFavicon(`${origin}/article`, `${origin}/favicon.ico`);
        }

        assert.equal(calls.length, MAX_FAVICON_FETCHES, 'more was fetched than the window allows');
    });

    test('one domain retrying a failing URL does not defeat it either', async () => {
        // A refused or failed fetch caches nothing, so the TTL never closes behind it. Without counting
        // every attempt, a single page naming a fresh URL on each reload would be waved through for ever
        // on the strength of having been seen once.
        const { MAX_FAVICON_FETCHES, storeFavicon, calls, stored } = await scenario({
            response: () => { throw new Error('network down'); }
        });

        for (let index = 0; index < MAX_FAVICON_FETCHES + 10; index++) {
            await storeFavicon('https://www.hs.fi/article', `https://tracker.test/${index}.ico`);
        }

        assert.deepEqual(await stored(), {}, 'a failed fetch was cached');
        assert.equal(calls.length, MAX_FAVICON_FETCHES, 'one domain retried past the window');
    });

    test('a second fetch inside the window is allowed while under the cap', async () => {
        const { storeFavicon, calls } = await scenario({ response: () => imageResponse() });

        await storeFavicon('https://www.hs.fi/a', 'https://www.hs.fi/favicon.ico');
        // The entry just written is fresh, so drop it to let a second fetch past the TTL guard.
        await local.clear();
        await storeFavicon('https://www.hs.fi/b', 'https://www.hs.fi/favicon.ico');

        assert.equal(calls.length, 2);
    });
});
