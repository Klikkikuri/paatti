// Mock browser API globally before dynamically importing rahti.js
let mockStorageData = {};

const mockBrowser = {
  storage: {
    local: {
      get: async (keys) => {
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) {
            res[k] = mockStorageData[k];
          }
          return res;
        }
        if (typeof keys === 'string') {
          return { [keys]: mockStorageData[keys] };
        }
        return mockStorageData;
      },
      set: async (items) => {
        Object.assign(mockStorageData, items);
      },
      remove: async (keys) => {
        const keysArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keysArr) {
          delete mockStorageData[k];
        }
      }
    },
    sync: {
      get: async () => ({})
    },
    onChanged: {
      addListener: () => {}
    }
  }
};

globalThis.browser = mockBrowser;

async function runRahtiTests() {
  console.log('Running rahti retry wrapper verification tests...');
  let failed = false;

  // Dynamically import rahti.js after globalThis.browser is set up
  const { fetchRahtiData, fetchRahtiDataWithRetry } = await import('../src/rahti.js');

  // Test 1: fetchRahtiDataWithRetry retries on initial failures and succeeds when a retry works
  console.log('\n--- fetchRahtiDataWithRetry Success after Retry Test ---');
  mockStorageData = {};
  let fetchAttempts = 0;
  globalThis.fetch = async (url) => {
    fetchAttempts++;
    if (fetchAttempts < 2) {
      throw new Error('Simulated network offline during wake-up');
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([
        ['ETag', '"test-etag"'],
        ['Last-Modified', 'Sun, 26 Jul 2026 12:00:00 GMT']
      ]),
      json: async () => ({
        status: 'ok',
        schema_version: '0.1.0',
        updated: '2026-07-26T12:00:00Z',
        entries: [
          {
            urls: [{ sign: 'testsign123' }],
            title: 'Test Headline'
          }
        ]
      })
    };
  };

  const successResult = await fetchRahtiDataWithRetry({}, { maxRetries: 2, initialDelayMs: 10, backoffFactor: 1 });
  if (!successResult || fetchAttempts !== 2) {
    console.error(`❌ Test failed: Expected success on 2nd attempt, got success=${successResult}, attempts=${fetchAttempts}`);
    failed = true;
  } else {
    console.log(`✅ Passed: fetchRahtiDataWithRetry succeeded on 2nd attempt after network reconnect.`);
  }

  // Test 2: fetchRahtiData (unwrapped) fails immediately without retrying
  console.log('\n--- fetchRahtiData Direct Call No-Retry Test ---');
  mockStorageData = {};
  fetchAttempts = 0;
  globalThis.fetch = async () => {
    fetchAttempts++;
    throw new Error('Simulated network error on manual click');
  };

  const directResult = await fetchRahtiData({ force: true });
  if (directResult !== false || fetchAttempts !== 1) {
    console.error(`❌ Test failed: Direct fetchRahtiData should fail on 1st attempt without retry. Got success=${directResult}, attempts=${fetchAttempts}`);
    failed = true;
  } else {
    console.log(`✅ Passed: Direct fetchRahtiData call failed immediately with 1 attempt (no retry).`);
  }

  // Test 3: fetchRahtiDataWithRetry fails after maxRetries if network remains offline
  console.log('\n--- fetchRahtiDataWithRetry Exceed Max Retries Test ---');
  mockStorageData = {};
  fetchAttempts = 0;
  const maxRetries = 2;
  const maxRetryResult = await fetchRahtiDataWithRetry({}, { maxRetries, initialDelayMs: 10, backoffFactor: 1 });
  if (maxRetryResult !== false || fetchAttempts !== (maxRetries + 1)) {
    console.error(`❌ Test failed: Expected max retries failure after ${maxRetries + 1} attempts. Got result=${maxRetryResult}, attempts=${fetchAttempts}`);
    failed = true;
  } else {
    console.log(`✅ Passed: fetchRahtiDataWithRetry stopped after ${maxRetries + 1} attempts as expected.`);
  }

  // Test 4: In-flight single-flight lock deduplication
  console.log('\n--- fetchRahtiData In-Flight Single-Flight Lock Test ---');
  mockStorageData = {};
  fetchAttempts = 0;
  globalThis.fetch = async () => {
    fetchAttempts++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => ({
        status: 'ok',
        schema_version: '0.1.0',
        entries: []
      })
    };
  };

  const p1 = fetchRahtiData();
  const p2 = fetchRahtiData();
  const p3 = fetchRahtiData();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  if (fetchAttempts !== 1 || !r1 || !r2 || !r3) {
    console.error(`❌ Test failed: Expected 1 fetch execution for 3 concurrent calls. Got attempts=${fetchAttempts}`);
    failed = true;
  } else {
    console.log(`✅ Passed: In-flight lock successfully deduplicated 3 concurrent requests into 1 execution.`);
  }

  if (failed) {
    console.error('\n❌ Rahti retry tests failed.');
    process.exit(1);
  } else {
    console.log('\n✅ All Rahti retry tests passed successfully.');
    process.exit(0);
  }
}

runRahtiTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
