import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeBrowser } from './helpers/fake-browser.mjs';

globalThis.browser = createFakeBrowser().browser;

const { buildPageSnapshot, computeGaugeValue, mergeStats, createSessionTracker } = await import('../src/stats.js');
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
