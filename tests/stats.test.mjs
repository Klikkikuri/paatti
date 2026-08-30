import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

globalThis.browser = createFakeBrowser().browser;

const { buildPageSnapshot, computeGaugeValue, computeCollectingPeriod, mergeStats, sharePercent,
    summarizeLevels, summarizeSites, createSessionTracker } =
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
        assert.deepEqual(snapshot.convertedByClickbaitiness, {});
    });

    test('a converted item lands in both maps', () => {
        const converted = buildPageSnapshot(reasons).convertedByClickbaitiness;

        assert.equal(converted[Clickbaitiness.LEVEL_HIGH], 1);
        assert.equal(converted[Clickbaitiness.LEVEL_EXTREME], 1);
    });

    test('an unconverted item lands in the found map only', () => {
        const snapshot = buildPageSnapshot(reasons);

        assert.equal(snapshot.groupedByClickbaitiness[Clickbaitiness.LEVEL_NONE], 1);
        assert.ok(!snapshot.convertedByClickbaitiness[Clickbaitiness.LEVEL_NONE]);
    });

    test('a converted item without a level counts in the total only', () => {
        const snapshot = buildPageSnapshot([{ what: 'converted', clickbaitiness: null }]);

        assert.equal(snapshot.convertedCount, 1);
        assert.deepEqual(snapshot.convertedByClickbaitiness, {});
        assert.deepEqual(snapshot.groupedByClickbaitiness, {});
    });

    test('the converted counts never exceed the found counts', () => {
        const snapshot = buildPageSnapshot(reasons);

        for (const [level, count] of Object.entries(snapshot.convertedByClickbaitiness)) {
            assert.ok(count <= snapshot.groupedByClickbaitiness[level]);
        }
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

    test('accumulates the converted counts per level across merges', () => {
        const existing = {
            groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 4 },
            convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 1 },
            convertedCount: 1
        };
        const merged = mergeStats(existing, {
            groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 3, [Clickbaitiness.LEVEL_EXTREME]: 1 },
            convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 2, [Clickbaitiness.LEVEL_EXTREME]: 1 },
            convertedCount: 3
        });

        assert.equal(merged.convertedByClickbaitiness[Clickbaitiness.LEVEL_HIGH], 3);
        assert.equal(merged.convertedByClickbaitiness[Clickbaitiness.LEVEL_EXTREME], 1);
    });

    test('does not mutate the existing converted counts', () => {
        const existing = {
            groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 4 },
            convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 1 },
            convertedCount: 1
        };
        mergeStats(existing, {
            convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 2 },
            convertedCount: 2
        });

        assert.equal(existing.convertedByClickbaitiness[Clickbaitiness.LEVEL_HIGH], 1);
    });

    test('stored stats predating the per-level converted counts merge cleanly', () => {
        const merged = mergeStats(makeExisting(), {
            groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 1 },
            convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 1 },
            convertedCount: 1
        });

        assert.equal(merged.convertedByClickbaitiness[Clickbaitiness.LEVEL_HIGH], 1);
    });

    test('a brand new domain collects the split from the start', () => {
        const merged = mergeStats(undefined, incoming, 1700);

        assert.equal(merged.convertedByClickbaitinessSince, undefined);
        assert.ok(!('convertedByClickbaitinessSince' in merged));
    });

    test('a record that predates the split is stamped as starting late', () => {
        // Its history is already counted in the other two tallies, which the split will never catch up to.
        assert.equal(mergeStats(makeExisting(), incoming, 1700).convertedByClickbaitinessSince, 1700);
        assert.equal(
            mergeStats({ convertedCount: 3 }, incoming, 1700).convertedByClickbaitinessSince,
            1700
        );
    });

    test('the late-start stamp never moves once set', () => {
        const existing = {
            groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 4 },
            convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 1 },
            convertedCount: 1,
            convertedByClickbaitinessSince: 900
        };

        assert.equal(mergeStats(existing, incoming, 1700).convertedByClickbaitinessSince, 900);
    });
});

describe('summarizeLevels', () => {
    const LEVELS = Clickbaitiness.LEVELS;

    test('empty and undefined input show nothing and count nothing', () => {
        for (const input of [undefined, {}]) {
            const summary = summarizeLevels(input, input, LEVELS);

            assert.deepEqual(summary.shown, []);
            assert.equal(summary.maxCount, 0);
            assert.equal(summary.totalFound, 0);
        }
    });

    test('a sparse tally follows the levels order, not the key order', () => {
        const summary = summarizeLevels(
            { [Clickbaitiness.LEVEL_EXTREME]: 2, [Clickbaitiness.LEVEL_LOW]: 7 },
            {},
            LEVELS
        );

        assert.deepEqual(summary.shown.map((row) => row.level),
            [Clickbaitiness.LEVEL_LOW, Clickbaitiness.LEVEL_EXTREME]);
        assert.deepEqual(summary.shown.map((row) => row.index), [1, 4]);
    });

    test('a level index is its severity', () => {
        const summary = summarizeLevels({ [Clickbaitiness.LEVEL_HIGH]: 1 }, {}, LEVELS);

        assert.equal(summary.shown[0].index, Clickbaitiness.stringToNumber(Clickbaitiness.LEVEL_HIGH));
    });

    test('a missing converted map reads as zero rewritten, not NaN', () => {
        const summary = summarizeLevels({ [Clickbaitiness.LEVEL_HIGH]: 3 }, undefined, LEVELS);

        assert.equal(summary.shown[0].rewritten, 0);
    });

    test('rewritten counts come from the converted map', () => {
        const summary = summarizeLevels(
            { [Clickbaitiness.LEVEL_HIGH]: 3, [Clickbaitiness.LEVEL_EXTREME]: 4 },
            { [Clickbaitiness.LEVEL_EXTREME]: 4 },
            LEVELS
        );

        assert.deepEqual(summary.shown.map((row) => row.rewritten), [0, 4]);
    });

    test('maxCount is the largest shown count, not the total', () => {
        const summary = summarizeLevels(
            { [Clickbaitiness.LEVEL_LOW]: 9, [Clickbaitiness.LEVEL_HIGH]: 23 },
            {},
            LEVELS
        );

        assert.equal(summary.maxCount, 23);
    });

    test('a single populated level is its own maximum', () => {
        assert.equal(summarizeLevels({ [Clickbaitiness.LEVEL_LOW]: 9 }, {}, LEVELS).maxCount, 9);
    });

    test('totalFound sums every level, hidden zeros included', () => {
        const summary = summarizeLevels(
            { [Clickbaitiness.LEVEL_LOW]: 9, [Clickbaitiness.LEVEL_NONE]: 0, [Clickbaitiness.LEVEL_HIGH]: 23 },
            {},
            LEVELS
        );

        assert.equal(summary.totalFound, 32);
    });

    test('a level with no titles gets no row', () => {
        const summary = summarizeLevels({ [Clickbaitiness.LEVEL_MODERATE]: 1 }, {}, LEVELS);

        assert.deepEqual(summary.shown.map((row) => row.level), [Clickbaitiness.LEVEL_MODERATE]);
    });

    test('a level absent from the levels list is ignored entirely', () => {
        const summary = summarizeLevels({ 'Made Up Level': 5 }, {}, LEVELS);

        assert.deepEqual(summary.shown, []);
        assert.equal(summary.totalFound, 0);
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

describe('sharePercent', () => {
    test('states a part of its whole', () => {
        assert.equal(sharePercent(60, 200), 30);
        assert.equal(sharePercent(200, 200), 100);
    });

    test('rounds to a whole percent', () => {
        assert.equal(sharePercent(1, 3), 33);
        assert.equal(sharePercent(2, 3), 67);
    });

    test('an empty whole has no share', () => {
        assert.equal(sharePercent(0, 0), null);
        assert.equal(sharePercent(4, 0), null);
    });

    test('a part counted wider than its whole has no share', () => {
        assert.equal(sharePercent(150, 100), null);
    });
});

describe('summarizeSites', () => {
    const statistics = {
        'is.fi': {
            groupedByClickbaitiness: {
                [Clickbaitiness.LEVEL_HIGH]: 800,
                [Clickbaitiness.LEVEL_EXTREME]: 404
            },
            convertedCount: 612,
            firstSeen: 1755000000000
        },
        'yle.fi': {
            groupedByClickbaitiness: {
                [Clickbaitiness.LEVEL_NONE]: 400,
                [Clickbaitiness.LEVEL_LOW]: 20
            },
            convertedCount: 38
        },
        _global: { totalConversions: 1842 }
    };

    test('the global tally is not a site', () => {
        const { sites } = summarizeSites(statistics);

        assert.deepEqual(sites.map((site) => site.domain), ['is.fi', 'yle.fi']);
    });

    test('found sums every level, rewritten reads convertedCount', () => {
        const [busiest] = summarizeSites(statistics).sites;

        assert.equal(busiest.found, 1204);
        assert.equal(busiest.rewritten, 612);
        assert.equal(busiest.firstSeen, 1755000000000);
    });

    test('a level the gauge cannot weigh is counted nowhere', () => {
        const { sites, overallByLevel } = summarizeSites({
            'is.fi': {
                groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 8, 'Utterly Baffling': 500 },
                convertedCount: 5
            }
        });

        assert.equal(sites[0].found, 8);
        assert.deepEqual(overallByLevel, { [Clickbaitiness.LEVEL_HIGH]: 8 });
    });

    test('severity indexes the level the gauge label names', () => {
        const [busiest, quietest] = summarizeSites(statistics).sites;

        assert.equal(busiest.severity, Clickbaitiness.LEVELS.indexOf(Clickbaitiness.LEVEL_HIGH));
        assert.equal(busiest.labelI18nKey, 'clickbaitinessLabel_Very_Clickbaity');
        assert.equal(quietest.severity, Clickbaitiness.LEVELS.indexOf(Clickbaitiness.LEVEL_NONE));
        assert.equal(quietest.labelI18nKey, 'clickbaitinessLabel_Not_Clickbait_at_all');
    });

    test('a domain with nothing counted is not a row', () => {
        const { sites } = summarizeSites({
            'empty.fi': { groupedByClickbaitiness: {}, convertedCount: 0 },
            'yle.fi': statistics['yle.fi']
        });

        assert.deepEqual(sites.map((site) => site.domain), ['yle.fi']);
    });

    test('a record predating convertedCount still lists what it found', () => {
        const [site] = summarizeSites({
            'old.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 12 } }
        }).sites;

        assert.equal(site.found, 12);
        assert.equal(site.rewritten, 0);
    });

    test('rows fall back from rewritten to found to the domain', () => {
        const { sites } = summarizeSites({
            'b.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 5 }, convertedCount: 3 },
            'a.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 5 }, convertedCount: 3 },
            'c.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 9 }, convertedCount: 3 }
        });

        assert.deepEqual(sites.map((site) => site.domain), ['c.fi', 'a.fi', 'b.fi']);
    });

    describe('sharePercent on a row', () => {
        test('a rewritten tally within the found one states a share', () => {
            const [site] = summarizeSites({
                'ok.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 200 }, convertedCount: 60 }
            }).sites;

            assert.equal(site.sharePercent, 30);
        });

        test('a converted tally counting level-less titles cannot be a share of the found ones', () => {
            const [site] = summarizeSites({
                'odd.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 100 }, convertedCount: 150 }
            }).sites;

            assert.equal(site.sharePercent, null);
        });

        test('a record that found nothing states no share either', () => {
            const [site] = summarizeSites({
                'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 }
            }).sites;

            assert.equal(site.found, 0);
            assert.equal(site.sharePercent, null);
        });
    });

    describe('the level maps behind a row', () => {
        test('a row carries the levels behind it for a view to break it down', () => {
            const [busiest] = summarizeSites(statistics).sites;

            assert.deepEqual(busiest.foundByLevel, statistics['is.fi'].groupedByClickbaitiness);
        });

        test('summarizeLevels reads a row straight off', () => {
            const [site] = summarizeSites({
                'is.fi': {
                    groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 8, [Clickbaitiness.LEVEL_EXTREME]: 2 },
                    convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 5 },
                    convertedCount: 5
                }
            }).sites;

            const { shown, maxCount } = summarizeLevels(
                site.foundByLevel, site.rewrittenByLevel, Clickbaitiness.LEVELS);

            assert.deepEqual(shown, [
                { level: Clickbaitiness.LEVEL_HIGH, index: 3, count: 8, rewritten: 5 },
                { level: Clickbaitiness.LEVEL_EXTREME, index: 4, count: 2, rewritten: 0 }
            ]);
            assert.equal(maxCount, 8);
        });

        test('a split collected from the start is known', () => {
            const [site] = summarizeSites({
                'is.fi': {
                    groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 8 },
                    convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 5 },
                    convertedCount: 5
                }
            }).sites;

            assert.deepEqual(site.rewrittenByLevel, { [Clickbaitiness.LEVEL_HIGH]: 5 });
            assert.equal(site.rewrittenByLevelIsKnown, true);
        });

        test('a record predating the split states none', () => {
            const [site] = summarizeSites({
                'old.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 8 }, convertedCount: 5 }
            }).sites;

            assert.deepEqual(site.rewrittenByLevel, {});
            assert.equal(site.rewrittenByLevelIsKnown, false);
        });

        test('a split that started late is not known, map or no map', () => {
            const [site] = summarizeSites({
                'late.fi': {
                    groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 8 },
                    convertedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 2 },
                    convertedByClickbaitinessSince: 1755000000000,
                    convertedCount: 5
                }
            }).sites;

            assert.equal(site.rewrittenByLevelIsKnown, false);
        });
    });

    describe('since', () => {
        test('is the earliest start any record carries', () => {
            const { since } = summarizeSites({
                'old.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 3 }, firstSeen: 1000 },
                'new.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 3 }, firstSeen: 9000 }
            });

            assert.equal(since, 1000);
        });

        test('a record predating firstSeen is no candidate for it', () => {
            const { since } = summarizeSites({
                'legacy.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 3 } },
                'new.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 3 }, firstSeen: 9000 }
            });

            assert.equal(since, 9000);
        });

        test('is null when nothing records a start', () => {
            assert.equal(summarizeSites({
                'legacy.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_LOW]: 3 } }
            }).since, null);
        });
    });

    test('an empty map yields no rows, no award and no mix', () => {
        assert.deepEqual(summarizeSites({}), {
            sites: [], clickbaitiest: null, overallByLevel: {},
            totals: { rewritten: 0, found: 0, sharePercent: null }, since: null
        });
        assert.deepEqual(summarizeSites(undefined).sites, []);
    });

    describe('totals', () => {
        test('pool the rows the headline sits above', () => {
            const { totals } = summarizeSites(statistics);

            assert.deepEqual(totals, { rewritten: 650, found: 1624, sharePercent: 40 });
        });

        test('the global tally is no part of them', () => {
            // _global reaches further back than convertedCount and counts level-less swaps, so it
            // cannot sit on either side of the headline's "of".
            const { totals } = summarizeSites({
                'is.fi': statistics['is.fi'],
                _global: { totalConversions: 99999 }
            });

            assert.equal(totals.rewritten, 612);
        });

        test('a pooled tally larger than the pooled find states no share', () => {
            const { totals } = summarizeSites({
                'odd.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 10 }, convertedCount: 40 }
            });

            assert.equal(totals.sharePercent, null);
        });
    });

    describe('overallByLevel', () => {
        test('pools every domain rather than weighing their sites equally', () => {
            // One extreme title beside 99 calm ones stays one title in the mix, which weighing the
            // two sites equally would not: that would give it half the width.
            const { overallByLevel } = summarizeSites({
                'calm.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_NONE]: 99 } },
                'loud.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_EXTREME]: 1 } }
            });

            assert.deepEqual(overallByLevel, {
                [Clickbaitiness.LEVEL_NONE]: 99,
                [Clickbaitiness.LEVEL_EXTREME]: 1
            });
        });

        test('one site pools to that site alone', () => {
            const { overallByLevel } = summarizeSites({
                'is.fi': statistics['is.fi'],
                _global: { totalConversions: 612 }
            });

            assert.deepEqual(overallByLevel, statistics['is.fi'].groupedByClickbaitiness);
        });

        test('the same level on two sites adds up', () => {
            const { overallByLevel } = summarizeSites({
                'a.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 4 } },
                'b.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_HIGH]: 6 } },
                _global: { totalConversions: 9999 }
            });

            assert.deepEqual(overallByLevel, { [Clickbaitiness.LEVEL_HIGH]: 10 });
        });

        test('a record that only ever converted level-less titles pools nothing', () => {
            const { sites, overallByLevel } = summarizeSites({
                'none.fi': { groupedByClickbaitiness: {}, convertedCount: 4 }
            });

            assert.equal(sites.length, 1);
            assert.deepEqual(overallByLevel, {});
        });
    });

    describe('clickbaitiest', () => {
        test('is the highest reading once there is a contest', () => {
            assert.equal(summarizeSites(statistics).clickbaitiest.domain, 'is.fi');
        });

        test('is withheld while only one site has found anything', () => {
            const { clickbaitiest } = summarizeSites({
                'yle.fi': statistics['yle.fi'],
                _global: { totalConversions: 38 }
            });

            assert.equal(clickbaitiest, null);
        });

        test('a tie goes to the site with more titles behind the reading', () => {
            const { clickbaitiest } = summarizeSites({
                'few.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_EXTREME]: 3 } },
                'many.fi': { groupedByClickbaitiness: { [Clickbaitiness.LEVEL_EXTREME]: 300 } }
            });

            assert.equal(clickbaitiest.domain, 'many.fi');
        });
    });
});
