import { DBOS } from '@dbos-inc/dbos-sdk';

async function dispatchRun(runId: string) {
  return runId;
}

export const dispatchRunWorkflow = DBOS.registerWorkflow(dispatchRun, { name: 'dispatchRun' });
