const { shouldShowEasterEgg } = await import('../src/options/easter-egg.js');

/**
 * Runs unit tests for the easter egg rule in src/options/easter-egg.js.
 */
function runEasterEggTests() {
    console.log('Running easter egg rule verification tests...');
    let failed = false;

    const check = (description, actual, expected) => {
        if (actual !== expected) {
            console.error(`❌ ${description}: expected ${expected}, got ${actual}`);
            failed = true;
        } else {
            console.log(`✅ Passed: ${description}`);
        }
    };

    // --- Theme gate ---
    check('light theme never shows the egg, whatever the roll',
        shouldShowEasterEgg({ isDark: false, probability: 1, roll: 0 }), false);

    // --- The roll itself ---
    check('a roll below the probability shows the egg',
        shouldShowEasterEgg({ isDark: true, probability: 0.05, roll: 0.04 }), true);
    check('a roll on the probability does not',
        shouldShowEasterEgg({ isDark: true, probability: 0.05, roll: 0.05 }), false);
    check('a roll above the probability does not',
        shouldShowEasterEgg({ isDark: true, probability: 0.05, roll: 0.9 }), false);

    // --- The two ends of the dev slider ---
    check('0 never shows the egg',
        shouldShowEasterEgg({ isDark: true, probability: 0, roll: 0 }), false);
    check('1 always shows the egg',
        shouldShowEasterEgg({ isDark: true, probability: 1, roll: 0.999999 }), true);

    // --- Unusable stored values ---
    for (const probability of [undefined, null, NaN, 'many', -1]) {
        check(`probability ${String(probability)} shows nothing`,
            shouldShowEasterEgg({ isDark: true, probability, roll: 0 }), false);
    }

    if (failed) {
        console.error('\n❌ Some easter egg tests failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All easter egg tests passed successfully.');
    }
}

runEasterEggTests();
