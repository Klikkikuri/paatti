const USE_WRAPPER = "Import the namespace: import browser from './browser-api.js'.";

export default [
    {
        files: ["src/**/*.js"],
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
];
