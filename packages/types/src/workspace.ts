export type WorkspaceStatus = 'active' | 'draft' | 'archived' | 'deprecated';

export type PRStrategy = 'per_project' | 'per_task' | 'manual';
export type AutoPR = 'off' | 'draft_on_push' | 'ready_on_push';

export interface BranchNamingConfig {
  prefix: string;
  separator: string;
  include_assignee: boolean;
  slug_source: 'project_name' | 'task_title';
}

export interface GitHubSettings {
  pr_strategy: PRStrategy;
  auto_pr: AutoPR;
  branch_naming: BranchNamingConfig;
  default_reviewers: string[];
  rebase_threshold_commits: number;
  stale_pr_warning_days: number;
  agent_code_context: boolean;
  auto_sync_on_push: boolean;
  webhook_events: boolean;
}

export type PRStatus = 'draft' | 'open' | 'closed' | 'merged';
export type CIStatus = 'pending' | 'passing' | 'failing';
export type ReviewState = 'pending' | 'approved' | 'changes_requested' | 'commented' | 'dismissed';

export interface ProjectPR {
  id: string;
  project_id: string;
  task_id: string | null;
  workspace_id: string;
  pr_number: number;
  pr_url: string;
  branch_name: string;
  title: string | null;
  status: PRStatus;
  ci_status: CIStatus | null;
  review_state: ReviewState | null;
  files_changed: string[];
  additions: number;
  deletions: number;
  head_sha: string | null;
  base_branch: string;
  commits_behind_main: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

export interface FileConflict {
  conflicting_project_id: string;
  conflicting_project_name: string;
  conflicting_pr_number: number;
  conflicting_branch: string;
  overlapping_files: string[];
}

export type GitHubAccountType = 'Organization' | 'User';

export interface OrgGitHubInstallation {
  id: string;
  org_id: string;
  installation_id: number;
  github_account_login: string;
  github_account_avatar_url: string | null;
  github_account_type: GitHubAccountType;
  connected_by: string | null;
  connected_at: string;
  is_active: boolean;
}

export interface Workspace {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color_scheme: string | null;
  is_default: boolean;
  status: WorkspaceStatus;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Repository linking
  repo_url: string | null;
  repo_provider: 'github' | 'gitlab' | 'bitbucket';
  repo_path: string | null;
  repo_connected_at: string | null;
  github_installation_id: number | null;
  // Hierarchy: Main workspace (is_default=true) has no parent; children reference Main
  parent_workspace_id: string | null;
  // GitHub workflow settings
  github_settings: GitHubSettings | null;
}

/** Workspace with resolved children — returned by the tree-structured API */
export interface WorkspaceTree extends Workspace {
  children: Workspace[];
}

/**
 * Action that conversation handlers (voice, chat) can emit
 * to navigate or switch workspace context before performing operations.
 */
export interface ConversationAction {
  type: 'switch_workspace' | 'navigate';
  /** Workspace slug to switch to (for switch_workspace) */
  workspace?: string;
  /** Page path to navigate to, e.g. '/tasks' (for navigate) */
  path?: string;
}
