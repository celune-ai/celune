// Removes @font-face rules from the prebuilt CSS; the host page supplies fonts.
import { readFileSync, writeFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const css = readFileSync(file, 'utf8');
  const out = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  writeFileSync(file, out);
  console.log(
    `strip-font-face: removed ${(css.match(/@font-face/g) ?? []).length} rules from ${file}`,
  );
}
