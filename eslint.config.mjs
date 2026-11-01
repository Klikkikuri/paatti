const USE_WRAPPER = "Import the namespace: import browser from './browser-api.js'.";

export default [
    {
        // assets/non-oss/*/src/ is overlaid onto src/ by `make dist NON_OSS=1`, so those
        // files ship at src/ paths and need the same rules.
        files: ["src/**/*.js", "assets/non-oss/*/src/**/*.js"],
        languageOptions: { ecmaVersion: 2024, sourceType: "module" },
        rules: {
            "no-restricted-globals": [
                "error",
                { name: "browser", message: USE_WRAPPER },
                { name: "chrome", message: USE_WRAPPER },
            ],
            "no-restricted-properties": [
                "error",
                { object: "globalThis", property: "browser", message: USE_WRAPPER },
                { object: "globalThis", property: "chrome", message: USE_WRAPPER },
            ],
        },
    },
    {
        // The only two files allowed to resolve the namespace from the global.
        files: ["src/browser-api.js", "src/contentScript.js"],
        rules: { "no-restricted-properties": "off" },
    },
    {
        // The e2e harness and suites drive Chromium through Playwright. Their `page.evaluate` callbacks run in
        // the extension's own pages, so they reach the namespace the same way src/ does: through browser-api.js.
        // Node-side code in these files uses no namespace at all.
        files: ["tests/e2e/harness/**/*.mjs", "tests/e2e/*.test.mjs"],
        languageOptions: { ecmaVersion: 2024, sourceType: "module" },
        rules: {
            "no-restricted-globals": [
                "error",
                { name: "browser", message: USE_WRAPPER },
                { name: "chrome", message: USE_WRAPPER },
            ],
            "no-restricted-properties": [
                "error",
                { object: "globalThis", property: "browser", message: USE_WRAPPER },
                { object: "globalThis", property: "chrome", message: USE_WRAPPER },
            ],
        },
    },
];
