import type { CeluneTransport, ReorderItem } from '../transport/types';

/** Persists a reorder, falling back to per-task updates when the transport has no bulk reorder. */
export async function persistTaskReorder(transport: CeluneTransport, items: ReorderItem[]) {
  if (transport.tasks.reorder) return transport.tasks.reorder(items);
  await Promise.all(
    items.map((r) =>
      transport.tasks.update(r.id, {
        sort_order: r.sort_order,
        ...(r.status ? { status: r.status as never } : {}),
      }),
    ),
  );
}
