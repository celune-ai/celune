'use client';

import { useCallback, useEffect, useState } from 'react';
import { Settings, Trash2 } from 'lucide-react';
import { Button } from '@repo/ui/components/button';
import { Input } from '@repo/ui/components/input';
import { Textarea } from '@repo/ui/components/textarea';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/fetch-json';
import { AGENT_COLOR_PRESETS } from '@/lib/agent-colors';

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
];

interface AgentSettingsPanelProps {
  agentId: string;
  workspaceId: string;
  /** Initial values from the DB agent config */
  initialValues?: {
    display_name?: string;
    role?: string;
    description?: string;
    color?: string;
    persona_prompt?: string;
    model?: string;
  };
  onDeleted?: () => void;
  onSaved?: (values: Record<string, string | undefined>) => void;
}

export function AgentSettingsPanel({
  agentId,
  workspaceId,
  initialValues,
  onDeleted,
  onSaved,
}: AgentSettingsPanelProps) {
  const [displayName, setDisplayName] = useState(initialValues?.display_name ?? '');
  const [role, setRole] = useState(initialValues?.role ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [color, setColor] = useState(initialValues?.color ?? '#3DD68C');
  const [personaPrompt, setPersonaPrompt] = useState(initialValues?.persona_prompt ?? '');
  const [model, setModel] = useState(initialValues?.model ?? 'claude-sonnet-4-6');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync when initialValues load (use primitive deps to avoid re-firing on parent re-renders)
  const ivName = initialValues?.display_name;
  const ivRole = initialValues?.role;
  const ivDesc = initialValues?.description;
  const ivColor = initialValues?.color;
  const ivPrompt = initialValues?.persona_prompt;
  const ivModel = initialValues?.model;
  useEffect(() => {
    if (ivName !== undefined) setDisplayName(ivName ?? '');
    if (ivRole !== undefined) setRole(ivRole ?? '');
    if (ivDesc !== undefined) setDescription(ivDesc ?? '');
    if (ivColor !== undefined) setColor(ivColor ?? '#3DD68C');
    if (ivPrompt !== undefined) setPersonaPrompt(ivPrompt ?? '');
    if (ivModel !== undefined) setModel(ivModel ?? 'claude-sonnet-4-6');
  }, [ivName, ivRole, ivDesc, ivColor, ivPrompt, ivModel]);

  const handleSave = useCallback(async () => {
    if (saving || !displayName.trim()) return;
    setSaving(true);
    try {
      await fetchJson(`/api/agents/${agentId}/config?workspace_id=${workspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim(),
          role: role.trim() || undefined,
          description: description.trim() || undefined,
          color: color || undefined,
          persona_prompt: personaPrompt.trim() || undefined,
          model: model || undefined,
        }),
      });
      toast.success('Agent settings saved');
      setDirty(false);
      onSaved?.({
        display_name: displayName.trim(),
        role: role.trim(),
        description: description.trim() || undefined,
        color: color || undefined,
        persona_prompt: personaPrompt.trim() || undefined,
        model: model || undefined,
      });
    } catch {
      toast.error('Failed to save agent settings');
    } finally {
      setSaving(false);
    }
  }, [
    agentId,
    workspaceId,
    displayName,
    role,
    description,
    color,
    personaPrompt,
    model,
    saving,
    onSaved,
  ]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const data = await fetchJson<{ success?: boolean; error?: string }>(
        `/api/agents/${agentId}/config?workspace_id=${workspaceId}`,
        { method: 'DELETE' },
      );
      if (data.error) {
        toast.error(data.error);
        return;
      }
      toast.success('Agent removed');
      onDeleted?.();
    } catch {
      toast.error('Failed to delete agent');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [agentId, workspaceId, onDeleted]);

  const markDirty = useCallback(() => setDirty(true), []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4" />
            Agent Settings
          </h2>
          <p className="text-foreground-lighter mt-0.5 text-xs">
            Customize your agent&apos;s identity and behavior.
          </p>
        </div>
        {dirty && (
          <Button size="sm" onClick={handleSave} disabled={saving || !displayName.trim()}>
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        )}
      </div>

      <div className="border-border rounded-lg border p-4">
        <div className="space-y-4">
          {/* Display Name */}
          <div className="space-y-1.5">
            <label htmlFor="agent-display-name" className="text-foreground text-xs font-medium">
              Display Name
            </label>
            <Input
              id="agent-display-name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                markDirty();
              }}
              placeholder="Agent name"
              maxLength={100}
            />
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <label htmlFor="agent-role" className="text-foreground text-xs font-medium">
              Role
            </label>
            <Input
              id="agent-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                markDirty();
              }}
              placeholder="e.g. Lead Agent, Code Reviewer, Designer"
              maxLength={100}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="agent-description" className="text-foreground text-xs font-medium">
              Description
            </label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                markDirty();
              }}
              placeholder="What does this agent do?"
              rows={2}
              maxLength={2000}
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <label className="text-foreground text-xs font-medium">Color</label>
            <div className="flex items-center gap-2">
              {AGENT_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setColor(c);
                    markDirty();
                  }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    color === c
                      ? 'border-foreground scale-110'
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Select color ${c}`}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  markDirty();
                }}
                className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                title="Custom color"
              />
            </div>
          </div>

          {/* Model */}
          <div className="space-y-1.5">
            <label htmlFor="agent-model" className="text-foreground text-xs font-medium">
              Model
            </label>
            <select
              id="agent-model"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                markDirty();
              }}
              className="bg-surface-100 border-border text-foreground focus:ring-brand/30 w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Persona Prompt */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="agent-persona-prompt" className="text-foreground text-xs font-medium">
                Persona Prompt
              </label>
              <span className="text-foreground-lighter text-xs">{personaPrompt.length}/5000</span>
            </div>
            <Textarea
              id="agent-persona-prompt"
              value={personaPrompt}
              onChange={(e) => {
                setPersonaPrompt(e.target.value);
                markDirty();
              }}
              placeholder="System instructions that define this agent's personality and behavior..."
              rows={4}
              maxLength={5000}
            />
          </div>
        </div>
      </div>

      {/* Danger zone: Delete */}
      <div className="border-destructive/20 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-foreground text-sm font-medium">Remove Agent</p>
            <p className="text-foreground-lighter text-xs">
              Deactivate this agent. It can be re-created later.
            </p>
          </div>
          {!confirmDelete ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Removing...' : 'Confirm Remove'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
