import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { CeluneProvider } from '@celuneai/react';
import { TaskBoard } from '@celuneai/react/tasks';
import { useTasksQuery } from '@celuneai/react/hooks';
import { createMockTransport, makeTask } from '@celuneai/react/testing';
import '@celuneai/react/styles.css';

const seed = [
  makeTask({ title: 'Try the board in a plain Vite app', status: 'in_progress', assignee: 'rick' }),
  makeTask({
    title: 'Swap the mock for createRestTransport',
    status: 'planning',
    priority: 'high',
  }),
  makeTask({ title: 'Point subscribe at your realtime source', status: 'inbox' }),
  makeTask({ title: 'Read the provider docs', status: 'done' }),
];

function Board() {
  const { data, isLoading } = useTasksQuery();
  if (isLoading || !data) return <p className="p-6 text-sm">Loading tasks...</p>;
  return <TaskBoard initialTasks={data} />;
}

function App() {
  const [transport] = useState(() => createMockTransport({ tasks: seed }, { latency: 200 }));
  return (
    <CeluneProvider
      apiUrl="http://localhost:8787/v1"
      token="demo"
      workspaceId="ws-demo"
      transport={transport}
      pollInterval={5000}
      currentUser={{ displayName: 'Demo user', assignee: 'eric' }}
    >
      <div className="h-screen p-4">
        <Board />
      </div>
      <Toaster theme="dark" position="bottom-left" />
    </CeluneProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
