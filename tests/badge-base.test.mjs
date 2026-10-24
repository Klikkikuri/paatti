import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom, dispatchTrusted } from './helpers/dom.mjs';

const dom = installDom();

// Imported dynamically: badge-base.js parses its icons against `document`, so a static import would
// be hoisted above installDom() and run with none. Same rule as the component suites.
const { buildBadge, createBadgeClass, isUserActivation } = await import('../src/components/badge-base.js');
const aiBadge = await import('../src/components/klikkikuri-ai-badge.js');

after(() => dom.teardown());

const ICON = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11" fill="currentColor" />
</svg>
`;

/** A key the user pressed: a trusted event, as only the browser can dispatch. */
const pressKey = (target, type, key) =>
    dispatchTrusted(target, type, { key, bubbles: true, cancelable: true }, 'KeyboardEvent');

/** A badge as the content script builds one, with only what the caller passed. */
const build = (attrs = {}) => buildBadge({
    tagName: 'klikkikuri-test-badge',
    svgMarkup: ICON,
    defaultLabel: 'Test badge',
    ...attrs
});

describe('buildBadge', () => {
    test('builds a shadow root with the icon inside, without registering the tag', () => {
        const badge = build();

        assert.ok(badge.shadowRoot, 'no shadow root');
        assert.ok(badge.shadowRoot.querySelector('svg'), 'the icon is not in the shadow root');
        assert.equal(globalThis.customElements.get('klikkikuri-test-badge'), undefined,
            'the tag was registered, which is the thing this avoids');
    });

    test('puts the styles in the shadow root by whichever route the realm allows', () => {
        const badge = build();
        const shadow = badge.shadowRoot;

        // jsdom has no constructable stylesheets, so it takes the <style> path Firefox takes.
        const styled = (shadow.adoptedStyleSheets?.length > 0) || Boolean(shadow.querySelector('style'));
        assert.ok(styled, 'the badge carries no styles at all');
    });

    test('forces display and visibility inline, where a page rule cannot outrank it', () => {
        const badge = build();

        assert.equal(badge.style.getPropertyValue('display'), 'inline-flex');
        assert.equal(badge.style.getPropertyPriority('display'), 'important');
        // jsdom drops the priority from its `visibility` serialization, so the e2e proves the cascade.
        assert.equal(badge.style.getPropertyValue('visibility'), 'inherit');
    });

    test('labels the icon from label, falling back to tooltip and then the default', () => {
        const svgOf = (badge) => badge.shadowRoot.querySelector('svg');

        assert.equal(svgOf(build({ label: 'AI' })).getAttribute('aria-label'), 'AI');
        assert.equal(svgOf(build({ tooltip: 'Mostly video' })).getAttribute('aria-label'), 'Mostly video');
        assert.equal(svgOf(build()).getAttribute('aria-label'), 'Test badge');
    });

    test('carries the tooltip as an SVG title and as the host title attribute', () => {
        const badge = build({ tooltip: 'Paatti replaced this headline.' });

        assert.equal(badge.getAttribute('title'), 'Paatti replaced this headline.');
        assert.equal(badge.shadowRoot.querySelector('svg title').textContent, 'Paatti replaced this headline.');
    });

    test('without an action it is a picture: no role, no tab stop', () => {
        const badge = build({ label: 'AI' });

        assert.equal(badge.getAttribute('role'), null);
        assert.equal(badge.getAttribute('tabindex'), null);
        assert.equal(badge.shadowRoot.querySelector('svg').getAttribute('aria-hidden'), null);
    });

    test('with an action it is a button, named by the action, with the icon hidden from the tree', () => {
        const badge = build({ label: 'Converted', action: 'Converted headline feedback' });

        assert.equal(badge.getAttribute('role'), 'button');
        assert.equal(badge.getAttribute('tabindex'), '0');
        assert.equal(badge.getAttribute('aria-label'), 'Converted headline feedback');
        // The button carries the name; an image named again inside it would be read out twice.
        assert.equal(badge.shadowRoot.querySelector('svg').getAttribute('aria-hidden'), 'true');
    });

    test('Enter acts on the way down and Space on the way up, as a native button does', () => {
        for (const [type, key] of [['keydown', 'Enter'], ['keyup', ' ']]) {
            const badge = build({ action: 'Feedback' });
            let clicks = 0;
            badge.addEventListener('click', () => { clicks++; });

            pressKey(badge, type, key);
            assert.equal(clicks, 1, `${key} on ${type} did not activate the badge`);
        }
    });

    test('a held Space does not activate once per repeat', () => {
        const badge = build({ action: 'Feedback' });
        let clicks = 0;
        badge.addEventListener('click', () => { clicks++; });

        for (let i = 0; i < 5; i++) pressKey(badge, 'keydown', ' ');

        assert.equal(clicks, 0, 'a held Space activated the badge before release');
    });

    test('a badge that is not a button ignores the keyboard', () => {
        const badge = build({ label: 'AI' });
        let clicks = 0;
        badge.addEventListener('click', () => { clicks++; });

        pressKey(badge, 'keydown', 'Enter');
        pressKey(badge, 'keyup', ' ');

        assert.equal(clicks, 0);
    });

    test('ignores keys the page dispatches', () => {
        const badge = build({ action: 'Feedback' });
        let clicks = 0;
        badge.addEventListener('click', () => { clicks++; });

        badge.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        badge.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));

        assert.equal(clicks, 0, 'a synthetic key activated the badge');
    });

    test('refuses markup whose root is not in the SVG namespace', () => {
        // Without xmlns the markup still parses, into elements merely named "svg" that draw nothing.
        assert.throws(() => build({ svgMarkup: '<svg viewBox="0 0 24 24"><circle r="11" /></svg>' }), /xmlns/);
    });
});

describe('isUserActivation', () => {
    /** The verdict for each click the badge receives. */
    const verdicts = (badge) => {
        const seen = [];
        badge.addEventListener('click', (event) => seen.push(isUserActivation(event)));
        return seen;
    };

    test('accepts a trusted click', () => {
        const badge = build({ action: 'Feedback' });
        const seen = verdicts(badge);

        dispatchTrusted(badge, 'click', { bubbles: true }, 'MouseEvent');
        assert.deepEqual(seen, [true]);
    });

    test('accepts the click that a trusted Enter or Space dispatches', () => {
        for (const [type, key] of [['keydown', 'Enter'], ['keyup', ' ']]) {
            const badge = build({ action: 'Feedback' });
            const seen = verdicts(badge);

            pressKey(badge, type, key);
            assert.deepEqual(seen, [true], `${key} on ${type}`);
        }
    });

    test('refuses a click the page dispatches', () => {
        const badge = build({ action: 'Feedback' });
        const seen = verdicts(badge);

        badge.click();
        assert.deepEqual(seen, [false]);
    });

    test('refuses a page click on another badge during a keyboard activation', () => {
        const pressed = build({ action: 'Feedback' });
        const other = build({ action: 'Feedback' });
        const seen = verdicts(other);
        pressed.addEventListener('click', () => other.click());

        pressKey(pressed, 'keydown', 'Enter');
        assert.deepEqual(seen, [false]);
    });
});

describe('the badge modules', () => {
    test('carry their icon and label as data, and register nothing on import', () => {
        assert.match(aiBadge.svgMarkup, /<svg[\s>]/);
        assert.equal(typeof aiBadge.defaultLabel, 'string');
        assert.ok(aiBadge.defaultLabel.length > 0);
        assert.equal(typeof aiBadge.KlikkikuriAiBadge, 'function');

        // The content script reads the markup above without registering the tag: in Firefox the
        // isolated world has a registry, and an upgrade there would fight buildBadge.
        assert.equal(globalThis.customElements.get('klikkikuri-ai-badge'), undefined,
            'importing the badge module registered the tag');
    });

    test('the module data builds a badge through the same path the content script uses', () => {
        const badge = buildBadge({
            tagName: 'klikkikuri-ai-badge',
            svgMarkup: aiBadge.svgMarkup,
            defaultLabel: aiBadge.defaultLabel,
            label: 'AI'
        });

        assert.ok(badge.shadowRoot.querySelector('svg'), 'the real icon did not parse');
    });
});

describe('createBadgeClass, for the extension pages', () => {
    test('still produces a registrable element that dresses itself', () => {
        const Klass = createBadgeClass(ICON, 'Test badge');
        globalThis.customElements.define('klikkikuri-registered-badge', Klass);

        const badge = new Klass();
        assert.ok(badge.shadowRoot.querySelector('svg'), 'the registered badge has no icon');

        // Attribute observation is the thing only a registered element gets.
        document.body.appendChild(badge);
        assert.equal(badge.style.getPropertyValue('visibility'), 'inherit');
        badge.setAttribute('action', 'Feedback');
        assert.equal(badge.getAttribute('role'), 'button');
        badge.removeAttribute('action');
        assert.equal(badge.getAttribute('role'), null);
        badge.remove();
    });
});
