import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { CeluneProvider, useCelune } from '..';
import { TaskBoard } from '../tasks';
import { createMockTransport } from '../testing';
import { demoTasks } from './fixtures';

function TriggerExpiry() {
  const { transport } = useCelune();
  useEffect(() => {
    transport.tasks.list().catch(() => undefined);
  }, [transport]);
  return null;
}

function ExpiredSession() {
  const [transport] = useState(() => {
    const t = createMockTransport({ tasks: demoTasks });
    t.failNext(401);
    return t;
  });
  return (
    <CeluneProvider
      apiUrl="http://celune.test/v1"
      token="expired"
      workspaceId="ws-demo"
      transport={transport}
      pollInterval={0}
      refreshToken={async () => {
        throw new Error('refresh rejected');
      }}
    >
      <TriggerExpiry />
      <div className="h-[640px]">
        <TaskBoard initialTasks={demoTasks} />
      </div>
    </CeluneProvider>
  );
}

const meta: Meta = { title: 'Provider' };
export default meta;

export const TokenRefreshFailed: StoryObj = { render: () => <ExpiredSession /> };
