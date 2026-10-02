export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_TYPES = ['feature', 'system', 'research', 'plan'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

export const PRD_STATUSES = ['draft', 'review', 'approved'] as const;
export type PrdStatus = (typeof PRD_STATUSES)[number];

export interface PrdMetadata {
  author: string;
  status: PrdStatus;
  agents_involved: string[];
  created_date: string;
  reviewed_by?: string[];
  review_date?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  project_type: ProjectType;
  priority: ProjectPriority;
  category: string | null;
  target_date: string | null;
  vault_path: string | null;
  metadata: Record<string, unknown> | null;
  prd_content: string | null;
  prd_metadata: PrdMetadata | null;
  group_id: string | null;
  user_id: string | null;
  org_id: string | null;
  workspace_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProjectInsert = Omit<Project, 'id' | 'created_at' | 'updated_at'>;
export type ProjectUpdate = Partial<ProjectInsert>;

// --- Project Groups (Epics) ---

export interface ProjectGroup {
  id: string;
  name: string;
  description: string | null;
  user_id: string | null;
  org_id: string | null;
  workspace_id: string | null;
  metadata: Record<string, unknown> | null;
  branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  base_branch: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProjectGroupInsert = Omit<
  ProjectGroup,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'metadata'
  | 'branch'
  | 'pr_url'
  | 'pr_number'
  | 'base_branch'
> &
  Partial<Pick<ProjectGroup, 'metadata' | 'branch' | 'pr_url' | 'pr_number' | 'base_branch'>>;
export type ProjectGroupUpdate = Partial<ProjectGroupInsert>;

// --- Document label helpers ---

/** Categories where the project document should be called "PRD" instead of "Brief". */
const ENGINEERING_CATEGORIES = new Set([
  'engineering',
  'security',
  'infrastructure',
  'performance',
  'dx',
  'platform',
  'agent-system',
  'agent',
  'product',
]);

/**
 * Returns "PRD" for engineering/product projects, "Brief" for everything else.
 * Uses project_type and category to determine the label.
 */
export function getProjectDocLabel(
  projectType: ProjectType | string | null | undefined,
  category: string | null | undefined,
): { label: string; shortLabel: string } {
  // System projects always use PRD
  if (projectType === 'system')
    return { label: 'Product Requirements Document', shortLabel: 'PRD' };
  // Research projects always use Brief
  if (projectType === 'research') return { label: 'Project Brief', shortLabel: 'Brief' };
  // Feature/plan: check category
  if (category && ENGINEERING_CATEGORIES.has(category)) {
    return { label: 'Product Requirements Document', shortLabel: 'PRD' };
  }
  // Non-engineering projects: plan type or any non-engineering category → Brief
  if (projectType === 'plan' || category) {
    return { label: 'Project Brief', shortLabel: 'Brief' };
  }
  // Default (feature with no category): PRD
  return { label: 'Product Requirements Document', shortLabel: 'PRD' };
}
