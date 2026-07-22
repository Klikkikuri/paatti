import { sanitizeUrlForFeedback } from '../src/utils.js';

function runUtilsTests() {
    console.log('Running utils verification tests...');
    let failed = false;

    const testCases = [
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

    for (const tc of testCases) {
        const result = sanitizeUrlForFeedback(tc.input);
        if (result !== tc.expected) {
            console.error(`❌ Test failed: "${tc.name}"\n  Expected: ${tc.expected}\n  Got:      ${result}`);
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
