import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let changeListener = null;
let localGetCalls = 0;
let syncGetCalls = 0;

let mockLocalData = {};
let mockSyncData = {};

// Mock browser API globally before importing config.js
globalThis.chrome = {
  storage: {
    local: {
      get: async () => {
        localGetCalls++;
        return mockLocalData;
      }
    },
    sync: {
      get: async () => {
        syncGetCalls++;
        return mockSyncData;
      }
    },
    onChanged: {
      addListener: (fn) => {
        changeListener = fn;
      }
    }
  }
};

// Paths are relative to the test file location
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Import dynamic getConfig from src/config.js
import { getConfig } from '../src/config.js';

async function runTests() {
  console.log('Running configuration verification tests...');
  let failed = false;

  const config = await getConfig();
  const siteConfigs = config.siteConfigs;
  const manifestHostPermissions = new Set(manifest.host_permissions || []);
  const manifestOptionalHostPermissions = new Set(manifest.optional_host_permissions || []);

  // Find matches in web_accessible_resources
  const webAccessibleMatches = new Set();
  if (manifest.web_accessible_resources) {
    for (const resourceGroup of manifest.web_accessible_resources) {
      if (resourceGroup.matches) {
        for (const match of resourceGroup.matches) {
          webAccessibleMatches.add(match);
        }
      }
    }
  }

  console.log('\n--- Host Permissions Check ---');
  for (const [domain, siteConfig] of Object.entries(siteConfigs)) {
    const isEnabledByDefault = siteConfig.enabled !== false;
    const origins = siteConfig.origins || [`https://${domain}/*`];
    for (const origin of origins) {
      if (isEnabledByDefault) {
        if (!manifestHostPermissions.has(origin)) {
          console.error(`❌ Error: Site "${domain}" is enabled by default, but its origin "${origin}" is not in host_permissions of manifest.json.`);
          failed = true;
        } else {
          console.log(`✅ Origin "${origin}" for default-enabled site "${domain}" is in host_permissions.`);
        }
      } else {
        if (!manifestOptionalHostPermissions.has(origin)) {
          console.error(`❌ Error: Site "${domain}" is disabled by default (optional), but its origin "${origin}" is not in optional_host_permissions of manifest.json.`);
          failed = true;
        } else {
          console.log(`✅ Origin "${origin}" for optional site "${domain}" is in optional_host_permissions.`);
        }
      }
    }
  }

  console.log('\n--- Web Accessible Resources Check ---');
  for (const [domain, siteConfig] of Object.entries(siteConfigs)) {
    const origins = siteConfig.origins || [`https://${domain}/*`];
    for (const origin of origins) {
      if (!webAccessibleMatches.has(origin)) {
        console.error(`❌ Error: Origin "${origin}" for site "${domain}" is not listed in web_accessible_resources matches in manifest.json. Dynamic imports will fail on this site!`);
        failed = true;
      } else {
        console.log(`✅ Origin "${origin}" is in web_accessible_resources matches.`);
      }
    }
  }

  console.log('\n--- Cache and Invalidation Check ---');

  // Verify that the initial call to getConfig at the start of runTests counted as 1 call
  if (localGetCalls !== 1 || syncGetCalls !== 1) {
    console.error(`❌ Error: Expected 1 initial storage read, got local: ${localGetCalls}, sync: ${syncGetCalls}`);
    failed = true;
  } else {
    console.log('✅ Initial getConfig call successfully queried storage.');
  }

  // First check: get the cached reference (which should be returned since it was cached initially)
  const conf1 = await getConfig();

  // Second call: should still return cached value and NOT trigger storage reads
  const conf2 = await getConfig();
  if (localGetCalls !== 1 || syncGetCalls !== 1) {
    console.error(`❌ Error: Expected storage reads to remain 1 (cached), got local: ${localGetCalls}, sync: ${syncGetCalls}`);
    failed = true;
  } else {
    console.log('✅ Subsequent getConfig calls successfully read from memory cache.');
  }

  // Verify they returned identical objects (same reference)
  if (conf1 !== conf2) {
    console.error('❌ Error: getConfig calls did not return identical config references.');
    failed = true;
  } else {
    console.log('✅ Cached configs refer to the same object.');
  }

  // Simulate storage change event to invalidate cache
  if (typeof changeListener !== 'function') {
    console.error('❌ Error: onChanged listener was not registered.');
    failed = true;
  } else {
    console.log('✅ onChanged listener is registered.');
    changeListener({}, 'local');

    // Third call after change listener should query storage again
    const conf3 = await getConfig();
    if (localGetCalls !== 2 || syncGetCalls !== 2) {
      console.error(`❌ Error: Expected 2 storage reads after invalidation, got local: ${localGetCalls}, sync: ${syncGetCalls}`);
      failed = true;
    } else {
      console.log('✅ getConfig after storage change successfully re-read from storage.');
    }
  }

  console.log('\n--- Sync Overrides Check ---');
  // Trigger cache invalidation so we read from storage again
  if (typeof changeListener === 'function') {
    changeListener({}, 'sync');
  }
  
  mockSyncData = {
    userSiteOverrides: {
      "yle.fi": { enabled: false }
    }
  };

  const overriddenConfig = await getConfig();
  if (overriddenConfig.siteConfigs["yle.fi"].enabled !== false) {
    console.error('❌ Error: Sync override was not applied to yle.fi.');
    failed = true;
  } else {
    console.log('✅ Sync override was successfully applied to yle.fi.');
  }

  if (!overriddenConfig.siteConfigs["yle.fi"].origins) {
    console.error('❌ Error: Origins were missing from overridden config for yle.fi.');
    failed = true;
  } else {
    console.log('✅ Origins correctly populated for overridden config for yle.fi.');
  }

  console.log('\n--- Environment Modifiers Check ---');
  // 1. Free environment default (no overrides): video should be false, aiSlop should be true
  mockLocalData = { userPreferences: { environment: 'free' } };
  mockSyncData = {};
  if (typeof changeListener === 'function') {
    changeListener({}, 'local');
  }
  const freeConfig = await getConfig();
  if (freeConfig.modifiers?.video !== false || freeConfig.modifiers?.aiSlop !== true) {
    console.error(`❌ Error: Expected free environment modifiers { aiSlop: true, video: false }, got:`, freeConfig.modifiers);
    failed = true;
  } else {
    console.log('✅ Free environment defaults video modifier to false.');
  }

  // 2. Development environment default: video should be true by default
  mockLocalData = { userPreferences: { environment: 'development' } };
  mockSyncData = {};
  if (typeof changeListener === 'function') {
    changeListener({}, 'local');
  }
  const devConfig = await getConfig();
  if (devConfig.modifiers?.video !== true || devConfig.modifiers?.aiSlop !== true) {
    console.error(`❌ Error: Expected development environment modifiers { aiSlop: true, video: true }, got:`, devConfig.modifiers);
    failed = true;
  } else {
    console.log('✅ Development environment defaults video modifier to true.');
  }

  // 3. User sync override should override development default
  mockLocalData = { userPreferences: { environment: 'development' } };
  mockSyncData = { modifiers: { video: false } };
  if (typeof changeListener === 'function') {
    changeListener({}, 'sync');
  }
  const devOverrideConfig = await getConfig();
  if (devOverrideConfig.modifiers?.video !== false) {
    console.error(`❌ Error: Expected user sync override to take precedence over dev default, got:`, devOverrideConfig.modifiers);
    failed = true;
  } else {
    console.log('✅ User sync override takes precedence over development default.');
  }

  if (failed) {
    console.error('\n❌ Tests failed. Please fix the mismatches in manifest.json or config.js.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed successfully.');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
