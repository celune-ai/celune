export interface AgentConfig {
  id: string;
  workspace_id: string;
  agent_id: string;
  display_name: string;
  role: string | null;
  description: string | null;
  agent_type: 'ai' | 'human';
  model: string | null;
  color: string | null;
  icon: string | null;
  pod: string | null;
  persona_prompt: string | null;
  capabilities: string[] | null;
  parameters: Record<string, number> | null;
  voice_settings: import('./voice').VoiceSettings | null;
  active_profile: string | null;
  is_active: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrgSharedAgent {
  id: string;
  org_id: string;
  agent_id: string;
  display_name: string;
  role: string | null;
  description: string | null;
  agent_type: 'ai' | 'human';
  model: string | null;
  color: string | null;
  persona_prompt: string | null;
  capabilities: string[] | null;
  parameters: Record<string, number> | null;
  config: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentStatus {
  id: string;
  agent_name: string;
  status: 'online' | 'offline' | 'working' | 'idle';
  current_task_id: string | null;
  model: string | null;
  uptime_start: string | null;
  last_heartbeat: string | null;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  updated_at: string;
}
