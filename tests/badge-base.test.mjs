import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';

const dom = installDom();

// Imported dynamically: badge-base.js parses its icons against `document`, so a static import would
// be hoisted above installDom() and run with none. Same rule as the component suites.
const { buildBadge, createBadgeClass } = await import('../src/components/badge-base.js');
const aiBadge = await import('../src/components/klikkikuri-ai-badge.js');

after(() => dom.teardown());

const ICON = `
<svg xmlns="http://www.w3.org/2000/svg" class="badge-icon" role="img" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="11" fill="currentColor" />
</svg>
`;

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

    test('forces display inline-flex inline, where a page rule cannot outrank it', () => {
        assert.equal(build().style.getPropertyValue('display'), 'inline-flex');
        assert.equal(build().style.getPropertyPriority('display'), 'important');
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

            badge.dispatchEvent(new dom.window.KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
            assert.equal(clicks, 1, `${key} on ${type} did not activate the badge`);
        }
    });

    test('a held Space does not activate once per repeat', () => {
        const badge = build({ action: 'Feedback' });
        let clicks = 0;
        badge.addEventListener('click', () => { clicks++; });

        for (let i = 0; i < 5; i++) {
            badge.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        }

        assert.equal(clicks, 0, 'a held Space activated the badge before release');
    });

    test('a badge that is not a button ignores the keyboard', () => {
        const badge = build({ label: 'AI' });
        let clicks = 0;
        badge.addEventListener('click', () => { clicks++; });

        badge.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        badge.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));

        assert.equal(clicks, 0);
    });

    test('refuses markup whose root is not in the SVG namespace', () => {
        // Without xmlns the markup still parses, into elements merely named "svg" that draw nothing.
        assert.throws(() => build({ svgMarkup: '<svg viewBox="0 0 24 24"><circle r="11" /></svg>' }), /xmlns/);
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
        badge.setAttribute('action', 'Feedback');
        assert.equal(badge.getAttribute('role'), 'button');
        badge.removeAttribute('action');
        assert.equal(badge.getAttribute('role'), null);
        badge.remove();
    });
});
