import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

// model.js reaches browser-api.js, which resolves the namespace at module evaluation -- so the
// mock has to be in place before the dynamic import below. See AGENTS.md.
const fake = createFakeBrowser();
globalThis.browser = fake.browser;

const {
    buildFeedbackPayload,
    buildFeedbackRequest,
    clickbaitBadgeIndex,
    googleFormPostUrl,
    isGoogleForm
} = await import('../src/feedback.js');

const GOOGLE_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSf_abc/formResponse';

const COMPLETE = {
    pageUrl: 'https://www.iltalehti.fi/kotimaa/a/123',
    urlSign: 'abc123',
    originalTitle: 'Tämä yksi temppu',
    convertedTitle: 'Kunta korotti veroja',
    clickbaitLevel: 3,
    feedbackType: 'bad_conversion',
    comment: 'Otsikko ei vastaa juttua',
    databaseUpdated: '2026-09-01T00:00:00.000Z'
};

describe('buildFeedbackPayload', () => {
    test('returns a payload with every field carried through', () => {
        const payload = buildFeedbackPayload(COMPLETE);

        assert.equal(payload.urlSign, 'abc123');
        assert.equal(payload.originalTitle, 'Tämä yksi temppu');
        assert.equal(payload.convertedTitle, 'Kunta korotti veroja');
        assert.equal(payload.feedbackType, 'bad_conversion');
        assert.equal(payload.databaseUpdated, '2026-09-01T00:00:00.000Z');
        assert.match(payload.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    });

    test('stringifies the clickbait level, including level 0', () => {
        assert.equal(buildFeedbackPayload(COMPLETE).clickbaitLevel, '3');
        assert.equal(buildFeedbackPayload({ ...COMPLETE, clickbaitLevel: 0 }).clickbaitLevel, '0');
    });

    test('strips tracking parameters from the page URL', () => {
        const payload = buildFeedbackPayload({
            ...COMPLETE,
            pageUrl: 'https://www.iltalehti.fi/a/1?utm_source=x&fbclid=y&id=7'
        });

        assert.equal(payload.pageUrl, 'https://www.iltalehti.fi/a/1?id=7');
    });

    test('trims the comment, and a whitespace-only comment becomes the placeholder', () => {
        assert.equal(buildFeedbackPayload({ ...COMPLETE, comment: '  spaced  ' }).comment, 'spaced');
        assert.equal(buildFeedbackPayload({ ...COMPLETE, comment: '   ' }).comment, '-');
        assert.equal(buildFeedbackPayload({ ...COMPLETE, comment: '' }).comment, '-');
        assert.equal(buildFeedbackPayload({ ...COMPLETE, comment: undefined }).comment, '-');
    });

    for (const field of ['pageUrl', 'urlSign', 'originalTitle', 'convertedTitle', 'feedbackType', 'databaseUpdated']) {
        test(`returns null when '${field}' is missing`, () => {
            assert.equal(buildFeedbackPayload({ ...COMPLETE, [field]: '' }), null);
            assert.equal(buildFeedbackPayload({ ...COMPLETE, [field]: undefined }), null);
        });
    }

    test('returns null when the clickbait level is absent, but not when it is zero', () => {
        assert.equal(buildFeedbackPayload({ ...COMPLETE, clickbaitLevel: undefined }), null);
        assert.equal(buildFeedbackPayload({ ...COMPLETE, clickbaitLevel: null }), null);
        assert.notEqual(buildFeedbackPayload({ ...COMPLETE, clickbaitLevel: 0 }), null);
    });

    test('returns null when an unparseable page URL sanitizes to nothing', () => {
        assert.equal(buildFeedbackPayload({ ...COMPLETE, pageUrl: '' }), null);
    });
});

describe('googleFormPostUrl', () => {
    const cases = [
        ['https://docs.google.com/forms/d/e/X/viewform', 'https://docs.google.com/forms/d/e/X/formResponse'],
        ['https://docs.google.com/forms/d/e/X/formResponse', 'https://docs.google.com/forms/d/e/X/formResponse'],
        ['https://docs.google.com/forms/d/e/X', 'https://docs.google.com/forms/d/e/X/formResponse'],
        ['https://docs.google.com/forms/d/e/X/', 'https://docs.google.com/forms/d/e/X/formResponse']
    ];

    for (const [input, expected] of cases) {
        test(`rewrites '${input}'`, () => assert.equal(googleFormPostUrl(input), expected));
    }
});

describe('isGoogleForm', () => {
    test('recognises a forms URL and rejects anything else', () => {
        assert.equal(isGoogleForm(GOOGLE_FORM), true);
        assert.equal(isGoogleForm('https://api.klikkikuri.fi/v1/feedback'), false);
        assert.equal(isGoogleForm(undefined), false);
    });
});

describe('buildFeedbackRequest', () => {
    test('maps every payload field onto its Google Form entry id', () => {
        const payload = buildFeedbackPayload(COMPLETE);
        const { url, init } = buildFeedbackRequest(GOOGLE_FORM, payload);
        const body = new URLSearchParams(init.body);

        assert.equal(url, GOOGLE_FORM);
        assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
        assert.equal(body.get('entry.1944615860'), payload.pageUrl);
        assert.equal(body.get('entry.1369854914'), 'abc123');
        assert.equal(body.get('entry.917360051'), 'Tämä yksi temppu');
        assert.equal(body.get('entry.1935829065'), 'Kunta korotti veroja');
        assert.equal(body.get('entry.1807257025'), '3');
        assert.equal(body.get('entry.167673994'), 'bad_conversion');
        assert.equal(body.get('entry.78795748'), 'Otsikko ei vastaa juttua');
        assert.equal(body.get('entry.364993842'), '2026-09-01T00:00:00.000Z');
    });

    test('rewrites a /viewform endpoint before posting', () => {
        const { url } = buildFeedbackRequest(
            'https://docs.google.com/forms/d/e/X/viewform',
            buildFeedbackPayload(COMPLETE)
        );

        assert.equal(url, 'https://docs.google.com/forms/d/e/X/formResponse');
    });

    test('sends the trimmed comment on the JSON endpoint too', () => {
        const payload = buildFeedbackPayload({ ...COMPLETE, comment: '   ' });
        const { url, init } = buildFeedbackRequest('https://api.klikkikuri.fi/v1/feedback', payload);

        assert.equal(url, 'https://api.klikkikuri.fi/v1/feedback');
        assert.equal(init.headers['Content-Type'], 'text/plain');
        assert.equal(JSON.parse(init.body).comment, '-');
    });

    test('never sends credentials or a referrer', () => {
        const { init } = buildFeedbackRequest(GOOGLE_FORM, buildFeedbackPayload(COMPLETE));

        assert.equal(init.method, 'POST');
        assert.equal(init.mode, 'no-cors');
        assert.equal(init.credentials, 'omit');
        assert.equal(init.referrerPolicy, 'no-referrer');
    });
});

describe('clickbaitBadgeIndex', () => {
    test('passes numeric levels through', () => {
        assert.deepEqual(clickbaitBadgeIndex(0), { index: 0, fallback: 'Neutral' });
        assert.deepEqual(clickbaitBadgeIndex(2), { index: 2, fallback: 'Medium' });
        assert.deepEqual(clickbaitBadgeIndex(4), { index: 4, fallback: 'Extreme' });
    });

    test('accepts a numeric string', () => {
        assert.equal(clickbaitBadgeIndex('1').index, 1);
    });

    test('treats anything unrecognised as the most severe level', () => {
        assert.equal(clickbaitBadgeIndex('nonsense').index, 4);
        assert.equal(clickbaitBadgeIndex(99).index, 4);
        assert.equal(clickbaitBadgeIndex(-1).index, 4);
        assert.equal(clickbaitBadgeIndex(undefined).index, 4);
    });
});
