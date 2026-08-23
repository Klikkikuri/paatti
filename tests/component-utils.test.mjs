import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom();
globalThis.browser = createFakeBrowser({
    messages: {
        settingSavedSuccess: 'Saved!',
        settingSavedError: 'Could not save',
        customSaved: 'Custom saved',
    },
}).browser;

const { ComponentBase, defineComponent, emitSettingSaved } =
    await import('../src/options/components/component-utils.js');
const { settingSavedDetail } = await import('../src/options/components/setting-message.js');

after(() => dom.teardown());

describe('ComponentBase ties teardown to the connection', () => {
    /** A component that records what it did, so the base's behaviour is observable. */
    class Probe extends ComponentBase {
        connects = 0;
        teardowns = 0;
        clicks = 0;

        onConnect() {
            this.connects += 1;
            this.addTeardown(() => { this.teardowns += 1; });
            this.addEventListener('ping', () => { this.clicks += 1; }, { signal: this.signal });
        }
    }
    defineComponent('probe-element', Probe);

    const attach = () => {
        const el = document.createElement('probe-element');
        document.body.append(el);
        return el;
    };

    test('onConnect runs on attach, teardown on detach', () => {
        const el = attach();
        assert.equal(el.connects, 1);
        assert.equal(el.teardowns, 0);

        el.remove();
        assert.equal(el.teardowns, 1);
    });

    test('listeners registered with the signal stop firing after detach', () => {
        const el = attach();
        el.dispatchEvent(new CustomEvent('ping'));
        assert.equal(el.clicks, 1);

        el.remove();
        el.dispatchEvent(new CustomEvent('ping'));
        assert.equal(el.clicks, 1, 'the listener must be gone, not merely idle');
    });

    test('a re-attached element subscribes again', () => {
        const el = attach();
        el.remove();

        document.body.append(el);
        assert.equal(el.connects, 2);

        el.dispatchEvent(new CustomEvent('ping'));
        assert.equal(el.clicks, 1, 'the second connection wired a working listener');

        el.remove();
        assert.equal(el.teardowns, 2, 'each connection tears down exactly once');
    });

    test('a teardown added while detached runs at once, rather than leaking', () => {
        const el = attach();
        el.remove();

        let ran = 0;
        el.addTeardown(() => { ran += 1; });
        assert.equal(ran, 1, 'the signal is already aborted, so the callback fires immediately');
    });

    test('signal is an aborted signal when detached, never null', () => {
        const el = document.createElement('probe-element');
        assert.equal(el.signal.aborted, true);
    });
});

describe('defineComponent guards a taken tag', () => {
    test('the second registration of a tag is ignored', () => {
        class First extends HTMLElement {}
        class Second extends HTMLElement {}

        defineComponent('guarded-element', First);
        assert.doesNotThrow(() => defineComponent('guarded-element', Second));
        assert.equal(customElements.get('guarded-element'), First, 'the first definition wins');
    });
});

describe('settingSavedDetail resolves the message', () => {
    test('success uses the shared default', () => {
        assert.deepEqual(settingSavedDetail({ key: 'k', value: true }),
            { key: 'k', value: true, success: true, message: 'Saved!' });
    });

    test('failure uses the shared error default', () => {
        assert.deepEqual(settingSavedDetail({ key: 'k', value: false, success: false }),
            { key: 'k', value: false, success: false, message: 'Could not save' });
    });

    test('an explicit messageKey overrides the default', () => {
        assert.equal(settingSavedDetail({ key: 'k', value: 1, messageKey: 'customSaved' }).message,
            'Custom saved');
    });

    test('an untranslated key falls back to the supplied text', () => {
        assert.equal(
            settingSavedDetail({ key: 'k', value: 1, messageKey: 'missingKey', fallback: 'Plan B' }).message,
            'Plan B');
    });
});

describe('emitSettingSaved dispatches a bubbling event', () => {
    test('the detail reaches a listener on the document', () => {
        const host = document.createElement('div');
        document.body.append(host);

        const seen = [];
        document.addEventListener('setting-saved', (e) => seen.push(e.detail));
        emitSettingSaved(host, { key: 'enabled', value: true });

        assert.deepEqual(seen, [{ key: 'enabled', value: true, success: true, message: 'Saved!' }]);
        host.remove();
    });
});
