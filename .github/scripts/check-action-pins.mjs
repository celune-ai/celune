#!/usr/bin/env node
// Fails when a workflow or composite action references a third-party action by tag or
// branch. Each `uses:` must name a full 40-character commit SHA and carry a trailing
// `# vX.Y.Z` comment so Dependabot and reviewers can read the version.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const roots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['.github/workflows', '.github/actions'];
const pinned = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d[\w.-]*$/;

function yamlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(entry.name) ? [path] : [];
  });
}

const failures = [];
let checked = 0;
for (const file of roots.flatMap(yamlFiles)) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const match = line.match(/^\s*(?:-\s+)?uses:\s*['"]?([^'"]+?)['"]?\s*(#.*)?$/);
      if (!match) return;
      const ref = match[1].trim();
      if (ref.startsWith('./') || ref.startsWith('docker://')) return;
      checked += 1;
      const value = `${ref}${match[2] ? ` ${match[2].trim()}` : ''}`;
      if (!pinned.test(value)) failures.push(`${file}:${index + 1}: ${value}`);
    });
}

if (failures.length) {
  console.error('Actions must be pinned to a full commit SHA with a trailing "# vX.Y.Z" comment:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`${checked} action references are pinned to commit SHAs.`);
