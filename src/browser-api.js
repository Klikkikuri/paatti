"use strict";

// Chrome < 148 has no `browser` namespace. Delete this file once minimum_chrome_version reaches 148
// and import the global directly; src/contentScript.js resolves the same fallback inline.
export default globalThis.browser ?? globalThis.chrome;
