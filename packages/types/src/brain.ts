/** Tier levels for brain manifest files */
export type BrainTier = 'essential' | 'standard' | 'premium';

/** Categories of brain manifest files */
export type BrainCategory =
  'skill' | 'hook' | 'agent' | 'agent_doc' | 'memory' | 'settings' | 'delegation';

/** Three-tier ownership scope for brain components */
export type BrainOwnershipScope = 'core' | 'org' | 'workspace';

/** Integration group for categorizing brain components/updates */
export type BrainIntegrationGroup = 'github' | 'slack' | 'voice' | 'byok';

/** How a skill was installed into a workspace */
export type SkillInstallSource = 'bootstrap' | 'pack' | 'byo' | 'manual';

/** Skill pack marketplace categories */
export type SkillPackCategory =
  'workflow' | 'devops' | 'research' | 'content' | 'integration' | 'custom';

/** A brain manifest entry tracking a brain file per workspace */
export interface BrainManifest {
  id: string;
  workspace_id: string;
  org_id: string | null;
  path: string;
  content_hash: string;
  version: string;
  tier: BrainTier;
  category: BrainCategory;
  ownership_scope: BrainOwnershipScope;
  integration_group: BrainIntegrationGroup | null;
  is_core: boolean;
  is_forked: boolean;
  forked_at: string | null;
  update_available: boolean;
  update_summary: string | null;
  /** Human-readable description */
  description: string | null;
  /** Searchable tags */
  tags: string[];
  /** The skill pack this entry was installed from (null if not from a pack) */
  skill_pack_id: string | null;
  /** How this skill was installed */
  install_source: SkillInstallSource;
  /** Whether the skill is currently enabled */
  is_enabled: boolean;
  /** Quality score for BYO skills (0-1), null for core */
  quality_score: number | null;
  created_at: string;
  updated_at: string;
}

/** A per-section content hash for a brain manifest file */
export interface BrainSectionHash {
  id: string;
  manifest_id: string;
  section_key: string;
  content_hash: string;
  is_forked: boolean;
  update_available: boolean;
  update_summary: string | null;
  created_at: string;
  updated_at: string;
}

/** A skill entry within a skill pack */
export interface SkillPackEntry {
  path: string;
  category: BrainCategory;
  tier: BrainTier;
  description: string;
  version?: string;
}

/** Plan names used for skill pack gating (maps to billing Plan type) */
export type SkillPackMinPlan = 'builder' | 'pro' | 'unlimited';

/** A packaged collection of skills available in the marketplace */
export interface SkillPack {
  id: string;
  slug: string;
  name: string;
  description: string;
  pack_category: SkillPackCategory;
  min_tier: SkillPackMinPlan;
  version: string;
  author: string;
  icon: string | null;
  tags: string[];
  is_published: boolean;
  is_official: boolean;
  install_count: number;
  skill_entries: SkillPackEntry[];
  team_type_affinity: Record<string, number>;
  created_at: string;
  updated_at: string;
}

/** Record of a skill pack installed in a workspace */
export interface SkillPackInstall {
  id: string;
  workspace_id: string;
  skill_pack_id: string;
  installed_by: string;
  installed_at: string;
  version_installed: string;
}

/** Progressive disclosure tier for skill loading */
export interface SkillLoadTier {
  tier: BrainTier;
  max_skills: number;
  max_agents: number;
}

/** Result of BYO skill validation */
export interface BYOSkillValidation {
  valid: boolean;
  quality_score: number;
  errors: string[];
  warnings: string[];
}
