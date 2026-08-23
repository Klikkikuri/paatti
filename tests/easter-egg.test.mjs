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

    // --- The roll itself ---
    check('a roll below the probability shows the egg',
        shouldShowEasterEgg({ probability: 0.05, roll: 0.04 }), true);
    check('a roll on the probability does not',
        shouldShowEasterEgg({ probability: 0.05, roll: 0.05 }), false);
    check('a roll above the probability does not',
        shouldShowEasterEgg({ probability: 0.05, roll: 0.9 }), false);

    // --- The two ends of the dev slider ---
    check('0 never shows the egg',
        shouldShowEasterEgg({ probability: 0, roll: 0 }), false);
    check('1 always shows the egg',
        shouldShowEasterEgg({ probability: 1, roll: 0.999999 }), true);

    // --- Unusable stored values ---
    for (const probability of [undefined, null, NaN, 'many', -1]) {
        check(`probability ${String(probability)} shows nothing`,
            shouldShowEasterEgg({ probability, roll: 0 }), false);
    }

    // --- One held roll gives a plain threshold ---
    // <page-background> draws its roll once and keeps it, so raising the probability
    // may reveal the artwork but must never clear a sighting off the screen.
    const roll = 0.42;
    let wasShown = false;
    let regressed = false;
    for (let probability = 0; probability <= 1.0001; probability += 0.01) {
        const shown = shouldShowEasterEgg({ probability, roll });
        if (wasShown && !shown) regressed = true;
        wasShown = shown;
    }
    check('raising the probability against one held roll never hides the egg', regressed, false);
    check('the held roll is the threshold: below it, nothing shows',
        shouldShowEasterEgg({ probability: roll, roll }), false);
    check('the held roll is the threshold: just above it, the egg shows',
        shouldShowEasterEgg({ probability: roll + Number.EPSILON, roll }), true);
    check('asking twice over gives the same answer',
        shouldShowEasterEgg({ probability: 0.5, roll }), shouldShowEasterEgg({ probability: 0.5, roll }));

    if (failed) {
        console.error('\n❌ Some easter egg tests failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All easter egg tests passed successfully.');
    }
}

runEasterEggTests();
