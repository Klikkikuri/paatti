import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock browser API globally before importing config.js
globalThis.chrome = {
  storage: {
    local: { get: async () => ({}) },
    sync: { get: async () => ({}) }
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
