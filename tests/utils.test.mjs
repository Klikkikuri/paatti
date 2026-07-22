import { parseSemVer, sanitizeUrlForFeedback } from '../src/utils.js';

/**
 * Runs test cases for utility functions in src/utils.js.
 */
function runUtilsTests() {
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

    if (failed) {
        console.error('\n❌ Utils tests failed.');
        process.exit(1);
    } else {
        console.log('\n✅ All utils tests passed successfully.');
        process.exit(0);
    }
}

runUtilsTests();

