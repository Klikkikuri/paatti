import { parseSemVer, sanitizeUrlForFeedback, canAppendSpan, getActiveTab, getCurrentTabHostname } from '../src/utils.js';

/**
 * Runs test cases for utility functions in src/utils.js.
 */
async function runUtilsTests() {
    console.log('Running utils verification tests...');
    let failed = false;

    const sanitizeTestCases = [
        {
            name: 'Strips utm_*, fbclid, ref, and session parameters while preserving valid content parameters',
            input: 'https://example.com/article?utm_source=twitter&utm_medium=social&id=123&fbclid=abc1234&ref=homepage&sid=sess99',
            expected: 'https://example.com/article?id=123'
        },
        {
            name: 'Leaves URLs without tracking parameters untouched',
            input: 'https://example.com/search?q=news&page=2',
            expected: 'https://example.com/search?q=news&page=2'
        },
        {
            name: 'Handles empty or invalid URL strings gracefully',
            input: 'not-a-valid-url',
            expected: 'not-a-valid-url'
        }
    ];

    console.log('\n--- sanitizeUrlForFeedback Tests ---');
    for (const tc of sanitizeTestCases) {
        const result = sanitizeUrlForFeedback(tc.input);
        if (result !== tc.expected) {
            console.error(`❌ Test failed: "${tc.name}"\n  Expected: ${tc.expected}\n  Got:      ${result}`);
            failed = true;
        } else {
            console.log(`✅ Passed: "${tc.name}"`);
        }
    }

    const semverTestCases = [
        {
            name: 'Parses 4-part version string like 0.1.2.3 into major, minor, patch components',
            input: '0.1.2.3',
            expected: { major: 0, minor: 1, patch: 2 }
        },
        {
            name: 'Parses standard 3-part version string 1.2.3',
            input: '1.2.3',
            expected: { major: 1, minor: 2, patch: 3 }
        },
        {
            name: 'Parses 2-part version string 1.2 with default patch level 0',
            input: '1.2',
            expected: { major: 1, minor: 2, patch: 0 }
        },
        {
            name: 'Returns null for non-numeric version string',
            input: 'invalid',
            expected: null
        },
        {
            name: 'Returns null for empty or non-string input',
            input: null,
            expected: null
        }
    ];

    console.log('\n--- parseSemVer Tests ---');
    for (const tc of semverTestCases) {
        const result = parseSemVer(tc.input);
        const passed = JSON.stringify(result) === JSON.stringify(tc.expected);
        if (!passed) {
            console.error(`❌ Test failed: "${tc.name}"\n  Expected: ${JSON.stringify(tc.expected)}\n  Got:      ${JSON.stringify(result)}`);
            failed = true;
        } else {
            console.log(`✅ Passed: "${tc.name}"`);
        }
    }

    console.log('\n--- canAppendSpan Tests ---');
    const canAppendSpanCases = [
        {
            name: 'Returns true for valid HTML element with replaceChildren',
            input: { nodeType: 1, tagName: 'H2', namespaceURI: 'http://www.w3.org/1999/xhtml', replaceChildren: () => {} },
            expected: true
        },
        {
            name: 'Returns false for SVG element',
            input: { nodeType: 1, tagName: 'text', namespaceURI: 'http://www.w3.org/2000/svg', replaceChildren: () => {} },
            expected: false
        },
        {
            name: 'Returns false for INPUT element',
            input: { nodeType: 1, tagName: 'INPUT', namespaceURI: 'http://www.w3.org/1999/xhtml', replaceChildren: () => {} },
            expected: false
        },
        {
            name: 'Returns false for null or non-element node',
            input: { nodeType: 3, tagName: '#text' },
            expected: false
        }
    ];

    for (const tc of canAppendSpanCases) {
        const result = canAppendSpan(tc.input);
        if (result !== tc.expected) {
            console.error(`❌ Test failed: "${tc.name}"\n  Expected: ${tc.expected}\n  Got:      ${result}`);
            failed = true;
        } else {
            console.log(`✅ Passed: "${tc.name}"`);
        }
    }

    console.log('\n--- getActiveTab & getCurrentTabHostname Tests ---');
    // Test desktop environment (currentWindow works)
    globalThis.browser = {
        tabs: {
            query: async (queryInfo) => {
                if (queryInfo.currentWindow) {
                    return [{ id: 1, url: 'https://www.hs.fi/kotimaa/art-12345.html' }];
                }
                return [{ id: 2, url: 'https://other.fi' }];
            }
        }
    };

    let tab = await getActiveTab();
    if (!tab || tab.id !== 1) {
        console.error('❌ Failed desktop getActiveTab test:', tab);
        failed = true;
    } else {
        console.log('✅ Passed: getActiveTab retrieves tab via currentWindow query');
    }

    let hostname = await getCurrentTabHostname();
    if (hostname !== 'www.hs.fi') {
        console.error('❌ Failed desktop getCurrentTabHostname test:', hostname);
        failed = true;
    } else {
        console.log('✅ Passed: getCurrentTabHostname extracts hostname from active tab');
    }

    // Test mobile/Android environment (currentWindow returns empty array, active query succeeds)
    globalThis.browser = {
        tabs: {
            query: async (queryInfo) => {
                if (queryInfo.currentWindow) {
                    return [];
                }
                if (queryInfo.active) {
                    return [{ id: 42, url: 'https://yle.fi/uutiset/18-1234' }];
                }
                return [];
            }
        }
    };

    tab = await getActiveTab();
    if (!tab || tab.id !== 42) {
        console.error('❌ Failed mobile getActiveTab fallback test:', tab);
        failed = true;
    } else {
        console.log('✅ Passed: getActiveTab falls back to active query when currentWindow is empty (Firefox Android)');
    }

    hostname = await getCurrentTabHostname();
    if (hostname !== 'yle.fi') {
        console.error('❌ Failed mobile getCurrentTabHostname fallback test:', hostname);
        failed = true;
    } else {
        console.log('✅ Passed: getCurrentTabHostname works with fallback query');
    }

    // Test tab without url or invalid url
    globalThis.browser = {
        tabs: {
            query: async () => [{ id: 99 }]
        }
    };
    hostname = await getCurrentTabHostname();
    if (hostname !== null) {
        console.error('❌ Expected null hostname for tab without URL, got:', hostname);
        failed = true;
    } else {
        console.log('✅ Passed: getCurrentTabHostname gracefully returns null when tab lacks URL');
    }

    // Test query error / no tabs
    globalThis.browser = {
        tabs: {
            query: async () => []
        }
    };
    tab = await getActiveTab();
    hostname = await getCurrentTabHostname();
    if (tab !== null || hostname !== null) {
        console.error('❌ Expected null for tab and hostname when query returns empty, got:', { tab, hostname });
        failed = true;
    } else {
        console.log('✅ Passed: returns null when no tabs match');
    }

    if (failed) {
        console.error('\n❌ Utils tests failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All utils tests passed successfully.');
        process.exit(0);
    }
}

await runUtilsTests();

