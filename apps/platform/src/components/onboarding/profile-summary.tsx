'use client';

import { useState } from 'react';
import { ArrowRight, Crown, Loader2, Sparkles, Target, User, Users, Briefcase } from 'lucide-react';
import { Button } from '@repo/ui/components/button';

interface ProfileData {
  summary: string;
  role: string;
  goals: string[];
  working_style: string;
  challenges: string[];
  agent_team: Array<{ name: string; role: string; reason: string }>;
  suggested_project: {
    name: string;
    description: string;
    tasks: string[];
  };
}

interface ProfileSummaryProps {
  profile: ProfileData;
  onConfirm: () => void;
  onBack: () => void;
  confirming: boolean;
}

export function ProfileSummary({ profile, onConfirm, onBack, confirming }: ProfileSummaryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center px-6 py-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h2 className="mb-2 text-2xl font-semibold tracking-tight text-white lg:text-3xl">
          Here&apos;s what I learned
        </h2>
        <p className="text-sm text-white/50">
          Review your profile. This shapes your workspace, agents, and first project.
        </p>
      </div>

      {/* Profile Card */}
      <div className="w-full space-y-5">
        {/* Summary */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/40">
            <Briefcase className="h-3.5 w-3.5" />
            {profile.role}
          </div>
          <p className="text-sm leading-relaxed text-white/80">{profile.summary}</p>
        </div>

        {/* Goals */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-white/40">
            <Target className="h-3.5 w-3.5" />
            Goals
          </div>
          <ul className="space-y-2">
            {profile.goals.map((goal, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/30" />
                {goal}
              </li>
            ))}
          </ul>
        </div>

        {/* Agent Team */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-white/40">
            <Users className="h-3.5 w-3.5" />
            Your Agent Team
          </div>
          <div className="space-y-1">
            {/* User (owner) — always at top */}
            <div className="flex items-center gap-2.5 rounded-lg p-2.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
                <User className="h-3.5 w-3.5 text-white/60" />
              </div>
              <span className="text-sm font-medium text-white/80">You</span>
              <span className="text-xs text-white/40">Owner</span>
            </div>

            {/* Lead agent — first in the team array */}
            {profile.agent_team.length > 0 &&
              (() => {
                const lead = profile.agent_team[0];
                return (
                  <button
                    key="lead"
                    type="button"
                    onClick={() => setExpanded(expanded === lead.name ? null : lead.name)}
                    className="w-full rounded-lg py-2.5 pr-2.5 pl-7 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3DD68C]/15">
                        <Crown className="h-3.5 w-3.5 text-[#3DD68C]" />
                      </div>
                      <span className="text-sm font-medium text-white/80">{lead.name}</span>
                      <span className="text-xs text-white/40">{lead.role}</span>
                    </div>
                    {expanded === lead.name && (
                      <p className="mt-1.5 ml-[34px] text-xs leading-relaxed text-white/50">
                        {lead.reason}
                      </p>
                    )}
                  </button>
                );
              })()}

            {/* Sub-agents — indented under the lead */}
            {profile.agent_team.slice(1).map((agent, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setExpanded(expanded === agent.name ? null : agent.name)}
                className="w-full rounded-lg py-2.5 pr-2.5 pl-14 text-left transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06]">
                    <span className="text-[10px] font-bold text-white/50">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-white/70">{agent.name}</span>
                  <span className="text-xs text-white/40">{agent.role}</span>
                </div>
                {expanded === agent.name && (
                  <p className="mt-1.5 ml-[34px] text-xs leading-relaxed text-white/50">
                    {agent.reason}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Suggested Project */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-white/40">
            <Sparkles className="h-3.5 w-3.5" />
            Suggested First Project
          </div>
          <p className="mb-2 text-sm font-medium text-white/80">{profile.suggested_project.name}</p>
          <p className="mb-3 text-xs text-white/50">{profile.suggested_project.description}</p>
          <ul className="space-y-1.5">
            {profile.suggested_project.tasks.slice(0, 5).map((task, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-white/60">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/20" />
                {task}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-8 flex w-full items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={confirming}
          className="text-sm text-white/40 transition-colors hover:text-white/60 disabled:opacity-30"
        >
          Back to conversation
        </button>
        <Button onClick={onConfirm} disabled={confirming} className="gap-2 px-8 py-3 text-black">
          {confirming ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Setting up...
            </>
          ) : (
            <>
              Looks Good — Set Up My Workspace
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
