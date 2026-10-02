'use client';

import { useState, useEffect } from 'react';
import { useWorkspace } from '@/providers/workspace-provider';
import { useCurrentUser } from '@/hooks/use-current-user';
import { apiUrl } from '@repo/db/api';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  MessageSquare,
  LifeBuoy,
  BookOpen,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { useWorkspaceHref } from '@/hooks/use-workspace-href';
import { URL_DOCS } from '@/lib/branding';

type Category = 'bug' | 'feature' | 'billing' | 'general';
type Priority = 'low' | 'normal' | 'urgent';

const CATEGORIES: { value: Category; label: string; description: string }[] = [
  {
    value: 'bug',
    label: 'Bug Report',
    description: 'Something is broken or not working correctly',
  },
  {
    value: 'feature',
    label: 'Feature Request',
    description: 'Suggest a new feature or improvement',
  },
  {
    value: 'billing',
    label: 'Billing Question',
    description: 'Questions about your plan or invoices',
  },
  { value: 'general', label: 'General', description: 'Anything else we can help with' },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low — not urgent' },
  { value: 'normal', label: 'Normal — regular priority' },
  { value: 'urgent', label: 'Urgent — blocking my work' },
];

interface FormState {
  name: string;
  email: string;
  subject: string;
  message: string;
  category: Category;
  priority: Priority;
}

export default function SupportPage() {
  const { activeWorkspace } = useWorkspace();
  const { workspaceHref } = useWorkspaceHref();
  const currentUser = useCurrentUser();

  const [form, setForm] = useState<FormState>({
    name: '',
    email: '',
    subject: '',
    message: '',
    category: 'general',
    priority: 'normal',
  });

  // Auto-fill name and email from authenticated user — only if fields are still empty
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      name: prev.name || (currentUser.displayName !== 'user' ? currentUser.displayName : ''),
      email: prev.email || currentUser.email || '',
    }));
  }, [currentUser.displayName, currentUser.email]);

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ ticket_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const res = await fetch(
        apiUrl(
          `/api/support/tickets${activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : ''}`,
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...form,
            org_id: activeWorkspace?.org_id ?? undefined,
            workspace_id: activeWorkspace?.id ?? undefined,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        if (data.details) {
          const errs: Record<string, string> = {};
          for (const d of data.details) {
            errs[d.path] = d.message;
          }
          setFieldErrors(errs);
          setError('Please fix the highlighted fields.');
        } else {
          setError(data.error ?? 'Failed to submit ticket. Please try again.');
        }
        return;
      }

      setSuccess({ ticket_id: data.ticket_id });
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setSuccess(null);
    setError(null);
    setFieldErrors({});
    setForm({
      name: '',
      email: '',
      subject: '',
      message: '',
      category: 'general',
      priority: 'normal',
    });
  }

  if (success) {
    return (
      <div className="flex min-h-screen flex-col">
        <PageActionBar>
          <h1 className="text-foreground text-sm font-medium">Support</h1>
        </PageActionBar>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="bg-brand/10 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
              <CheckCircle2 className="text-brand h-7 w-7" />
            </div>
            <h2 className="text-foreground mb-2 text-xl font-semibold">Ticket submitted</h2>
            <p className="text-foreground-lighter mb-1 text-sm leading-relaxed">
              We received your message and will get back to you within 1–2 business days.
            </p>
            <p className="text-foreground-muted mb-6 font-mono text-xs">
              Ref: {success.ticket_id.slice(0, 8).toUpperCase()}
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={handleReset}>
                Submit another
              </Button>
              <Button variant="default" size="sm" asChild>
                <Link href={workspaceHref('/')}>Back to dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageActionBar>
        <h1 className="text-foreground text-sm font-medium">Support</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={workspaceHref('/support/help')}>
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              Help Center
            </Link>
          </Button>
        </div>
      </PageActionBar>

      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <div className="bg-surface-200 mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg">
            <LifeBuoy className="text-foreground-light h-5 w-5" />
          </div>
          <h2 className="text-foreground mb-1 text-2xl font-semibold tracking-tight">
            Contact Support
          </h2>
          <p className="text-foreground-lighter text-sm leading-relaxed">
            Have a question or hit a snag? We typically respond within one business day.
          </p>
        </div>

        {/* Quick links */}
        <div className="border-border bg-surface-75 mb-8 grid grid-cols-2 gap-3 rounded-lg border p-4">
          <a
            href={URL_DOCS}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border bg-surface-100 hover:bg-surface-200 flex items-center gap-2.5 rounded-md border p-3 transition-colors"
          >
            <BookOpen className="text-foreground-lighter h-4 w-4 shrink-0" />
            <div>
              <p className="text-foreground text-xs font-medium">Documentation</p>
              <p className="text-foreground-muted text-[11px]">Guides & API reference</p>
            </div>
            <ExternalLink className="text-foreground-muted ml-auto h-3 w-3 shrink-0" />
          </a>
          <Link
            href={workspaceHref('/support/help')}
            className="border-border bg-surface-100 hover:bg-surface-200 flex items-center gap-2.5 rounded-md border p-3 transition-colors"
          >
            <MessageSquare className="text-foreground-lighter h-4 w-4 shrink-0" />
            <div>
              <p className="text-foreground text-xs font-medium">Help Center</p>
              <p className="text-foreground-muted text-[11px]">FAQ & common questions</p>
            </div>
          </Link>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name + Email row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-foreground-light block text-xs font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Jane Smith"
                required
                className={[
                  'border-border-control bg-surface-75 text-foreground placeholder:text-foreground-muted w-full rounded-md border px-3 py-2 text-sm transition-colors outline-none',
                  'focus:border-brand focus:ring-brand/20 focus:ring-2',
                  fieldErrors.name ? 'border-destructive' : '',
                ].join(' ')}
              />
              {fieldErrors.name && (
                <p className="text-destructive text-[11px]">{fieldErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-foreground-light block text-xs font-medium">
                Email <span className="text-destructive">*</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="jane@company.com"
                required
                className={[
                  'border-border-control bg-surface-75 text-foreground placeholder:text-foreground-muted w-full rounded-md border px-3 py-2 text-sm transition-colors outline-none',
                  'focus:border-brand focus:ring-brand/20 focus:ring-2',
                  fieldErrors.email ? 'border-destructive' : '',
                ].join(' ')}
              />
              {fieldErrors.email && (
                <p className="text-destructive text-[11px]">{fieldErrors.email}</p>
              )}
            </div>
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label className="text-foreground-light block text-xs font-medium">
              Category <span className="text-destructive">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => set('category', cat.value)}
                  className={[
                    'rounded-md border px-3 py-2.5 text-left text-xs transition-colors',
                    form.category === cat.value
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border-control bg-surface-75 text-foreground-lighter hover:bg-surface-100',
                  ].join(' ')}
                >
                  <p className="font-medium">{cat.label}</p>
                  <p className="text-foreground-muted mt-0.5 text-[10px] leading-tight">
                    {cat.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="text-foreground-light block text-xs font-medium">Priority</label>
            <div className="flex flex-wrap gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set('priority', p.value)}
                  className={[
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    form.priority === p.value
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border-control bg-surface-75 text-foreground-lighter hover:bg-surface-100',
                  ].join(' ')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1.5">
            <label htmlFor="subject" className="text-foreground-light block text-xs font-medium">
              Subject <span className="text-destructive">*</span>
            </label>
            <input
              id="subject"
              type="text"
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              placeholder="Brief description of the issue"
              required
              maxLength={500}
              className={[
                'border-border-control bg-surface-75 text-foreground placeholder:text-foreground-muted w-full rounded-md border px-3 py-2 text-sm transition-colors outline-none',
                'focus:border-brand focus:ring-brand/20 focus:ring-2',
                fieldErrors.subject ? 'border-destructive' : '',
              ].join(' ')}
            />
            {fieldErrors.subject && (
              <p className="text-destructive text-[11px]">{fieldErrors.subject}</p>
            )}
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <label htmlFor="message" className="text-foreground-light block text-xs font-medium">
              Message <span className="text-destructive">*</span>
            </label>
            <textarea
              id="message"
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
              placeholder="Describe your issue in detail. Include steps to reproduce, error messages, or screenshots if applicable."
              required
              rows={6}
              maxLength={10000}
              className={[
                'border-border-control bg-surface-75 text-foreground placeholder:text-foreground-muted w-full resize-y rounded-md border px-3 py-2 text-sm transition-colors outline-none',
                'focus:border-brand focus:ring-brand/20 focus:ring-2',
                fieldErrors.message ? 'border-destructive' : '',
              ].join(' ')}
            />
            <div className="flex items-start justify-between">
              <div>
                {fieldErrors.message && (
                  <p className="text-destructive text-[11px]">{fieldErrors.message}</p>
                )}
              </div>
              <p className="text-foreground-muted ml-auto text-[11px]">
                {form.message.length} / 10,000
              </p>
            </div>
          </div>

          {/* Global error */}
          {error && (
            <div className="border-destructive/30 bg-destructive/10 flex items-start gap-2 rounded-md border px-3 py-2.5">
              <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-destructive text-xs">{error}</p>
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <p className="text-foreground-muted mr-auto text-[11px]">
              We respond within 1–2 business days.
            </p>
            <Button type="submit" variant="default" size="md" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                'Submit Ticket'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
