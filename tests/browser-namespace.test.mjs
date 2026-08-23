// Covers src/browser-api.js, whose `chrome` fallback no browser available here exercises:
// Chrome 148+ and Firefox both provide `browser` natively.
//
// Each case needs its own cache-busting specifier, because a module body runs once per
// specifier -- and its own reset, because globalThis is shared across the whole process.

let failed = false;

const check = (name, actual, expected) => {
    if (actual === expected) {
        console.log(`✅ Passed: ${name}`);
    } else {
        console.error(`❌ Failed: ${name}\n  Expected: ${expected}\n  Got:      ${actual}`);
        failed = true;
    }
};

const reset = () => {
    delete globalThis.browser;
    delete globalThis.chrome;
};

const native = { i18n: {} };
const cr = { i18n: {} };

// Prefers an existing browser namespace over chrome.
reset();
globalThis.browser = native;
globalThis.chrome = cr;
check('prefers the browser namespace', (await import('../src/browser-api.js?case=1')).default, native);

// Falls back to chrome on Chrome < 148, where browser is undefined.
reset();
globalThis.chrome = cr;
check('falls back to chrome', (await import('../src/browser-api.js?case=2')).default, cr);

// Outside a browser the export is undefined rather than a throw, so `browser?.x` stays safe.
reset();
check('resolves to undefined with neither global', (await import('../src/browser-api.js?case=3')).default, undefined);

console.log(failed ? '\n❌ browser-api tests failed' : '\n✅ All browser-api tests passed');
process.exit(failed ? 1 : 0);
