import test from 'node:test';
import assert from 'node:assert/strict';

// Covers src/browser-api.js, whose `chrome` fallback no browser available here exercises:
// Chrome 148+ and Firefox both provide `browser` natively. This is the one suite allowed to
// mock globalThis.chrome -- see AGENTS.md.
//
// Each case needs its own cache-busting specifier, because a module body runs once per
// specifier -- and its own reset, because globalThis is shared across the whole process.

const native = { i18n: {} };
const cr = { i18n: {} };

const reset = () => {
    delete globalThis.browser;
    delete globalThis.chrome;
};

test('prefers the browser namespace', async () => {
    reset();
    globalThis.browser = native;
    globalThis.chrome = cr;

    assert.equal((await import('../src/browser-api.js?case=1')).default, native);
});

test('falls back to chrome on Chrome < 148, where browser is undefined', async () => {
    reset();
    globalThis.chrome = cr;

    assert.equal((await import('../src/browser-api.js?case=2')).default, cr);
});

test('resolves to undefined with neither global, so `browser?.x` stays safe', async () => {
    reset();

    assert.equal((await import('../src/browser-api.js?case=3')).default, undefined);
});
