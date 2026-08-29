import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

globalThis.browser = createFakeBrowser().browser;

const { buildPageSnapshot, computeGaugeValue, computeCollectingPeriod, mergeStats, createSessionTracker } =
    await import('../src/stats.js');
const { Clickbaitiness } = await import('../src/model.js');

describe('buildPageSnapshot', () => {
    const reasons = [
        { what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_HIGH },
        { what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_EXTREME },
        { what: 'original', clickbaitiness: Clickbaitiness.LEVEL_NONE },
        { what: 'skipped', clickbaitiness: null },
        { what: 'error', clickbaitiness: undefined }
    ];

    test('convertedCount counts only converted items', () => {
        assert.equal(buildPageSnapshot(reasons).convertedCount, 2);
    });

    test('groupedByClickbaitiness aggregates valid levels', () => {
        const grouped = buildPageSnapshot(reasons).groupedByClickbaitiness;

        assert.equal(grouped[Clickbaitiness.LEVEL_HIGH], 1);
        assert.equal(grouped[Clickbaitiness.LEVEL_EXTREME], 1);
        assert.equal(grouped[Clickbaitiness.LEVEL_NONE], 1);
        assert.ok(!grouped[Clickbaitiness.LEVEL_LOW]);
    });

    test('empty input returns zero counts', () => {
        const snapshot = buildPageSnapshot([]);

        assert.equal(snapshot.convertedCount, 0);
        assert.deepEqual(snapshot.groupedByClickbaitiness, {});
    });
});

describe('computeGaugeValue', () => {
    test('empty stats produces 0% and Not Clickbait at all', () => {
        assert.deepEqual(computeGaugeValue({}), {
            averageValue: 0,
            percentage: 0,
            labelI18nKey: 'clickbaitinessLabel_Not_Clickbait_at_all'
        });
    });

    test('all extreme produces 100% and Extremely Clickbaity', () => {
        const gauge = computeGaugeValue({ [Clickbaitiness.LEVEL_EXTREME]: 5 });

        assert.equal(gauge.averageValue, 4);
        assert.equal(gauge.percentage, 100);
        assert.equal(gauge.labelI18nKey, 'clickbaitinessLabel_Extremely_Clickbaity');
    });

    test('low plus moderate averages 1.5 and reads Moderately Clickbaity', () => {
        const gauge = computeGaugeValue({
            [Clickbaitiness.LEVEL_LOW]: 1,
            [Clickbaitiness.LEVEL_MODERATE]: 1
        });

        assert.equal(gauge.averageValue, 1.5);
        assert.equal(gauge.percentage, 38);
        assert.equal(gauge.labelI18nKey, 'clickbaitinessLabel_Moderately_Clickbaity');
    });
});

describe('mergeStats', () => {
    const makeExisting = () => ({
        groupedByClickbaitiness: {
            [Clickbaitiness.LEVEL_NONE]: 5,
            [Clickbaitiness.LEVEL_HIGH]: 2
        }
    });
    const incoming = {
        groupedByClickbaitiness: {
            [Clickbaitiness.LEVEL_HIGH]: 3,
            [Clickbaitiness.LEVEL_EXTREME]: 1
        },
        convertedCount: 4
    };

    test('combines counts per level accurately', () => {
        const merged = mergeStats(makeExisting(), incoming);

        assert.equal(merged.groupedByClickbaitiness[Clickbaitiness.LEVEL_NONE], 5);
        assert.equal(merged.groupedByClickbaitiness[Clickbaitiness.LEVEL_HIGH], 5);
        assert.equal(merged.groupedByClickbaitiness[Clickbaitiness.LEVEL_EXTREME], 1);
    });

    test('does not mutate the existing object', () => {
        const existing = makeExisting();
        mergeStats(existing, incoming);

        assert.equal(existing.groupedByClickbaitiness[Clickbaitiness.LEVEL_HIGH], 2);
    });

    test('accumulates convertedCount separately from the level counts', () => {
        const merged = mergeStats({ ...makeExisting(), convertedCount: 7 }, incoming);

        assert.equal(merged.convertedCount, 11);
    });

    test('convertedCount starts from zero when the stored stats predate it', () => {
        assert.equal(mergeStats(makeExisting(), incoming).convertedCount, 4);
        assert.equal(mergeStats(makeExisting(), { groupedByClickbaitiness: {} }).convertedCount, 0);
    });

    test('firstSeen is stamped on a brand new domain', () => {
        assert.equal(mergeStats(undefined, incoming, 1700).firstSeen, 1700);
    });

    test('firstSeen is stamped on stored stats that predate it', () => {
        assert.equal(mergeStats(makeExisting(), incoming, 1700).firstSeen, 1700);
    });

    test('firstSeen survives later merges', () => {
        const existing = { ...makeExisting(), firstSeen: 900 };

        assert.equal(mergeStats(existing, incoming, 1700).firstSeen, 900);
    });
});

describe('computeCollectingPeriod', () => {
    const DAY = 24 * 60 * 60 * 1000;
    // Anchored on a fixed date so no assertion depends on the wall clock.
    const at = (year, month, day) => new Date(year, month - 1, day, 12).getTime();
    const since = (firstSeen, now) => computeCollectingPeriod(firstSeen, now);
    const key = (suffix) => `statsviewCollectingPeriod${suffix}`;

    test('returns null without a recorded start time', () => {
        assert.equal(since(undefined, at(2026, 1, 1)), null);
        assert.equal(since(null, at(2026, 1, 1)), null);
        assert.equal(since('yesterday', at(2026, 1, 1)), null);
    });

    test('the first day reads as today', () => {
        const start = at(2026, 1, 1);

        assert.deepEqual(since(start, start), { count: 0, labelI18nKey: key('Today') });
        assert.deepEqual(since(start, start + DAY - 60_000), { count: 0, labelI18nKey: key('Today') });
    });

    test('days run from one to thirteen', () => {
        const start = at(2026, 1, 1);

        assert.deepEqual(since(start, start + DAY), { count: 1, labelI18nKey: key('Day') });
        assert.deepEqual(since(start, start + 2 * DAY), { count: 2, labelI18nKey: key('Days') });
        assert.deepEqual(since(start, start + 13 * DAY), { count: 13, labelI18nKey: key('Days') });
    });

    test('weeks take over at fourteen days', () => {
        const start = at(2026, 1, 1);

        assert.deepEqual(since(start, start + 14 * DAY), { count: 2, labelI18nKey: key('Weeks') });
        assert.deepEqual(since(start, start + 20 * DAY), { count: 3, labelI18nKey: key('Weeks') });
    });

    test('two calendar months still read as weeks', () => {
        // 70 days. Reporting "2 months" here would drop precision a reader can still use.
        assert.deepEqual(since(at(2026, 1, 1), at(2026, 3, 12)), { count: 10, labelI18nKey: key('Weeks') });
    });

    test('months take over at the third calendar month', () => {
        assert.deepEqual(since(at(2026, 1, 1), at(2026, 4, 1)), { count: 3, labelI18nKey: key('Months') });
        // A shorter three-month span, over the turn of the year.
        assert.deepEqual(since(at(2025, 11, 1), at(2026, 2, 1)), { count: 3, labelI18nKey: key('Months') });
    });

    test('thirteen is the largest week count the ladder can produce', () => {
        assert.deepEqual(since(at(2025, 12, 1), at(2026, 2, 28)), { count: 13, labelI18nKey: key('Weeks') });
    });

    test('a day short of the anniversary stays on the lower unit', () => {
        assert.deepEqual(since(at(2026, 1, 15), at(2026, 4, 14)), { count: 13, labelI18nKey: key('Weeks') });
        assert.deepEqual(since(at(2026, 1, 15), at(2026, 4, 15)), { count: 3, labelI18nKey: key('Months') });
    });

    test('years take over at eighteen months, rounded to the nearest', () => {
        assert.deepEqual(since(at(2026, 1, 1), at(2027, 5, 1)), { count: 16, labelI18nKey: key('Months') });
        assert.deepEqual(since(at(2026, 1, 1), at(2027, 6, 1)), { count: 17, labelI18nKey: key('Months') });
        assert.deepEqual(since(at(2026, 1, 1), at(2027, 7, 1)), { count: 2, labelI18nKey: key('Years') });
        assert.deepEqual(since(at(2026, 1, 1), at(2028, 5, 1)), { count: 2, labelI18nKey: key('Years') });
        assert.deepEqual(since(at(2026, 1, 1), at(2028, 7, 1)), { count: 3, labelI18nKey: key('Years') });
    });

    test('no rung but days ever reports a count of one', () => {
        const now = at(2026, 6, 15);

        for (let day = 0; day < 5 * 365; day++) {
            const period = since(now - day * DAY, now);
            if (period.count !== 1) continue;
            assert.equal(period.labelI18nKey, key('Day'), `day ${day} reported a count of 1`);
        }
    });

    test('the reported period never shrinks as time passes', () => {
        const now = at(2026, 6, 15);
        // Rough span of each unit, only for checking the sequence never steps backwards.
        const spans = { Today: 0, Day: 1, Days: 1, Weeks: 7, Months: 30.44, Years: 365.25 };
        let previous = 0;

        for (let day = 0; day < 5 * 365; day++) {
            const period = since(now - day * DAY, now);
            const span = period.count * spans[period.labelI18nKey.replace('statsviewCollectingPeriod', '')];
            assert.ok(span >= previous, `day ${day} reported a shorter period than day ${day - 1}`);
            previous = span;
        }
    });
});

describe('createSessionTracker', () => {
    test('first pass returns all items, later passes only unseen ones', () => {
        const tracker = createSessionTracker();
        const pass1 = [
            { urlSign: 'hash1', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_HIGH },
            { urlSign: 'hash2', what: 'original', clickbaitiness: Clickbaitiness.LEVEL_NONE }
        ];

        assert.equal(tracker.getDelta(pass1).length, 2);

        const delta2 = tracker.getDelta([
            ...pass1,
            { urlSign: 'hash3', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_LOW }
        ]);

        assert.equal(delta2.length, 1);
        assert.equal(delta2[0].urlSign, 'hash3');
    });

    test('falls back to originalTitle and how when urlSign is absent', () => {
        const tracker = createSessionTracker();
        const delta = tracker.getDelta([
            { originalTitle: 'Title A', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_LOW },
            { how: 'Title B', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_LOW }
        ]);

        assert.equal(delta.length, 2);
    });
});
