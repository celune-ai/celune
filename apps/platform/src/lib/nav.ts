import {
  KanbanSquare,
  FolderKanban,
  Brain,
  Bot,
  BarChart3,
  BookOpen,
  Zap,
  Activity,
  MessageSquarePlus,
  type LucideIcon,
} from 'lucide-react';
import { type PageSidebarSection } from '@repo/ui/page-sidebar';
import { type UserRole } from './roles';
import { URL_DOCS } from './branding';

export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  bottom?: boolean;
  external?: boolean;
  sections: PageSidebarSection[];
  minRole?: UserRole;
  /** If set, this nav item requires the specified plan feature to be visible. */
  requiredFeature?: string;
  /** If true, render a divider line before this item in the nav. */
  dividerBefore?: boolean;
  /** If true, this nav item opens the feedback popover instead of navigating. */
  isFeedbackTrigger?: boolean;
}

export const adminNav: AdminNavItem[] = [
  {
    label: 'Tasks',
    href: '/tasks',
    icon: KanbanSquare,
    sections: [
      {
        title: 'Board',
        items: [{ label: 'Kanban', href: '/tasks' }],
      },
    ],
  },
  {
    label: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    sections: [
      {
        title: 'Projects',
        items: [{ label: 'All Projects', href: '/projects' }],
      },
    ],
  },
  {
    label: 'Agents',
    href: '/agents',
    icon: Bot,
    sections: [
      {
        title: 'Agents',
        items: [{ label: 'All Agents', href: '/agents' }],
      },
    ],
  },
  {
    label: 'Skills',
    href: '/skills',
    icon: Zap,
    sections: [
      {
        title: 'Skills',
        items: [{ label: 'Skill Library', href: '/skills' }],
      },
    ],
  },
  {
    label: 'Memory',
    href: '/memory',
    icon: Brain,
    sections: [
      {
        title: 'Second Brain',
        items: [{ label: 'Search & Browse', href: '/memory' }],
      },
    ],
  },
  {
    label: 'Heartbeat',
    href: '/heartbeat',
    icon: Activity,
    requiredFeature: 'heartbeat',
    sections: [
      {
        title: 'Heartbeat',
        items: [{ label: 'Overview', href: '/heartbeat' }],
      },
    ],
  },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    minRole: 'admin',
    requiredFeature: 'analytics',
    sections: [
      {
        title: 'Analytics',
        items: [
          { label: 'Overview', href: '/analytics/overview' },
          { label: 'Cost', href: '/analytics/cost' },
          { label: 'Agents', href: '/analytics/agents' },
        ],
      },
    ],
  },
  {
    label: 'Docs',
    href: URL_DOCS,
    icon: BookOpen,
    bottom: true,
    external: true,
    sections: [],
  },
  {
    label: 'Provide Feedback',
    href: '/support',
    icon: MessageSquarePlus,
    bottom: true,
    dividerBefore: true,
    /** When true, the nav renders a popover trigger instead of a link. */
    isFeedbackTrigger: true,
    sections: [
      {
        title: 'Need help?',
        items: [
          { label: 'Support', href: '/support' },
          { label: 'Help Center', href: '/support/help' },
        ],
      },
    ],
  },
];

/* Backward compat — mobile nav still uses this shape */
export interface McNavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const mcNav: McNavItem[] = adminNav.map((item) => ({
  title: item.label,
  href: item.href,
  icon: item.icon,
}));
