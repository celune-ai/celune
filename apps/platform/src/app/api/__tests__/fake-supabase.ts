/** In-memory supabase-js stand-in shared by the transfer tests. */
export type Row = Record<string, unknown>;

export const UNIQUES: Record<string, string[][]> = {
  agent_memory: [['id'], ['key', 'user_id']],
  memory_relations: [['id'], ['memory_id', 'related_type', 'related_id', 'relation_type']],
  brain_manifest: [['id'], ['workspace_id', 'path']],
  brain_section_hashes: [['id'], ['manifest_id', 'section_key']],
  workspaces: [['id']],
  agent_configs: [['workspace_id', 'agent_id']],
};

/** Minimal stand-in for the supabase-js client used by brain and workspace transfer. */
export class FakeDb {
  tables = new Map<string, Row[]>();
  objects = new Map<string, Uint8Array>();

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array) => {
        this.objects.set(`${bucket}/${path}`, bytes);
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const bytes = this.objects.get(`${bucket}/${path}`);
        if (!bytes) return { data: null, error: { message: 'not found' } };
        return { data: { arrayBuffer: async () => bytes.slice().buffer }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) this.objects.delete(`${bucket}/${path}`);
        return { data: null, error: null };
      },
    }),
  };

  reset() {
    this.tables.clear();
    this.objects.clear();
  }

  seed(table: string, rows: Row[]) {
    this.tables.set(table, [...(this.tables.get(table) ?? []), ...rows.map((r) => ({ ...r }))]);
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

export class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private op: 'select' | 'insert' | 'upsert' | 'delete' | 'update' = 'select';
  private patch: Row = {};
  private filters: Array<(r: Row) => boolean> = [];
  private columns: string[] | null = null;
  private head = false;
  private wantCount = false;
  private orderCol: string | null = null;
  private rangeFrom = 0;
  private rangeTo = Infinity;
  private single: 'maybe' | null = null;
  private payload: Row[] = [];
  private onConflict: string[] = [];
  private ignoreDuplicates = false;
  private returning = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true;
    this.columns = cols === '*' ? null : cols.split(',').map((c) => c.trim());
    this.head = !!opts?.head;
    this.wantCount = !!opts?.count;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  order(col: string) {
    this.orderCol = col;
    return this;
  }
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }
  maybeSingle() {
    this.single = 'maybe';
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = opts.onConflict.split(',').map((c) => c.trim());
    this.ignoreDuplicates = !!opts.ignoreDuplicates;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.patch = patch;
    return this;
  }

  private project(rows: Row[]): Row[] {
    if (!this.columns) return rows.map((r) => ({ ...r }));
    return rows.map((r) => Object.fromEntries(this.columns!.map((c) => [c, r[c]])));
  }

  private conflictsWith(existing: Row[], row: Row, cols: string[]): boolean {
    return existing.some((e) => cols.every((c) => e[c] === row[c]));
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    const table = this.db.rows(this.table);
    if (this.op === 'select') {
      let rows = table.filter((r) => this.filters.every((f) => f(r)));
      if (this.orderCol) {
        const col = this.orderCol;
        rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      }
      const count = rows.length;
      rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.head) return { data: null, error: null, count };
      const data = this.project(rows);
      if (this.single) return { data: data[0] ?? null, error: null };
      return { data, error: null, count: this.wantCount ? count : undefined };
    }
    if (this.op === 'update') {
      const matched = table.filter((r) => this.filters.every((f) => f(r)));
      for (const r of matched) Object.assign(r, this.patch);
      return { data: this.returning ? this.project(matched) : null, error: null };
    }
    if (this.op === 'delete') {
      const removed = table.filter((r) => this.filters.every((f) => f(r)));
      const kept = table.filter((r) => !removed.includes(r));
      this.db.tables.set(this.table, kept);
      return { data: this.returning ? this.project(removed) : null, error: null };
    }
    const inserted: Row[] = [];
    for (const raw of this.payload) {
      const row: Row = { id: `gen-${Math.random().toString(16).slice(2)}`, ...raw };
      const uniques = UNIQUES[this.table] ?? [['id']];
      let skip = false;
      for (const cols of uniques) {
        if (!this.conflictsWith(table, row, cols)) continue;
        const target = this.op === 'upsert' && cols.join(',') === this.onConflict.join(',');
        if (target && this.ignoreDuplicates) {
          skip = true;
          break;
        }
        if (target) {
          const existing = table.find((r) => cols.every((c) => r[c] === row[c]))!;
          Object.assign(existing, raw);
          inserted.push(existing);
          skip = true;
          break;
        }
        return { data: null, error: { code: '23505', message: `unique violation on ${cols}` } };
      }
      if (skip) continue;
      table.push(row);
      inserted.push(row);
    }
    return { data: this.returning ? this.project(inserted) : null, error: null };
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: (v: { data: unknown; error: unknown; count?: number }) => R1 | PromiseLike<R1>,
    onrejected?: (e: unknown) => R2 | PromiseLike<R2>,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
