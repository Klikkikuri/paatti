import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { SLIDES, buildDeck, modeOf, slideAtLine, createNavigator } from '../src/options/welcome/deck.js';

const ids = (deck) => deck.map((slide) => slide.id);

describe('buildDeck', () => {
    test('quick mode has four slides, and ends with the conclusion', () => {
        assert.deepEqual(ids(buildDeck('quick')), ['strictness', 'markers', 'sites', 'ready']);
    });

    test('the quick deck does not get the welcome step', () => {
        assert.equal(ids(buildDeck('quick')).includes('welcome'), false);
    });

    test('tour mode has all nine, in order', () => {
        assert.deepEqual(ids(buildDeck('tour')), ['welcome', 'service', 'browser', 'strictness', 'markers', 'sites', 'popup', 'wrong', 'ready']);
        assert.deepEqual(ids(buildDeck('tour')), ids(SLIDES));
    });

    test('the tour opens with the welcome step and how it works, and puts the popup and the mistakes between the sites and the end', () => {
        assert.equal(ids(buildDeck('tour'))[0], 'welcome');
        assert.deepEqual(ids(buildDeck('tour')).slice(1, 3), ['service', 'browser']);
        assert.deepEqual(ids(buildDeck('tour')).slice(6, 8), ['popup', 'wrong']);
    });

    test('an unknown mode is the quick deck', () => {
        assert.deepEqual(buildDeck('anything'), buildDeck('quick'));
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
    const make = (count = 4) => {
        const changes = [];
        const navigator = createNavigator({ count, onChange: (index) => changes.push(index) });
        return { navigator, changes };
    };

    test('starts on the first slide, without a call', () => {
        const { navigator, changes } = make();
        assert.equal(navigator.index, 0);
        assert.deepEqual(changes, []);
    });

    test('a request sets the index at once and returns it', () => {
        const { navigator, changes } = make();
        assert.equal(navigator.request(2), 2);
        assert.equal(navigator.index, 2);
        assert.deepEqual(changes, [2]);
    });

    test('a request stops at the ends', () => {
        const { navigator } = make(4);
        assert.equal(navigator.request(9), 3);
        assert.equal(navigator.request(-3), 0);
    });

    test('the slides that a move scrolls past do not become current', () => {
        const { navigator, changes } = make();
        navigator.request(3);
        navigator.scrolled(1);
        navigator.scrolled(2);
        assert.deepEqual(changes, [3]);
    });

    test('rapid requests end on the last one', () => {
        const { navigator, changes } = make();
        navigator.request(1);
        navigator.request(2);
        navigator.request(3);
        navigator.scrolled(1);
        assert.equal(navigator.index, 3);
        assert.deepEqual(changes, [1, 2, 3]);
    });

    test('after the move settles, the scroll position leads again', () => {
        const { navigator, changes } = make();
        navigator.request(2);
        navigator.settled();
        navigator.scrolled(1);
        assert.equal(navigator.index, 1);
        assert.deepEqual(changes, [2, 1]);
    });

    test('a position with no slide is ignored', () => {
        const { navigator, changes } = make();
        navigator.scrolled(-1);
        assert.deepEqual(changes, []);
    });

    test('the same index is not reported twice', () => {
        const { navigator, changes } = make();
        navigator.scrolled(1);
        navigator.scrolled(1);
        assert.deepEqual(changes, [1]);
    });
});
