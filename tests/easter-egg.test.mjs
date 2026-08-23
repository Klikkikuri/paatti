const {
    shouldShowEasterEgg,
    dayKey,
    unitHash,
    specialDayMessageKey,
    SPECIAL_DAYS
} = await import('../src/options/easter-egg.js');

/**
 * The day keys of a run of consecutive days, from a local calendar date.
 * Day overflow is left to Date, which rolls the month and the year for us.
 *
 * @param {number} year
 * @param {number} monthIndex - 0..11, as Date takes it.
 * @param {number} day
 * @param {number} count
 * @returns {string[]}
 */
function dayKeysFrom(year, monthIndex, day, count) {
    const keys = [];
    for (let i = 0; i < count; i++) {
        keys.push(dayKey(new Date(year, monthIndex, day + i)));
    }

    return keys;
}

/**
 * Which of a run of days carry a sighting, as offsets from the first day.
 *
 * @param {string[]} keys - Day keys, from dayKeysFrom().
 * @param {string} salt - The install salt to hash with.
 * @param {number} probability
 * @returns {number[]}
 */
function hitOffsets(keys, salt, probability) {
    const hits = [];
    keys.forEach((key, index) => {
        if (shouldShowEasterEgg({ probability, roll: unitHash(`${salt}:${key}`) })) hits.push(index);
    });

    return hits;
}

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
    // <page-background> holds one roll for the whole day, so raising the probability
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

    // --- The day the roll is drawn for ---
    check('a day key is zero padded',
        dayKey(new Date(2026, 0, 5)), '2026-01-05');
    check('a day key is the local day late in the evening',
        dayKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
    check('a day key is the local day just after midnight',
        dayKey(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
    check('the last day of the year keeps its month',
        dayKey(new Date(2026, 11, 31)), '2026-12-31');

    // --- The hash behind the roll ---
    const salt = '3f1c8a52-0f3d-4a1e-9b7c-2d5e8f0a1b6c';
    const year = dayKeysFrom(2026, 0, 1, 365);
    const yearHashes = year.map((key) => unitHash(`${salt}:${key}`));

    check('every hash lands in [0, 1)',
        yearHashes.every((value) => value >= 0 && value < 1), true);
    check('the same key hashes to the same number twice over',
        unitHash(`${salt}:2026-03-01`), unitHash(`${salt}:2026-03-01`));
    check('two days hash to two numbers',
        unitHash(`${salt}:2026-03-01`) === unitHash(`${salt}:2026-03-02`), false);
    check('the same calendar date one year on hashes elsewhere',
        unitHash(`${salt}:2026-03-01`) === unitHash(`${salt}:2027-03-01`), false);

    // The avalanche finalizer earns its place here. Neighbouring day keys differ in
    // one character, and without the finalizer their hashes land beside each other,
    // which clumps the sightings. Independent draws sit 1/3 apart on average.
    let gapSum = 0;
    for (let i = 1; i < yearHashes.length; i++) {
        gapSum += Math.abs(yearHashes[i] - yearHashes[i - 1]);
    }
    const meanGap = gapSum / (yearHashes.length - 1);
    check('neighbouring days are not neighbours in [0, 1)', meanGap > 0.25, true);

    // --- The calendar the hash draws ---
    const decade = dayKeysFrom(2026, 0, 1, 3650);
    const decadeHits = hitOffsets(decade, salt, 0.05);
    check('one day in twenty over ten years, near enough',
        decadeHits.length >= 120 && decadeHits.length <= 240, true);

    const gaps = decadeHits.slice(1).map((offset, index) => offset - decadeHits[index]);
    check('the sighting days do not fall on a fixed period', new Set(gaps).size > 1, true);

    const otherSalt = 'b90e77d4-6c21-4f88-a0d3-7e519c4b2a80';
    check('another install gets another calendar',
        hitOffsets(decade, otherSalt, 0.05).join(',') === decadeHits.join(','), false);

    // --- The days that always show the artwork ---
    const expectedSpecialDays = [
        [2026, 2, 19, 'specialDayMinnaCanth'],
        [2026, 4, 3, 'specialDayPressFreedom'],
        [2026, 5, 15, 'specialDayMagnaCarta'],
        [2026, 5, 20, 'specialDayJaws'],
        [2026, 6, 10, 'specialDayKlikkikuri'],
        [2026, 6, 17, 'specialDayDemocracyDay'],
        [2026, 7, 14, 'specialDayJyu'],
        [2026, 9, 11, 'specialDayTaija'],
        [2026, 11, 2, 'specialDayPressAct'],
        [2026, 11, 4, 'specialDayJuho'],
        [2026, 11, 16, 'specialDayTeemu']
    ];
    for (const [_year, monthIndex, day, messageKey] of expectedSpecialDays) {
        check(`${day}.${monthIndex + 1}. is ${messageKey}`,
            specialDayMessageKey(new Date(2026, monthIndex, day)), messageKey);
        check(`${day}.${monthIndex + 1}. is still ${messageKey} five years on`,
            specialDayMessageKey(new Date(2031, monthIndex, day)), messageKey);
    }
    check('every special day is covered', expectedSpecialDays.length, Object.keys(SPECIAL_DAYS).length);

    for (const [monthIndex, day, description] of [
        [11, 15, '15.12., the day before Teemu'],
        [11, 17, '17.12., the day after Teemu'],
        [9, 10, '10.10., the day before Taija'],
        [9, 12, '12.10., the day after Taija'],
        [10, 10, '10.11., 10-11 read the other way round'],
        [2, 5, '5.3., 05-03 read the other way round'],
        [1, 7, '7.2., an ordinary day']
    ]) {
        check(`${description} is not special`,
            specialDayMessageKey(new Date(2026, monthIndex, day)), null);
    }

    // --- The calendar table itself ---
    const specialDayKeys = Object.keys(SPECIAL_DAYS);
    check('every key reads as MM-DD',
        specialDayKeys.every((key) => /^\d{2}-\d{2}$/.test(key)), true);
    check('every day names a message',
        Object.values(SPECIAL_DAYS).every((value) => typeof value === 'string' && value.length > 0), true);
    check('the table is in calendar order',
        specialDayKeys.join(','), [...specialDayKeys].sort().join(','));

    if (failed) {
        console.error('\n❌ Some easter egg tests failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All easter egg tests passed successfully.');
    }
}

runEasterEggTests();
