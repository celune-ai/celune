import { Worker } from 'bullmq';

export const worker = new Worker('agent-runs', async (job) => {
  return { ok: true, id: job.id };
});
