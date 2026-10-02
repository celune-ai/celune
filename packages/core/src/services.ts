import { AgentService } from './agents/agent-service.ts';
import { AttachmentService, type AttachmentBlobs } from './attachments/attachment-service.ts';
import { NoopGate, type Gate } from './gate.ts';
import { HarnessService, type HarnessEventLedger } from './harness/harness-service.ts';
import type { HarnessRegistry } from './harness/registry.ts';
import { JobService } from './jobs/job-service.ts';
import { ProjectService } from './projects/project-service.ts';
import type { Store } from './store.ts';
import { TaskService } from './tasks/task-service.ts';

export interface ServicesOptions {
  gate?: Gate;
  clock?: () => Date;
  /** Where attachment bytes go. Without it, uploads answer 501 and downloads have no URL. */
  attachmentBlobs?: AttachmentBlobs;
  /** Harness adapters per workspace. Without one, claims start no runs. */
  harnessRegistry?: HarnessRegistry;
  /** Harness event dedupe; defaults to the store's ledger, then to one in memory. */
  harnessLedger?: HarnessEventLedger;
}

export interface Services {
  store: Store;
  gate: Gate;
  tasks: TaskService;
  projects: ProjectService;
  jobs: JobService;
  agents: AgentService;
  attachments: AttachmentService;
  harness: HarnessService;
}

export function createServices(store: Store, options: ServicesOptions = {}): Services {
  const gate = options.gate ?? new NoopGate();
  const tasks = new TaskService(store, { gate, clock: options.clock });
  return {
    store,
    gate,
    tasks,
    projects: new ProjectService(store, { gate }),
    jobs: new JobService(store, { clock: options.clock }),
    agents: new AgentService(store),
    attachments: new AttachmentService(store, { blobs: options.attachmentBlobs }),
    harness: new HarnessService(store, tasks, {
      registry: options.harnessRegistry,
      ledger: options.harnessLedger ?? store.harnessEvents,
      gate,
      clock: options.clock,
    }),
  };
}
