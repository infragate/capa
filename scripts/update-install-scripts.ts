#!/usr/bin/env bun
/**
 * Update version in install scripts (install.sh and install.ps1)
 * 
 * This script replaces the APP_VERSION variable in the install scripts
 * with the version from the git tag or package.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

function getVersion(): string {
  // 1. Try GitHub Actions environment variable (GITHUB_REF = refs/tags/v1.2.3)
  const githubRef = process.env.GITHUB_REF;
  if (githubRef && githubRef.startsWith('refs/tags/')) {
    const tag = githubRef.replace('refs/tags/', '');
    const version = tag.startsWith('v') ? tag.slice(1) : tag;
    console.log(`✓ Using version from GitHub tag: ${version}`);
    return version;
  }

  // 2. Try git describe (for local development)
  try {
    const gitDescribe = execSync('git describe --tags --always', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    
    // If it's a clean tag (e.g., v1.2.3), use it
    if (gitDescribe.match(/^v?\d+\.\d+\.\d+$/)) {
      const version = gitDescribe.startsWith('v') ? gitDescribe.slice(1) : gitDescribe;
      console.log(`✓ Using version from git tag: ${version}`);
      return version;
    }
  } catch (error) {
    // Git not available or not in a repository
    console.log('⚠ Git not available, falling back to package.json');
  }

  // 3. Fallback to package.json
  try {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
    const version = packageJson.version;
    console.log(`✓ Using version from package.json: ${version}`);
    return version;
  } catch (error) {
    console.error('✗ Failed to read package.json');
    return '0.0.0-unknown';
  }
}

function updateInstallScript(filePath: string, version: string) {
  const content = readFileSync(filePath, 'utf-8');
  
  let updated: string;
  let pattern: RegExp;
  
  if (filePath.endsWith('.ps1')) {
    // PowerShell: $APP_VERSION = "..."
    pattern = /^(\$APP_VERSION\s*=\s*)"[^"]*"/m;
    updated = content.replace(pattern, `$1"${version}"`);
  } else {
    // Shell script: APP_VERSION="..."
    pattern = /^(APP_VERSION=)"[^"]*"/m;
    updated = content.replace(pattern, `$1"${version}"`);
  }
  
  if (content === updated) {
    // No change needed - version is already correct
    const match = content.match(pattern);
    if (match) {
      console.log(`✓ ${filePath} already at version ${version}`);
    } else {
      console.warn(`⚠ No APP_VERSION found in ${filePath}`);
    }
    return;
  }
  
  writeFileSync(filePath, updated, 'utf-8');
  console.log(`✓ Updated ${filePath} to version ${version}`);
}

function main() {
  const version = getVersion();
  console.log(); // Add newline after version message
  
  updateInstallScript('install.sh', version);
  updateInstallScript('install.ps1', version);
  
  console.log('✓ All install scripts updated');
}

main();
