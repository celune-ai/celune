#!/usr/bin/env node

/**
 * Dependency verification script — prevents slopsquatting & typosquatting attacks.
 *
 * Checks npm registry for:
 *   1. Existence (404 = hallucinated package name)
 *   2. Age (flag if created < 30 days ago)
 *   3. Weekly downloads (flag if < 100)
 *   4. Typosquatting (edit distance <= 2 from popular packages)
 *
 * Usage:
 *   node scripts/verify-dependency.mjs <pkg1> [pkg2] [pkg3] ...
 *   node scripts/verify-dependency.mjs --command "pnpm add lodash express"
 *
 * Exit codes:
 *   0 = all packages passed
 *   1 = one or more packages failed verification
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

// Parse --command mode (extracts package names from install commands)
let packages = [];
const commandIdx = args.indexOf('--command');
if (commandIdx !== -1) {
  const command = args.slice(commandIdx + 1).join(' ');
  packages = extractPackagesFromCommand(command);
} else {
  packages = args.filter((a) => !a.startsWith('-'));
}

if (packages.length === 0) {
  // No packages to verify — pass silently
  process.exit(0);
}

function extractPackagesFromCommand(command) {
  // Match pnpm add, npm install, yarn add patterns
  const installMatch = command.match(/(?:pnpm\s+add|npm\s+install|npm\s+i|yarn\s+add)\s+(.+)/);
  if (!installMatch) return [];

  return (
    installMatch[1]
      .split(/\s+/)
      // Filter out flags and version specifiers attached to flags
      .filter((arg) => !arg.startsWith('-'))
      // Strip version specifiers: lodash@^4.0.0 → lodash, @scope/pkg@1.0 → @scope/pkg
      .map((arg) => {
        // Handle scoped packages: @scope/name@version
        if (arg.startsWith('@')) {
          const withoutScope = arg.slice(1);
          const slashIdx = withoutScope.indexOf('/');
          if (slashIdx === -1) return arg;
          const scope = withoutScope.slice(0, slashIdx);
          const rest = withoutScope.slice(slashIdx + 1);
          const atIdx = rest.indexOf('@');
          if (atIdx === -1) return arg;
          return `@${scope}/${rest.slice(0, atIdx)}`;
        }
        // Unscoped: name@version
        const atIdx = arg.indexOf('@');
        if (atIdx <= 0) return arg;
        return arg.slice(0, atIdx);
      })
      .filter(Boolean)
  );
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_WEEKLY_DOWNLOADS = 100;
const MAX_TYPO_DISTANCE = 2;

// Load top packages list and allowlist
let topPackages = [];
let allowlist = [];
try {
  topPackages = JSON.parse(readFileSync(join(__dirname, 'top-npm-packages.json'), 'utf-8'));
} catch {
  console.warn('⚠️  Could not load top-npm-packages.json — typosquatting check skipped');
}
try {
  allowlist = JSON.parse(readFileSync(join(__dirname, 'dep-allowlist.json'), 'utf-8'));
} catch {
  // No allowlist file — that's fine
}

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Check if a package name is suspiciously similar to a popular package.
 * Returns null if OK, or a warning string if typosquatting suspected.
 */
function checkTyposquatting(pkg) {
  // Strip scope for comparison (e.g. @types/react -> react)
  const bare = pkg.startsWith('@') ? pkg.split('/').pop() : pkg;

  // Exact match with a top package — always safe
  if (topPackages.includes(bare) || topPackages.includes(pkg)) return null;

  // Allowlisted — skip
  if (allowlist.includes(pkg) || allowlist.includes(bare)) return null;

  for (const popular of topPackages) {
    const dist = levenshtein(bare, popular);
    if (dist > 0 && dist <= MAX_TYPO_DISTANCE) {
      return `'${pkg}' is suspiciously similar to '${popular}' (edit distance: ${dist}). Possible typosquatting.`;
    }
  }
  return null;
}

async function checkRegistry(pkg) {
  const encodedPkg = encodeURIComponent(pkg).replace('%40', '@');
  const registryUrl = `https://registry.npmjs.org/${encodedPkg}`;

  let registryData;
  try {
    const res = await fetch(registryUrl);
    if (res.status === 404) {
      const typoWarning = checkTyposquatting(pkg);
      const reasons = ['DOES NOT EXIST on npm registry (possible hallucinated package name)'];
      if (typoWarning) reasons.push(typoWarning);
      return { pkg, pass: false, reason: reasons.join('; ') };
    }
    if (!res.ok) {
      return { pkg, pass: false, reason: `Registry returned HTTP ${res.status}` };
    }
    registryData = await res.json();
  } catch (err) {
    return { pkg, pass: false, reason: `Registry fetch failed: ${err.message}` };
  }

  const warnings = [];

  // Check age — use the time field for the earliest published version
  const timeData = registryData.time;
  if (timeData && timeData.created) {
    const createdDate = new Date(timeData.created);
    const ageMs = Date.now() - createdDate.getTime();
    if (ageMs < THIRTY_DAYS_MS) {
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      warnings.push(
        `Package is only ${ageDays} day(s) old (created ${createdDate.toISOString().slice(0, 10)})`,
      );
    }
  }

  // Check weekly downloads
  const downloadsUrl = `https://api.npmjs.org/downloads/point/last-week/${encodedPkg}`;
  try {
    const dlRes = await fetch(downloadsUrl);
    if (dlRes.ok) {
      const dlData = await dlRes.json();
      if (dlData.downloads !== undefined && dlData.downloads < MIN_WEEKLY_DOWNLOADS) {
        warnings.push(
          `Only ${dlData.downloads} weekly downloads (minimum: ${MIN_WEEKLY_DOWNLOADS})`,
        );
      }
    }
  } catch {
    warnings.push('Could not fetch download stats');
  }

  // Typosquatting check
  const typoWarning = checkTyposquatting(pkg);
  if (typoWarning) {
    warnings.push(typoWarning);
  }

  if (warnings.length > 0) {
    return { pkg, pass: false, reason: warnings.join('; ') };
  }

  return { pkg, pass: true, reason: 'OK' };
}

async function main() {
  console.log(`\n🔍 Verifying ${packages.length} package(s): ${packages.join(', ')}\n`);

  const results = await Promise.all(packages.map(checkRegistry));

  let anyFailed = false;

  for (const r of results) {
    if (r.pass) {
      console.log(`  ✅ ${r.pkg} — ${r.reason}`);
    } else {
      console.log(`  ❌ ${r.pkg} — ${r.reason}`);
      anyFailed = true;
    }
  }

  console.log('');

  if (anyFailed) {
    console.log('⛔ BLOCKED: One or more packages failed verification.');
    console.log(
      '   If you believe these packages are legitimate, verify manually at https://www.npmjs.com/\n',
    );
    process.exit(1);
  } else {
    console.log('✅ All packages verified.\n');
    process.exit(0);
  }
}

main();
