// Builds shadcn registry output (dist/r/*.json) from registry.json, matching `shadcn build`.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'r');
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));

const errors = [];
const names = new Set();
for (const item of registry.items) {
  if (names.has(item.name)) errors.push(`duplicate item name ${item.name}`);
  names.add(item.name);
  if (item.type !== 'registry:block') errors.push(`${item.name}: type must be registry:block`);
  if (!item.files?.length) errors.push(`${item.name}: no files`);
  for (const file of item.files ?? []) {
    if (!existsSync(join(root, file.path))) errors.push(`${item.name}: missing ${file.path}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
for (const item of registry.items) {
  const built = {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    ...item,
    files: item.files.map((file) => ({
      ...file,
      content: readFileSync(join(root, file.path), 'utf8'),
    })),
  };
  writeFileSync(join(outDir, `${item.name}.json`), `${JSON.stringify(built, null, 2)}\n`);
}
writeFileSync(join(outDir, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
console.log(`build-registry: wrote ${registry.items.length} items to dist/r`);
