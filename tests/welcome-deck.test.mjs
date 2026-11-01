import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    SLIDES, clampIndex, createNavigator, flowIds, fragmentOf, indexOfFragment, modeOf, nextInFlow,
    previousInFlow, slideAtLine, slideIds,
} from '../src/options/welcome/deck.js';

const ALL_IDS = ['welcome', 'service', 'browser', 'strictness', 'markers', 'sites', 'popup', 'wrong', 'ready'];

/** The quick flow of the real deck: the cover and the four setup steps. */
const QUICK_FLOW = [0, 3, 4, 5, 8];

/** The tour flow of the real deck: every slide. */
const TOUR_FLOW = [0, 1, 2, 3, 4, 5, 6, 7, 8];

describe('slideIds', () => {
    test('names every slide, in document order', () => {
        assert.deepEqual(slideIds(), ALL_IDS);
        assert.deepEqual(slideIds(), SLIDES.map(({ id }) => id));
    });
});

describe('flowIds', () => {
    test('the quick flow is the cover and the four setup steps', () => {
        assert.deepEqual(flowIds('quick'), ['welcome', 'strictness', 'markers', 'sites', 'ready']);
    });

    test('the quick flow leaves out every tour-only slide', () => {
        const tourOnly = SLIDES.filter((slide) => slide.tourOnly).map(({ id }) => id);
        assert.deepEqual(tourOnly, ['service', 'browser', 'popup', 'wrong']);
        assert.equal(flowIds('quick').some((id) => tourOnly.includes(id)), false);
    });

    test('the tour flow is every slide, in order', () => {
        assert.deepEqual(flowIds('tour'), slideIds());
        assert.equal(flowIds('tour').length, 9);
    });

    test('an unknown mode is the quick flow', () => {
        assert.deepEqual(flowIds('evil'), flowIds('quick'));
    });
});

describe('modeOf', () => {
    const CASES = [
        ['?mode=tour', 'tour'],
        ['?mode=quick', 'quick'],
        ['', 'quick'],
        ['?mode=evil', 'quick'],
        ['?other=1&mode=tour', 'tour'],
    ];

    for (const [search, expected] of CASES) {
        test(`${JSON.stringify(search)} is ${expected}`, () => assert.equal(modeOf(search), expected));
    }
});

describe('clampIndex', () => {
    const CASES = [
        [-3, 0],
        [99, 8],
        [4, 4],
        [0, 0],
        [8, 8],
    ];

    for (const [index, expected] of CASES) {
        test(`${index} is ${expected} in a deck of nine`, () => assert.equal(clampIndex(9, index), expected));
    }
});

describe('indexOfFragment', () => {
    test('finds the slide that the fragment names', () => {
        assert.equal(indexOfFragment(ALL_IDS, '#slide-sites'), 5);
    });

    test('an address that names no slide is -1', () => {
        for (const hash of ['', '#', '#slide-', '#sites', '#slide-nope']) {
            assert.equal(indexOfFragment(ALL_IDS, hash), -1, JSON.stringify(hash));
        }
    });
});

describe('fragmentOf', () => {
    test('builds the fragment from the id', () => {
        assert.equal(fragmentOf(ALL_IDS, 5), '#slide-sites');
    });

    test('is the inverse of indexOfFragment for every slide', () => {
        ALL_IDS.forEach((id, index) => {
            assert.equal(indexOfFragment(ALL_IDS, fragmentOf(ALL_IDS, index)), index, id);
        });
    });
});

describe('nextInFlow and previousInFlow', () => {
    // [flow, current deck index, next, previous]
    const CASES = [
        [QUICK_FLOW, 0, 3, null],
        [QUICK_FLOW, 1, 3, 0],
        [QUICK_FLOW, 3, 4, 0],
        [QUICK_FLOW, 4, 5, 3],
        [QUICK_FLOW, 5, 8, 4],
        [QUICK_FLOW, 6, 8, 5],
        [QUICK_FLOW, 7, 8, 5],
        [QUICK_FLOW, 8, null, 5],
        [TOUR_FLOW, 0, 1, null],
        [TOUR_FLOW, 4, 5, 3],
        [TOUR_FLOW, 8, null, 7],
    ];

    for (const [flow, index, next, previous] of CASES) {
        test(`in a flow of ${flow.length}, index ${index} goes to ${next} and back to ${previous}`, () => {
            assert.equal(nextInFlow(flow, index), next);
            assert.equal(previousInFlow(flow, index), previous);
        });
    }
});

describe('slideAtLine', () => {
    const TALL = [{ top: -900, bottom: -100 }, { top: -100, bottom: 1500 }, { top: 1500, bottom: 2300 }];

    test('a slide taller than the viewport is current while it covers the line', () => {
        assert.equal(slideAtLine(TALL, 400), 1);
    });

    test('a slide whose bottom edge is on the line is already over', () => {
        assert.equal(slideAtLine(TALL, 1500), 2);
    });

    test('nothing covers the line', () => {
        assert.equal(slideAtLine(TALL, 5000), -1);
    });
});

describe('createNavigator', () => {
    const make = (options = {}) => {
        const changes = [];
        const cursor = createNavigator({ count: 4, onChange: (index) => changes.push(index), ...options });
        return { cursor, changes };
    };

    test('starts on the first slide, without a call', () => {
        const { cursor, changes } = make({ initial: 0 });
        assert.equal(cursor.index, 0);
        assert.deepEqual(changes, []);
    });

    test('starts on the slide of the address, without a call', () => {
        const { cursor, changes } = make({ initial: 3 });
        assert.equal(cursor.index, 3);
        assert.deepEqual(changes, []);
    });

    test('a start outside the deck stops at the last slide', () => {
        const { cursor } = make({ initial: 99 });
        assert.equal(cursor.index, 3);
    });

    test('a request sets the index at once and returns it', () => {
        const { cursor, changes } = make();
        assert.equal(cursor.request(2), 2);
        assert.equal(cursor.index, 2);
        assert.deepEqual(changes, [2]);
    });

    test('a request stops at the ends', () => {
        const { cursor } = make();
        assert.equal(cursor.request(9), 3);
        assert.equal(cursor.request(-3), 0);
    });

    test('the slides that a move scrolls past do not become current', () => {
        const { cursor, changes } = make();
        cursor.request(3);
        cursor.scrolled(1);
        cursor.scrolled(2);
        assert.deepEqual(changes, [3]);
    });

    test('rapid requests end on the last one', () => {
        const { cursor, changes } = make();
        cursor.request(1);
        cursor.request(2);
        cursor.request(3);
        cursor.scrolled(1);
        assert.equal(cursor.index, 3);
        assert.deepEqual(changes, [1, 2, 3]);
    });

    test('after the move settles, the scroll position leads again', () => {
        const { cursor, changes } = make();
        cursor.request(2);
        cursor.settled();
        cursor.scrolled(1);
        assert.equal(cursor.index, 1);
        assert.deepEqual(changes, [2, 1]);
    });

    test('a position with no slide is ignored', () => {
        const { cursor, changes } = make();
        cursor.scrolled(-1);
        assert.deepEqual(changes, []);
    });

    test('the same index is not reported twice', () => {
        const { cursor, changes } = make();
        cursor.scrolled(1);
        cursor.scrolled(1);
        assert.deepEqual(changes, [1]);
    });
});
