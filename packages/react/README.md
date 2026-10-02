# @celuneai/react

Celune's project management UI for React 19: a provider, task and project views (board, list, detail), and headless hooks. It talks to a Celune API (`@celuneai/api` or a self-hosted Celune) over REST.

```bash
npm install @celuneai/react react react-dom
```

```tsx
import { CeluneProvider } from '@celuneai/react';
import { TaskBoard } from '@celuneai/react/tasks';
import { useTasksQuery } from '@celuneai/react/hooks';
import '@celuneai/react/styles.css';

function Board() {
  const { data } = useTasksQuery();
  return data ? <TaskBoard initialTasks={data} /> : null;
}

export function Tasks({ token }: { token: string }) {
  return (
    <CeluneProvider
      apiUrl="https://celune.example.com/v1"
      token={token}
      workspaceId="<workspace id>"
    >
      <Board />
    </CeluneProvider>
  );
}
```

## Entry points

| Import                     | Contents                                            |
| -------------------------- | --------------------------------------------------- |
| `@celuneai/react`          | `CeluneProvider`, transports, appearance helpers    |
| `@celuneai/react/tasks`    | `TaskBoard`, `TaskListView`, task cards and columns |
| `@celuneai/react/projects` | Project views                                       |
| `@celuneai/react/hooks`    | Headless query and mutation hooks                   |
| `@celuneai/react/utils`    | Sorting, formatting, and badge helpers              |
| `@celuneai/react/testing`  | Mock transport and fixtures for tests and demos     |

## Styles

- `styles.css`: everything, including Tailwind preflight. Use it for a standalone page.
- `components.css`: component styles only, driven by `--celune-*` CSS variables. Pair it with `defaults.css` or a mapping to your design system (`mappings/shadcn.css` is an example).
- `tokens.css`: the variable definitions, for hosts that compile Tailwind v4 themselves.

Theme values can also be passed at runtime with the provider's `appearance` prop.

## License

Apache-2.0
