# @repo/ui

Shared UI component library for the Celune platform. Built on Radix UI primitives, styled with Tailwind CSS v4, with Framer Motion animations and Lucide icons.

## Exports

| Export                   | File                    | Purpose                                |
| ------------------------ | ----------------------- | -------------------------------------- |
| `@repo/ui/components/*`  | `src/components/*.tsx`  | Individual shadcn/ui-style components  |
| `@repo/ui/app-icon-rail` | `src/app-icon-rail.tsx` | Left icon rail navigation              |
| `@repo/ui/page-sidebar`  | `src/page-sidebar.tsx`  | Collapsible page sidebar with sections |
| `@repo/ui/page-header`   | `src/page-header.tsx`   | Sticky page header with breadcrumbs    |
| `@repo/ui/nav`           | `src/nav.tsx`           | Top navigation bar                     |
| `@repo/ui/utils`         | `src/utils.ts`          | `cn()` classname merge utility         |
| `@repo/ui/theme.css`     | `src/theme.css`         | Global CSS theme tokens                |

## Components

All components live in `src/components/` and follow shadcn/ui patterns:

accordion, alert, avatar, badge, bar-chart, button, card, chart, checkbox, confirm-dialog, dialog, dropdown-menu, input, label, line-chart, logs-bar-chart, metric-card, popover, progress, radio-group, scroll-area, select, separator, support-chat, switch, table, tabs, textarea, toggle, tooltip

## Usage

```tsx
import { Button } from '@repo/ui/components/button';
import { Card } from '@repo/ui/components/card';
import { PageHeader } from '@repo/ui/page-header';
import { cn } from '@repo/ui/utils';
```

## Dependencies

- **Radix UI** — Accessible primitives (dialog, popover, select, tabs, etc.)
- **Framer Motion** — Layout animations
- **Lucide React** — Icon set
- **Recharts** — Chart components (peer dependency)
- **class-variance-authority** + **tailwind-merge** — Variant styling

## Testing

```bash
pnpm --filter @repo/ui test
```
