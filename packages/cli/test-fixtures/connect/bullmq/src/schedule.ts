import { Queue } from 'bullmq';

const queue = new Queue('agent-runs');
await queue.upsertJobScheduler('nightly', { pattern: '0 3 * * *' });
