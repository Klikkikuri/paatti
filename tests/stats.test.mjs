// Mock browser API globally before importing modules
globalThis.browser = {
    storage: {
        local: {
            get: async () => ({}),
            set: async () => ({})
        },
        sync: {
            get: async () => ({}),
            set: async () => ({})
        },
        onChanged: {
            addListener: () => {}
        }
    }
};

const { buildPageSnapshot, computeGaugeValue, mergeStats, createSessionTracker } = await import('../src/stats.js');
const { Clickbaitiness } = await import('../src/model.js');

/**
 * Runs unit tests for src/stats.js.
 */
function runStatsTests() {
    console.log('Running stats module verification tests...');
    let failed = false;

    // --- buildPageSnapshot Tests ---
    console.log('\n--- buildPageSnapshot Tests ---');
    {
        const reasons = [
            { what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_HIGH },
            { what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_EXTREME },
            { what: 'original', clickbaitiness: Clickbaitiness.LEVEL_NONE },
            { what: 'skipped', clickbaitiness: null },
            { what: 'error', clickbaitiness: undefined }
        ];
        const snapshot = buildPageSnapshot(reasons);

        if (snapshot.convertedCount !== 2) {
            console.error(`❌ Expected convertedCount 2, got ${snapshot.convertedCount}`);
            failed = true;
        } else {
            console.log('✅ Passed: convertedCount counts only converted items');
        }

        if (snapshot.groupedByClickbaitiness[Clickbaitiness.LEVEL_HIGH] !== 1 ||
            snapshot.groupedByClickbaitiness[Clickbaitiness.LEVEL_EXTREME] !== 1 ||
            snapshot.groupedByClickbaitiness[Clickbaitiness.LEVEL_NONE] !== 1 ||
            snapshot.groupedByClickbaitiness[Clickbaitiness.LEVEL_LOW]) {
            console.error(`❌ Unexpected groupedByClickbaitiness:`, snapshot.groupedByClickbaitiness);
            failed = true;
        } else {
            console.log('✅ Passed: groupedByClickbaitiness correctly aggregates valid levels');
        }

        const emptySnapshot = buildPageSnapshot([]);
        if (emptySnapshot.convertedCount !== 0 || Object.keys(emptySnapshot.groupedByClickbaitiness).length !== 0) {
            console.error(`❌ Empty snapshot failed:`, emptySnapshot);
            failed = true;
        } else {
            console.log('✅ Passed: empty input returns zero counts');
        }
    }

    // --- computeGaugeValue Tests ---
    console.log('\n--- computeGaugeValue Tests ---');
    {
        const zeroGauge = computeGaugeValue({});
        if (zeroGauge.averageValue !== 0 || zeroGauge.percentage !== 0 || zeroGauge.labelI18nKey !== 'clickbaitinessLabel_Not_Clickbait_at_all') {
            console.error(`❌ Zero gauge failed:`, zeroGauge);
            failed = true;
        } else {
            console.log('✅ Passed: empty stats produces 0% and Not Clickbait at all');
        }

        // All extreme (level 4) -> 100%
        const extremeGauge = computeGaugeValue({ [Clickbaitiness.LEVEL_EXTREME]: 5 });
        if (extremeGauge.averageValue !== 4 || extremeGauge.percentage !== 100 || extremeGauge.labelI18nKey !== 'clickbaitinessLabel_Extremely_Clickbaity') {
            console.error(`❌ Extreme gauge failed:`, extremeGauge);
            failed = true;
        } else {
            console.log('✅ Passed: extreme stats produces 100% and Extremely Clickbaity');
        }

        // Low + Moderate (1 + 2 = average 1.5) -> Moderately Clickbaity
        const mixedGauge = computeGaugeValue({
            [Clickbaitiness.LEVEL_LOW]: 1,
            [Clickbaitiness.LEVEL_MODERATE]: 1
        });
        if (mixedGauge.averageValue !== 1.5 || mixedGauge.percentage !== 38 || mixedGauge.labelI18nKey !== 'clickbaitinessLabel_Moderately_Clickbaity') {
            console.error(`❌ Mixed gauge failed:`, mixedGauge);
            failed = true;
        } else {
            console.log('✅ Passed: mixed stats produces correct percentage and Moderately Clickbaity');
        }
    }

    // --- mergeStats Tests ---
    console.log('\n--- mergeStats Tests ---');
    {
        const existing = {
            groupedByClickbaitiness: {
                [Clickbaitiness.LEVEL_NONE]: 5,
                [Clickbaitiness.LEVEL_HIGH]: 2
            }
        };
        const incoming = {
            groupedByClickbaitiness: {
                [Clickbaitiness.LEVEL_HIGH]: 3,
                [Clickbaitiness.LEVEL_EXTREME]: 1
            },
            convertedCount: 4
        };

        const merged = mergeStats(existing, incoming);

        if (merged.groupedByClickbaitiness[Clickbaitiness.LEVEL_NONE] !== 5 ||
            merged.groupedByClickbaitiness[Clickbaitiness.LEVEL_HIGH] !== 5 ||
            merged.groupedByClickbaitiness[Clickbaitiness.LEVEL_EXTREME] !== 1) {
            console.error(`❌ Merged stats groupedByClickbaitiness incorrect:`, merged);
            failed = true;
        } else {
            console.log('✅ Passed: mergeStats combines counts per level accurately');
        }

        // Verify immutability
        if (existing.groupedByClickbaitiness[Clickbaitiness.LEVEL_HIGH] !== 2) {
            console.error(`❌ Existing object was mutated!`);
            failed = true;
        } else {
            console.log('✅ Passed: mergeStats does not mutate existing object');
        }
    }

    // --- createSessionTracker Tests ---
    console.log('\n--- createSessionTracker Tests ---');
    {
        const tracker = createSessionTracker();

        const pass1 = [
            { urlSign: 'hash1', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_HIGH },
            { urlSign: 'hash2', what: 'original', clickbaitiness: Clickbaitiness.LEVEL_NONE }
        ];
        const delta1 = tracker.getDelta(pass1);

        if (delta1.length !== 2) {
            console.error(`❌ First pass delta length expected 2, got ${delta1.length}`);
            failed = true;
        } else {
            console.log('✅ Passed: first pass returns all items');
        }

        // Second pass has pass1 + a new dynamic item
        const pass2 = [
            { urlSign: 'hash1', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_HIGH },
            { urlSign: 'hash2', what: 'original', clickbaitiness: Clickbaitiness.LEVEL_NONE },
            { urlSign: 'hash3', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_LOW }
        ];
        const delta2 = tracker.getDelta(pass2);

        if (delta2.length !== 1 || delta2[0].urlSign !== 'hash3') {
            console.error(`❌ Second pass delta expected 1 item ('hash3'), got:`, delta2);
            failed = true;
        } else {
            console.log('✅ Passed: subsequent pass returns only new unseen items');
        }

        // Fallback key using originalTitle or how
        const pass3 = [
            { originalTitle: 'Title A', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_LOW },
            { how: 'Title B', what: 'converted', clickbaitiness: Clickbaitiness.LEVEL_LOW }
        ];
        const delta3 = tracker.getDelta(pass3);
        if (delta3.length !== 2) {
            console.error(`❌ Fallback keys failed, expected 2, got:`, delta3);
            failed = true;
        } else {
            console.log('✅ Passed: tracker properly falls back to originalTitle and how');
        }
    }

    if (failed) {
        console.error('\n❌ Some stats tests failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All stats tests passed successfully.');
    }
}

runStatsTests();
