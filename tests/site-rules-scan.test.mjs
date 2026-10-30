import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.browser = {};
const { scanSiteRules, decideStatus, isSelfSelector } = await import('../src/site-rules-scan.js');
const { LEVELS, DEFAULT_CLICKBAIT_LEVEL, LABEL_PAYWALLED } = await import('../src/clickbait-constants.js');

// A fake element: enough of the DOM for the scan. The containers answer querySelectorAll/querySelector from
// fixed tables, so the semantics under test are visible without a browser or jsdom.
const element = (href, table = {}) => ({
    getAttribute: (name) => (name === 'href' ? href : null),
    querySelectorAll: (selector) => table[selector] || [],
    querySelector: (selector) => table[selector] || null,
});

const PAGE = { containers: {} };
const document = { querySelectorAll: (selector) => PAGE.containers[selector] || [] };

const SELF_RULE = { container: 'a[href]', link: 'self', title: ':scope' };
const CARD_RULE = { container: 'div.card', link: 'a.card-link', title: 'h2' };

test('isSelfSelector accepts both spellings and nothing else', () => {
    assert.equal(isSelfSelector('self'), true);
    assert.equal(isSelfSelector(':scope'), true);
    assert.equal(isSelfSelector('a'), false);
    assert.equal(isSelfSelector(undefined), false);
});

test('scanSiteRules returns one item per link, with the container as its own title for a self rule', () => {
    const first = element('https://example.org/1');
    const second = element('https://example.org/2');
    PAGE.containers['a[href]'] = [first, second];
    const found = scanSiteRules(document, [SELF_RULE]);
    assert.deepEqual(found, [
        { container: first, link: first, titleElem: first, href: 'https://example.org/1' },
        { container: second, link: second, titleElem: second, href: 'https://example.org/2' },
    ]);
});

test('scanSiteRules takes the link and the title from below the container, and null when the title misses', () => {
    const headline = element(null);
    const card = element(null, {
        'a.card-link': [element('https://example.org/a')],
        h2: headline,
    });
    const noHeadline = element(null, { 'a.card-link': [element('https://example.org/b')] });
    PAGE.containers['div.card'] = [card, noHeadline];
    const found = scanSiteRules(document, [CARD_RULE]);
    assert.equal(found.length, 2);
    assert.equal(found[0].container, card);
    assert.equal(found[0].titleElem, headline);
    assert.equal(found[1].titleElem, null, 'a missing title selector gives a null title element');
});

test('scanSiteRules resolves a relative href against the page URL it is given', () => {
    const link = element('/news/a/abc123456789');
    PAGE.containers['a[href]'] = [link];
    const found = scanSiteRules(document, [SELF_RULE], 'http://localhost:3000/?seed=1');
    assert.equal(found[0].href, 'http://localhost:3000/news/a/abc123456789');
});

test('decideStatus follows processSite: skipped, converted, paywalled, original', () => {
    const scanned = { titleElem: element(null), href: 'https://example.org/1' };
    const atThreshold = { title: 'Neutral', clickbaitiness: LEVELS[DEFAULT_CLICKBAIT_LEVEL] };
    const belowThreshold = { title: 'Neutral', clickbaitiness: LEVELS[DEFAULT_CLICKBAIT_LEVEL - 1] };
    const paywall = { labels: [LABEL_PAYWALLED], clickbaitiness: LEVELS[2] };

    assert.equal(decideStatus(scanned, atThreshold, 'sign'), 'converted');
    assert.equal(decideStatus(scanned, belowThreshold, 'sign'), 'original');
    assert.equal(decideStatus(scanned, paywall, 'sign'), 'paywalled');
    assert.equal(decideStatus(scanned, null, 'sign'), 'skipped', 'no entry');
    assert.equal(decideStatus(scanned, atThreshold, null), 'skipped', 'no sign');
    assert.equal(decideStatus({ titleElem: null, href: 'x' }, atThreshold, 'sign'), 'skipped', 'no title element');
    assert.equal(decideStatus(scanned, { title: 'Neutral', clickbaitiness: 'Not a level' }, 'sign'), 'original',
        'an unknown level never converts');
});
