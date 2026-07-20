#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const manifestPath = path.resolve(__dirname, 'manifest.json');
const updatesPath = path.resolve(__dirname, 'updates.json');

function getGitCleanStatus() {
  try {
    execSync('git diff-index --quiet HEAD --');
    return true;
  } catch (err) {
    return false;
  }
}

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch (err) {
    return null;
  }
}

function run() {
  console.log('Starting release process...');

  // 1. Verify we are on the main branch
  const currentBranch = getCurrentBranch();
  if (currentBranch !== 'main') {
    console.error(`Error: Releases can only be generated from the "main" branch. You are currently on "${currentBranch}".`);
    process.exit(1);
  }

  // 2. Verify git is clean
  if (!getGitCleanStatus()) {
    console.error('Error: Working directory has uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  // 2. Read manifest.json to get the current version
  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: manifest.json not found at ${manifestPath}`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`Error parsing manifest.json: ${err.message}`);
    process.exit(1);
  }

  const currentVersion = manifest.version;
  if (!currentVersion) {
    console.error('Error: manifest.json does not contain a "version" property.');
    process.exit(1);
  }

  // 3. Determine target version
  const args = process.argv.slice(2);
  let targetVersion = args[0];

  if (targetVersion) {
    // Strip leading 'v' if present
    if (targetVersion.startsWith('v')) {
      targetVersion = targetVersion.slice(1);
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
      console.error(`Error: Version "${targetVersion}" is not in a valid x.y.z format.`);
      process.exit(1);
    }
  } else {
    // Automatic version detection
    let currentTagExists = false;
    try {
      execSync(`git rev-parse "v${currentVersion}"`, { stdio: 'ignore' });
      currentTagExists = true;
    } catch (e) {
      currentTagExists = false;
    }

    if (currentTagExists) {
      // Auto-increment patch version
      const parts = currentVersion.split('.').map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        parts[2] += 1;
        targetVersion = parts.join('.');
        console.log(`Tag v${currentVersion} already exists. Auto-incrementing to v${targetVersion}.`);
      } else {
        console.error(`Error: Cannot auto-increment invalid version format "${currentVersion}". Please specify version explicitly.`);
        process.exit(1);
      }
    } else {
      targetVersion = currentVersion;
      console.log(`Using current version v${targetVersion} from manifest.json (no existing git tag found).`);
    }
  }

  // 4. Double check if git tag for target version already exists
  let targetTagExists = false;
  try {
    execSync(`git rev-parse "v${targetVersion}"`, { stdio: 'ignore' });
    targetTagExists = true;
  } catch (e) {
    targetTagExists = false;
  }

  if (targetTagExists) {
    console.error(`Error: Git tag "v${targetVersion}" already exists.`);
    process.exit(1);
  }

  // 5. Update manifest.json (if version changed)
  if (manifest.version !== targetVersion) {
    manifest.version = targetVersion;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log('✓ Updated manifest.json');
  } else {
    console.log('manifest.json already has target version. No write needed.');
  }

  // 5. Update updates.json
  if (fs.existsSync(updatesPath)) {
    let updates;
    try {
      updates = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));
    } catch (err) {
      console.error(`Error parsing updates.json: ${err.message}`);
      process.exit(1);
    }

    const addonId = 'klikkikuri@protonmail.com';
    if (updates.addons && updates.addons[addonId]) {
      const addonUpdates = updates.addons[addonId].updates;
      const alreadyExists = addonUpdates.some(u => u.version === targetVersion);
      if (!alreadyExists) {
        addonUpdates.push({
          version: targetVersion,
          update_link: `https://github.com/Klikkikuri/paatti/releases/download/v${targetVersion}/klikkikuri-paatti-${targetVersion}.xpi`,
          applications: {
            gecko: {
              strict_min_version: '152.0'
            }
          }
        });
        fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + '\n');
        console.log('✓ Updated updates.json');
      } else {
        console.log('updates.json already contains this version entry.');
      }
    } else {
      console.warn(`Warning: Addon "${addonId}" not found in updates.json. Skipping update.`);
    }
  } else {
    console.warn('Warning: updates.json not found. Skipping update.');
  }

  // 6. Git commit and tag
  try {
    execSync('git add manifest.json updates.json', { stdio: 'inherit' });
    execSync(`git commit -m "chore: release v${targetVersion}"`, { stdio: 'inherit' });
    execSync(`git tag -a "v${targetVersion}" -m "Release v${targetVersion}"`, { stdio: 'inherit' });
    console.log(`✓ Committed and tagged v${targetVersion} successfully.`);
    console.log(`\nNext steps:\n  git push origin HEAD --follow-tags`);
  } catch (err) {
    console.error(`Error during git operations: ${err.message}`);
    process.exit(1);
  }
}

run();
