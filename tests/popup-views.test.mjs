/**
 * @file popup-views.test.mjs
 * Guards the popup view map against the markup: one container per view, and each selector matches it.
 *
 * A view container is found by its `data-view` attribute, not by a styling class, so a class rename
 * cannot make `showView` toggle the wrong element.
 */

import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { installDom } from './helpers/dom.mjs';
import { VIEW_SELECTORS, VIEW_LABELS } from '../src/options/views.js';

const POPUP_HTML = readFileSync(new URL('../src/options/popup.html', import.meta.url), 'utf8');

const dom = installDom({ html: POPUP_HTML });
after(() => dom.teardown());

describe('the popup view map matches the popup markup', () => {
    test('each selector matches exactly one container', () => {
        for (const [name, selector] of Object.entries(VIEW_SELECTORS)) {
            assert.equal(dom.document.querySelectorAll(selector).length, 1,
                `view '${name}' selector '${selector}'`);
        }
    });

    test('the markup declares exactly the views in the map', () => {
        const declared = [...dom.document.querySelectorAll('[data-view]')].map((element) => element.dataset.view);
        assert.deepEqual(declared.sort(), Object.keys(VIEW_SELECTORS).sort());
    });

    test('the selectors and the labels name the same views', () => {
        assert.deepEqual(Object.keys(VIEW_LABELS).sort(), Object.keys(VIEW_SELECTORS).sort());
    });
});
