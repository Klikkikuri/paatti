#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define file paths
const manifestPath = path.resolve(__dirname, 'manifest.json');
const updatesPath = path.resolve(__dirname, 'updates.json');

function getGitCleanStatus() {
  try {
    // Check if there are any changes (staged or unstaged) in tracked files
    execSync('git diff-index --quiet HEAD --');
    return true;
  } catch (err) {
    return false;
  }
}

function run() {
  console.log('Starting release process...');

  // 1. Verify git is clean
  if (!getGitCleanStatus()) {
    console.error('Error: Working directory has uncommitted changes. Please commit or stash them first.');
    process.exit(1);
  }

  // 2. Read current version from manifest.json
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
  let targetVersion = null;
  const args = process.argv.slice(2);

  // Simple CLI argument parsing
  const versionFlagIdx = args.indexOf('--version');
  if (versionFlagIdx !== -1 && args[versionFlagIdx + 1]) {
    targetVersion = args[versionFlagIdx + 1];
  } else if (args[0] && !args[0].startsWith('-')) {
    targetVersion = args[0];
  }

  if (targetVersion) {
    // Validate target version format (semver-like)
    if (!/^\d+\.\d+\.\d+$/.test(targetVersion)) {
      console.error(`Error: Specified version "${targetVersion}" is not in valid x.y.z format.`);
      process.exit(1);
    }
  } else {
    // Check if current version's tag already exists
    let tagExists = false;
    try {
      execSync(`git rev-parse "v${currentVersion}"`, { stdio: 'ignore' });
      tagExists = true;
    } catch (e) {
      tagExists = false;
    }

    if (tagExists) {
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
      console.log(`Using current version v${targetVersion} (no existing git tag found).`);
    }
  }

  console.log(`Releasing version: v${targetVersion}`);

  // 4. Update manifest.json
  manifest.version = targetVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓ Updated manifest.json');

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
      console.warn(`Warning: Addon "${addonId}" not found in updates.json. Skipping updates.json update.`);
    }
  } else {
    console.warn('Warning: updates.json not found. Skipping updates.json update.');
  }

  // 6. Git commit and tag
  try {
    execSync('git add manifest.json updates.json', { stdio: 'inherit' });
    execSync(`git commit -m "chore: release v${targetVersion}"`, { stdio: 'inherit' });
    execSync(`git tag -a "v${targetVersion}" -m "Release v${targetVersion}"`, { stdio: 'inherit' });
    console.log(`✓ Committed and tagged v${targetVersion} successfully.`);
  } catch (err) {
    console.error(`Error during git operations: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n✓ Version bumped and tagged as v${targetVersion} successfully!`);
}

run();
