import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const dom = installDom();
after(() => dom.teardown());

let caseNumber = 0;

/**
 * A realm that either accepts a constructable stylesheet or refuses one, and a fresh copy of the
 * module to meet it.
 *
 * The module remembers what the realm allowed, so each case imports its own copy through a distinct
 * query string -- the trick tests/browser-namespace.test.mjs uses.
 *
 * @param {boolean} adoptable - False stands in for a Firefox content script, which throws on assignment.
 */
async function realm(adoptable) {
    let constructed = 0;

    globalThis.CSSStyleSheet = class {
        constructor() { constructed++; }
        replaceSync() {}
    };

    /** A stand-in shadow root: enough of one to see which route the styles took. */
    const shadowRoot = () => {
        const node = {
            appended: [],
            appendChild(child) { this.appended.push(child); return child; }
        };
        Object.defineProperty(node, 'adoptedStyleSheets', {
            configurable: true,
            get() { return this._sheets ?? []; },
            set(sheets) {
                if (!adoptable) throw new Error('Accessing from Xray wrapper is not supported.');
                this._sheets = sheets;
            }
        });
        return node;
    };

    const { adoptBadgeStyles, BADGE_CSS } = await import(`../src/components/badge-style.js?case=${++caseNumber}`);
    return { adoptBadgeStyles, BADGE_CSS, shadowRoot, constructed: () => constructed };
}

describe('adoptBadgeStyles where a constructable sheet works', () => {
    test('parses one sheet and shares it with every badge', async () => {
        const { adoptBadgeStyles, shadowRoot, constructed } = await realm(true);

        const shadows = Array.from({ length: 5 }, shadowRoot);
        for (const shadow of shadows) adoptBadgeStyles(shadow);

        assert.equal(constructed(), 1, 'the sheet was parsed more than once');
        for (const shadow of shadows) {
            assert.equal(shadow.adoptedStyleSheets.length, 1);
            assert.deepEqual(shadow.appended, [], 'a <style> node was added as well as the sheet');
        }
        // All five share the one sheet, which is the point of a constructable one.
        assert.equal(new Set(shadows.map((s) => s.adoptedStyleSheets[0])).size, 1);
    });
});

describe('adoptBadgeStyles where the realm refuses one', () => {
    test('falls back to a <style> node carrying the same rules', async () => {
        const { adoptBadgeStyles, BADGE_CSS, shadowRoot } = await realm(false);

        const shadow = shadowRoot();
        adoptBadgeStyles(shadow);

        assert.equal(shadow.appended.length, 1);
        assert.equal(shadow.appended[0].tagName, 'STYLE');
        assert.equal(shadow.appended[0].textContent, BADGE_CSS);
    });

    test('asks the realm once, not once per badge', async () => {
        // A news page can carry dozens of badges. Retrying would parse a sheet and throw for each one.
        const { adoptBadgeStyles, shadowRoot, constructed } = await realm(false);

        const shadows = Array.from({ length: 12 }, shadowRoot);
        for (const shadow of shadows) adoptBadgeStyles(shadow);

        assert.equal(constructed(), 1, 'the refused sheet was rebuilt for later badges');
        for (const shadow of shadows) {
            assert.equal(shadow.appended.length, 1, 'a badge went without its styles');
        }
    });

    test('still styles a badge when the realm has no CSSStyleSheet at all', async () => {
        delete globalThis.CSSStyleSheet;
        const { adoptBadgeStyles, BADGE_CSS } = await import(`../src/components/badge-style.js?case=${++caseNumber}`);

        const shadow = { appended: [], appendChild(child) { this.appended.push(child); } };
        adoptBadgeStyles(shadow);

        assert.equal(shadow.appended[0].textContent, BADGE_CSS);
    });
});
