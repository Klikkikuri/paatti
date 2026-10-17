import test, { describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './helpers/dom.mjs';
import { createFakeBrowser } from './helpers/fake-browser.mjs';

const dom = installDom({ html: '<!doctype html><a data-doc="docs/providers.md" href="https://example.invalid/">(?)</a>' });
const fake = createFakeBrowser();
globalThis.browser = fake.browser;
after(() => dom.teardown());

const { displayProductInfo } = await import('../src/options/utils.js');

describe('displayProductInfo points a documentation link at the release tag', () => {
    const cases = [
        { name: 'a store version drops the store revision', version: '0.0.10.1', tag: 'v0.0.10' },
        { name: 'a release version is the tag', version: '0.0.11', tag: 'v0.0.11' },
    ];
    for (const { name, version, tag } of cases) {
        test(name, () => {
            fake.browser.runtime.getManifest = () => ({ name: 'Klikkikuri Paatti', version });

            displayProductInfo();

            assert.equal(document.querySelector('a[data-doc]').href,
                `https://github.com/Klikkikuri/paatti/blob/${tag}/docs/providers.md`);
        });
    }
});
