# Celune Design Tokens & Component Inventory

> Auto-generated reference for the Celune design system.
> Source: `packages/ui/src/theme.css` + `packages/ui/src/components/`

---

## Token Architecture

Two-layer system (Supabase-inspired):

1. **Primitive scales** (`:root`) — raw HSL values, not used directly in components
2. **Semantic tokens** (`.dark` / `.light`) — purpose-driven aliases

All colors stored as `hsl()` for direct CSS usability. Dark mode is default.

---

## Color Tokens

### Foreground

| Token                   | Usage                             |
| ----------------------- | --------------------------------- |
| `--foreground-default`  | Primary text, headings            |
| `--foreground-light`    | Secondary text, descriptions      |
| `--foreground-lighter`  | Tertiary text, timestamps         |
| `--foreground-muted`    | Placeholder text, disabled states |
| `--foreground-contrast` | Text on colored backgrounds       |

### Background / Surface

| Token                       | Usage                                     |
| --------------------------- | ----------------------------------------- |
| `--background-default`      | Page background                           |
| `--background-surface-75`   | Card backgrounds, elevated surfaces       |
| `--background-surface-100`  | Input backgrounds, subtle containers      |
| `--background-surface-200`  | Active/selected states, hover backgrounds |
| `--background-surface-300`  | Borders on interactive elements           |
| `--background-surface-400`  | Strong dividers                           |
| `--background-dash-sidebar` | Sidebar background                        |
| `--background-dash-canvas`  | Main content area                         |
| `--background-overlay`      | Dropdown/popover backgrounds              |
| `--background-dialog`       | Modal/dialog backgrounds                  |

### Brand

| Token             | Usage                               |
| ----------------- | ----------------------------------- |
| `--brand-default` | Primary brand color (#5BC586 green) |
| `--brand-500`     | Brand at medium weight              |
| `--brand-600`     | Brand hover/active state            |
| `--brand-button`  | Brand-colored button backgrounds    |

### Border

| Token               | Usage                                 |
| ------------------- | ------------------------------------- |
| `--border-default`  | Standard borders                      |
| `--border-muted`    | Subtle borders (cards, containers)    |
| `--border-strong`   | High-contrast borders (focus, active) |
| `--border-stronger` | Maximum contrast borders              |
| `--border-overlay`  | Dropdown/popover borders              |
| `--border-button`   | Button borders                        |

### Status Colors

| Token             | Usage                               |
| ----------------- | ----------------------------------- |
| `--destructive-*` | Error states, delete actions        |
| `--warning-*`     | Warning states, caution indicators  |
| `--brand-*`       | Success states, positive indicators |

---

## Spacing & Radius

| Token           | Value  | Usage                           |
| --------------- | ------ | ------------------------------- |
| `--radius-sm`   | 4px    | Small chips, tags               |
| `--radius-md`   | 6px    | Buttons, inputs (default)       |
| `--radius-lg`   | 8px    | Cards, dialogs                  |
| `--radius-xl`   | 16px   | Large containers, hero elements |
| `--radius-full` | 9999px | Pills, circular avatars         |

---

## Badge Color Palette

7-color system for status badges (defined in `badge.tsx`):

| Variant        | Color  | Usage                         |
| -------------- | ------ | ----------------------------- |
| `emerald-dark` | Green  | Active, success, enabled      |
| `gold-dark`    | Amber  | Warning, pending, in-progress |
| `rose-dark`    | Red    | Error, blocked, urgent        |
| `blue-dark`    | Blue   | Info, new, assigned           |
| `violet-dark`  | Purple | Planning, review              |
| `amber-dark`   | Orange | Paused, deferred              |
| `slate-dark`   | Gray   | Archived, inactive            |

---

## Component Inventory (31 components)

### Layout & Navigation

| Component       | Path                                               | Description                                                               |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `PageSidebar`   | `packages/ui/src/page-sidebar.tsx`                 | Collapsible sidebar with sections, badges, active indicator (FM animated) |
| `PageTabs`      | `apps/platform/src/components/page-tabs.tsx`       | Tab bar with droppable + animated indicator variants                      |
| `PageActionBar` | `apps/platform/src/components/page-action-bar.tsx` | Sticky action bar at top of page content                                  |
| `Nav`           | `packages/ui/src/nav.tsx`                          | Top navigation bar with brand + links                                     |
| `AppIconRail`   | `packages/ui/src/app-icon-rail.tsx`                | Vertical icon-only sidebar for app switching                              |

### Data Display

| Component    | Path                                         | Description                                  |
| ------------ | -------------------------------------------- | -------------------------------------------- |
| `Badge`      | `packages/ui/src/components/badge.tsx`       | 7-color status badges with size variants     |
| `Card`       | `packages/ui/src/components/card.tsx`        | Content container with header/content/footer |
| `MetricCard` | `packages/ui/src/components/metric-card.tsx` | KPI display with trend indicator             |
| `Table`      | `packages/ui/src/components/table.tsx`       | Data table with header, body, cell variants  |
| `Skeleton`   | `packages/ui/src/components/skeleton.tsx`    | Loading placeholder                          |
| `Progress`   | `packages/ui/src/components/progress.tsx`    | Progress bar                                 |
| `ScrollArea` | `packages/ui/src/components/scroll-area.tsx` | Custom scrollbar container                   |

### Charts

| Component      | Path                                            | Description                     |
| -------------- | ----------------------------------------------- | ------------------------------- |
| `BarChart`     | `packages/ui/src/components/bar-chart.tsx`      | Recharts bar chart wrapper      |
| `LineChart`    | `packages/ui/src/components/line-chart.tsx`     | Recharts line chart wrapper     |
| `LogsBarChart` | `packages/ui/src/components/logs-bar-chart.tsx` | Specialized log frequency chart |
| `Chart`        | `packages/ui/src/components/chart.tsx`          | Base chart container/config     |

### Forms & Input

| Component    | Path                                         | Description                                   |
| ------------ | -------------------------------------------- | --------------------------------------------- |
| `Button`     | `packages/ui/src/components/button.tsx`      | Primary, outline, ghost, destructive variants |
| `Input`      | `packages/ui/src/components/input.tsx`       | Text input with label support                 |
| `NakedInput` | `packages/ui/src/components/naked-input.tsx` | Borderless input for inline editing           |
| `Textarea`   | `packages/ui/src/components/textarea.tsx`    | Multi-line text input                         |
| `Select`     | `packages/ui/src/components/select.tsx`      | Dropdown select (Radix)                       |
| `Checkbox`   | `packages/ui/src/components/checkbox.tsx`    | Check toggle (Radix)                          |
| `Switch`     | `packages/ui/src/components/switch.tsx`      | On/off toggle (Radix)                         |
| `RadioGroup` | `packages/ui/src/components/radio-group.tsx` | Radio button group (Radix)                    |
| `Toggle`     | `packages/ui/src/components/toggle.tsx`      | Press toggle (Radix)                          |
| `Label`      | `packages/ui/src/components/label.tsx`       | Form label (Radix)                            |

### Overlay & Feedback

| Component      | Path                                           | Description                   |
| -------------- | ---------------------------------------------- | ----------------------------- |
| `Dialog`       | `packages/ui/src/components/dialog.tsx`        | Modal dialog (Radix)          |
| `Popover`      | `packages/ui/src/components/popover.tsx`       | Floating popover (Radix)      |
| `DropdownMenu` | `packages/ui/src/components/dropdown-menu.tsx` | Context/dropdown menu (Radix) |
| `Accordion`    | `packages/ui/src/components/accordion.tsx`     | Expandable sections (Radix)   |
| `Alert`        | `packages/ui/src/components/alert.tsx`         | Inline alert/banner           |
| `Tabs`         | `packages/ui/src/components/tabs.tsx`          | Content tabs (Radix)          |

### Specialized

| Component          | Path                                                  | Description                      |
| ------------------ | ----------------------------------------------------- | -------------------------------- |
| `Avatar`           | `packages/ui/src/components/avatar.tsx`               | User/agent avatar with fallback  |
| `Separator`        | `packages/ui/src/components/separator.tsx`            | Horizontal/vertical divider      |
| `SupportChat`      | `packages/ui/src/components/support-chat.tsx`         | Floating support widget          |
| `BracketLink`      | `apps/platform/src/components/bracket-link.tsx`       | Link with [ ] hover animation    |
| `SkillCard`        | `apps/platform/src/components/skill-card.tsx`         | Skill catalog entry card         |
| `SkillPackBrowser` | `apps/platform/src/components/skill-pack-browser.tsx` | Skill pack browsing + install UI |

---

## Animation Tokens (Framer Motion)

| Pattern        | Props                                                  | Usage                         |
| -------------- | ------------------------------------------------------ | ----------------------------- |
| Tab indicator  | `layoutId="page-tab-indicator"`, spring(500, 30)       | PageTabs active underline     |
| Sidebar active | `layoutId="sidebar-active-indicator"`, spring(500, 30) | PageSidebar active background |
| Bracket hover  | CSS transition 200ms                                   | BracketLink [ ] appearance    |

---

## Dark Mode

Default theme is dark (`.dark` on `<html>`). Theme tokens swap automatically via CSS variables. Components should never use raw color values — always reference semantic tokens.

**Convention**: All new components must use `--foreground-*`, `--background-*`, `--border-*`, and `--brand-*` tokens. No hardcoded colors.
