import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs file, no type declarations needed
import {
  fileHash,
  planMigrations,
  enumPreStatements,
  hasOwnTransaction,
  recordSql,
} from '../../scripts/lib/migration-plan.mjs';

const file = (filename: string, content: string) => ({ filename, content });

describe('fileHash', () => {
  it('matches the 16-char sha256 prefix that boot-local.sh and migrate.mjs record', () => {
    const content = 'create table t (id int);\n';
    expect(fileHash(content)).toBe(createHash('sha256').update(content).digest('hex').slice(0, 16));
    expect(fileHash(content)).toHaveLength(16);
  });
});

describe('planMigrations', () => {
  it('lists unrecorded files in bytewise order and skips recorded ones', () => {
    const a = file('20260101_a.sql', 'select 1;');
    const b = file('20260102_b.sql', 'select 2;');
    const upper = file('002-old.sql', 'select 0;');
    const { pending, mismatched } = planMigrations(
      [b, a, upper],
      [{ filename: '20260101_a.sql', hash: fileHash(a.content) }],
    );
    expect(pending.map((p: { filename: string }) => p.filename)).toEqual([
      '002-old.sql',
      '20260102_b.sql',
    ]);
    expect(pending[1].hash).toBe(fileHash(b.content));
    expect(mismatched).toEqual([]);
  });

  it('reports recorded files whose content changed without re-running them', () => {
    const a = file('002-security-fixes.sql', '-- new comment\nselect 1;');
    const { pending, mismatched } = planMigrations(
      [a],
      [{ filename: a.filename, hash: 'aaaaaaaaaaaaaaaa' }],
    );
    expect(pending).toEqual([]);
    expect(mismatched).toEqual([
      { filename: a.filename, recorded: 'aaaaaaaaaaaaaaaa', local: fileHash(a.content) },
    ]);
  });

  it('rejects filenames that could break the tracking insert', () => {
    expect(() => planMigrations([file("x'; drop table t;--.sql", 'select 1;')], [])).toThrow(
      /Unsafe/,
    );
  });

  it('returns nothing pending when every file is recorded', () => {
    const a = file('a.sql', 'select 1;');
    expect(planMigrations([a], [{ filename: 'a.sql', hash: fileHash(a.content) }]).pending).toEqual(
      [],
    );
  });
});

describe('enumPreStatements', () => {
  it('extracts ADD VALUE IF NOT EXISTS statements so they commit first', () => {
    const sql = [
      "ALTER TYPE ai_job_type ADD VALUE IF NOT EXISTS 'agent_run';",
      'ALTER TABLE ai_job_queue ADD COLUMN x int;',
      "alter type task_status add value if not exists 'cancelled' after 'done';",
    ].join('\n');
    expect(enumPreStatements(sql)).toEqual([
      "ALTER TYPE ai_job_type ADD VALUE IF NOT EXISTS 'agent_run';",
      "alter type task_status add value if not exists 'cancelled' after 'done';",
    ]);
  });

  it('ignores ADD VALUE inside comments', () => {
    expect(
      enumPreStatements(
        "-- ALTER TYPE t ADD VALUE 'x';\n/* ALTER TYPE t ADD VALUE 'y'; */\nselect 1;",
      ),
    ).toEqual([]);
  });

  it('refuses ADD VALUE without IF NOT EXISTS, which would fail on the second pass', () => {
    expect(() => enumPreStatements("ALTER TYPE t ADD VALUE 'x';")).toThrow(/IF NOT EXISTS/);
  });

  it('does not treat ADD COLUMN or other ALTER TYPE forms as enum additions', () => {
    expect(
      enumPreStatements("ALTER TYPE t RENAME VALUE 'a' TO 'b';\nALTER TABLE t ADD COLUMN v int;"),
    ).toEqual([]);
  });
});

describe('hasOwnTransaction', () => {
  it('detects explicit transaction control', () => {
    expect(hasOwnTransaction('BEGIN;\nselect 1;\nCOMMIT;')).toBe(true);
    expect(hasOwnTransaction('start transaction;\nselect 1;')).toBe(true);
  });

  it('ignores plpgsql BEGIN blocks and comments', () => {
    expect(hasOwnTransaction('DO $$ BEGIN PERFORM 1; END $$;\n-- BEGIN;')).toBe(false);
    expect(
      hasOwnTransaction(
        'create function f() returns int language plpgsql as $$\nbegin\n  return 1;\nend $$;',
      ),
    ).toBe(false);
  });
});

describe('recordSql', () => {
  it('builds the tracking insert for validated values', () => {
    expect(recordSql('20260929_cloud_per_seat_plan.sql', '0123456789abcdef')).toBe(
      "insert into public._migrations (filename, hash, applied_by) values ('20260929_cloud_per_seat_plan.sql', '0123456789abcdef', 'migrate-production') on conflict (filename) do nothing;\n",
    );
  });

  it('refuses unsafe filenames or hashes', () => {
    expect(() => recordSql("a'.sql", '0123456789abcdef')).toThrow();
    expect(() => recordSql('a.sql', 'zz')).toThrow();
  });
});
