/**
 * Pure planning logic for scripts/migrate-production.mjs, kept separate so it can be tested
 * without a database.
 */
import { createHash } from 'crypto';

const FILENAME_RE = /^[A-Za-z0-9_.-]+\.sql$/;
const ENUM_ADD_VALUE_RE = /ALTER\s+TYPE\s+[^;]+?\s+ADD\s+VALUE\b[^;]*;/gi;

/** First 16 hex chars of the file's sha256, the format public._migrations stores. */
export function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Strip -- line comments and block comments so commented-out SQL is not treated as live. */
export function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/**
 * Compare local migration files with the rows in public._migrations.
 * Pending files keep bytewise filename order, the order every runner in this repo uses.
 */
export function planMigrations(localFiles, appliedRows) {
  const applied = new Map(appliedRows.map((r) => [r.filename, r.hash]));
  const sorted = [...localFiles].sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  );
  const pending = [];
  const mismatched = [];
  for (const file of sorted) {
    if (!FILENAME_RE.test(file.filename)) {
      throw new Error(`Unsafe migration filename: ${file.filename}`);
    }
    const hash = fileHash(file.content);
    if (!applied.has(file.filename)) {
      pending.push({ ...file, hash });
    } else if (applied.get(file.filename) !== hash) {
      mismatched.push({
        filename: file.filename,
        recorded: applied.get(file.filename),
        local: hash,
      });
    }
  }
  return { pending, mismatched };
}

/**
 * ALTER TYPE ... ADD VALUE statements must commit before the new value can be used, so the
 * runner commits them on their own before applying the whole file in one transaction.
 * Each one needs IF NOT EXISTS so the second pass inside the transaction is a no-op.
 */
export function enumPreStatements(sql) {
  const statements = stripComments(sql).match(ENUM_ADD_VALUE_RE) ?? [];
  for (const s of statements) {
    if (!/ADD\s+VALUE\s+IF\s+NOT\s+EXISTS/i.test(s)) {
      throw new Error(`Enum value must use ADD VALUE IF NOT EXISTS: ${s.trim()}`);
    }
  }
  return statements.map((s) => s.trim());
}

/** Files that manage their own transaction cannot be wrapped in --single-transaction. */
export function hasOwnTransaction(sql) {
  return /^\s*(BEGIN|START\s+TRANSACTION|COMMIT)\s*;/im.test(stripComments(sql));
}

/** The tracking insert for one applied file; inputs are validated before they reach SQL. */
export function recordSql(filename, hash) {
  if (!FILENAME_RE.test(filename) || !/^[0-9a-f]{16}$/.test(hash)) {
    throw new Error(`Refusing to record unsafe values: ${filename}`);
  }
  return (
    `insert into public._migrations (filename, hash, applied_by) ` +
    `values ('${filename}', '${hash}', 'migrate-production') on conflict (filename) do nothing;\n`
  );
}
