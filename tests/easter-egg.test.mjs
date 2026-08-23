import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

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

const salt = '3f1c8a52-0f3d-4a1e-9b7c-2d5e8f0a1b6c';

describe('the roll itself', () => {
    test('a roll below the probability shows the egg', () => {
        assert.equal(shouldShowEasterEgg({ probability: 0.05, roll: 0.04 }), true);
    });

    test('a roll on the probability does not', () => {
        assert.equal(shouldShowEasterEgg({ probability: 0.05, roll: 0.05 }), false);
    });

    test('a roll above the probability does not', () => {
        assert.equal(shouldShowEasterEgg({ probability: 0.05, roll: 0.9 }), false);
    });

    test('0 never shows the egg', () => {
        assert.equal(shouldShowEasterEgg({ probability: 0, roll: 0 }), false);
    });

    test('1 always shows the egg', () => {
        assert.equal(shouldShowEasterEgg({ probability: 1, roll: 0.999999 }), true);
    });

    for (const probability of [undefined, null, NaN, 'many', -1]) {
        test(`an unusable probability ${String(probability)} shows nothing`, () => {
            assert.equal(shouldShowEasterEgg({ probability, roll: 0 }), false);
        });
    }
});

describe('one held roll gives a plain threshold', () => {
    // <page-background> holds one roll for the whole day, so raising the probability
    // may reveal the artwork but must never clear a sighting off the screen.
    const roll = 0.42;

    test('raising the probability against one held roll never hides the egg', () => {
        let wasShown = false;
        for (let probability = 0; probability <= 1.0001; probability += 0.01) {
            const shown = shouldShowEasterEgg({ probability, roll });
            assert.ok(!(wasShown && !shown), `hidden again at probability ${probability}`);
            wasShown = shown;
        }
    });

    test('the held roll is the threshold: below it, nothing shows', () => {
        assert.equal(shouldShowEasterEgg({ probability: roll, roll }), false);
    });

    test('the held roll is the threshold: just above it, the egg shows', () => {
        assert.equal(shouldShowEasterEgg({ probability: roll + Number.EPSILON, roll }), true);
    });

    test('asking twice over gives the same answer', () => {
        assert.equal(
            shouldShowEasterEgg({ probability: 0.5, roll }),
            shouldShowEasterEgg({ probability: 0.5, roll })
        );
    });
});

describe('the day the roll is drawn for', () => {
    test('a day key is zero padded', () => {
        assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
    });

    test('a day key is the local day late in the evening', () => {
        assert.equal(dayKey(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
    });

    test('a day key is the local day just after midnight', () => {
        assert.equal(dayKey(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
    });

    test('the last day of the year keeps its month', () => {
        assert.equal(dayKey(new Date(2026, 11, 31)), '2026-12-31');
    });
});

describe('the hash behind the roll', () => {
    const yearHashes = dayKeysFrom(2026, 0, 1, 365).map((key) => unitHash(`${salt}:${key}`));

    test('every hash lands in [0, 1)', () => {
        assert.ok(yearHashes.every((value) => value >= 0 && value < 1));
    });

    test('the same key hashes to the same number twice over', () => {
        assert.equal(unitHash(`${salt}:2026-03-01`), unitHash(`${salt}:2026-03-01`));
    });

    test('two days hash to two numbers', () => {
        assert.notEqual(unitHash(`${salt}:2026-03-01`), unitHash(`${salt}:2026-03-02`));
    });

    test('the same calendar date one year on hashes elsewhere', () => {
        assert.notEqual(unitHash(`${salt}:2026-03-01`), unitHash(`${salt}:2027-03-01`));
    });

    test('neighbouring days are not neighbours in [0, 1)', () => {
        // The avalanche finalizer earns its place here. Neighbouring day keys differ in
        // one character, and without the finalizer their hashes land beside each other,
        // which clumps the sightings. Independent draws sit 1/3 apart on average.
        let gapSum = 0;
        for (let i = 1; i < yearHashes.length; i++) {
            gapSum += Math.abs(yearHashes[i] - yearHashes[i - 1]);
        }

        assert.ok(gapSum / (yearHashes.length - 1) > 0.25);
    });
});

describe('the calendar the hash draws', () => {
    const decade = dayKeysFrom(2026, 0, 1, 3650);
    const decadeHits = hitOffsets(decade, salt, 0.05);

    test('one day in twenty over ten years, near enough', () => {
        assert.ok(decadeHits.length >= 120 && decadeHits.length <= 240, `got ${decadeHits.length}`);
    });

    test('the sighting days do not fall on a fixed period', () => {
        const gaps = decadeHits.slice(1).map((offset, index) => offset - decadeHits[index]);
        assert.ok(new Set(gaps).size > 1);
    });

    test('another install gets another calendar', () => {
        const otherSalt = 'b90e77d4-6c21-4f88-a0d3-7e519c4b2a80';
        assert.notEqual(hitOffsets(decade, otherSalt, 0.05).join(','), decadeHits.join(','));
    });
});

describe('the days that always show the artwork', () => {
    const expectedSpecialDays = [
        [2, 19, 'specialDayMinnaCanth'],
        [4, 3, 'specialDayPressFreedom'],
        [5, 15, 'specialDayMagnaCarta'],
        [5, 20, 'specialDayJaws'],
        [6, 10, 'specialDayKlikkikuri'],
        [6, 17, 'specialDayDemocracyDay'],
        [7, 14, 'specialDayJyu'],
        [9, 11, 'specialDayTaija'],
        [11, 2, 'specialDayPressAct'],
        [11, 4, 'specialDayJuho'],
        [11, 16, 'specialDayTeemu']
    ];

    for (const [monthIndex, day, messageKey] of expectedSpecialDays) {
        test(`${day}.${monthIndex + 1}. is ${messageKey}`, () => {
            assert.equal(specialDayMessageKey(new Date(2026, monthIndex, day)), messageKey);
        });

        test(`${day}.${monthIndex + 1}. is still ${messageKey} five years on`, () => {
            assert.equal(specialDayMessageKey(new Date(2031, monthIndex, day)), messageKey);
        });
    }

    test('every special day is covered', () => {
        assert.equal(expectedSpecialDays.length, Object.keys(SPECIAL_DAYS).length);
    });

    for (const [monthIndex, day, description] of [
        [11, 15, '15.12., the day before Teemu'],
        [11, 17, '17.12., the day after Teemu'],
        [9, 10, '10.10., the day before Taija'],
        [9, 12, '12.10., the day after Taija'],
        [10, 10, '10.11., 10-11 read the other way round'],
        [2, 5, '5.3., 05-03 read the other way round'],
        [1, 7, '7.2., an ordinary day']
    ]) {
        test(`${description} is not special`, () => {
            assert.equal(specialDayMessageKey(new Date(2026, monthIndex, day)), null);
        });
    }
});

describe('the calendar table itself', () => {
    const specialDayKeys = Object.keys(SPECIAL_DAYS);

    test('every key reads as MM-DD', () => {
        assert.ok(specialDayKeys.every((key) => /^\d{2}-\d{2}$/.test(key)));
    });

    test('every day names a message', () => {
        assert.ok(Object.values(SPECIAL_DAYS).every((value) => typeof value === 'string' && value.length > 0));
    });

    test('the table is in calendar order', () => {
        assert.deepEqual(specialDayKeys, [...specialDayKeys].sort());
    });
});
