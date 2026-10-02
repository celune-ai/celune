'use client';

import { useState } from 'react';
import { MessageSquarePlus, Star, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageActionBar } from '@/components/page-action-bar';
import { Button } from '@repo/ui/components/button';
import { useWorkspace } from '@/providers/workspace-provider';
import { useCurrentUser } from '@/hooks/use-current-user';
import { fetchJson } from '@/lib/fetch-json';

const TYPE_LABELS: Record<string, string> = {
  general: 'General',
  feature_request: 'Feature Request',
  improvement: 'Improvement',
  praise: 'Praise',
  complaint: 'Complaint',
};

export default function FeedbackPage() {
  const { activeWorkspace } = useWorkspace();
  const currentUser = useCurrentUser();
  const workspaceId = activeWorkspace?.id;

  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('general');
  const [rating, setRating] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    setSubmitting(true);
    try {
      await fetchJson(`/api/support/feedback?workspace_id=${workspaceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentUser.displayName !== 'user' ? currentUser.displayName : null,
          email: currentUser.email ?? '',
          subject,
          message,
          type,
          rating: rating > 0 ? rating : null,
        }),
      });
      setSubmitted(true);
    } catch {
      toast.error('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-full flex-1 flex-col">
        <PageActionBar>
          <div className="flex items-center gap-2">
            <MessageSquarePlus size={16} className="text-foreground-muted" />
            <h1 className="text-foreground text-sm font-semibold">Leave Feedback</h1>
          </div>
        </PageActionBar>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="border-border bg-surface-75 max-w-md rounded-lg border p-8 text-center">
            <CheckCircle2 className="text-brand mx-auto mb-4 h-10 w-10" />
            <h2 className="text-foreground text-lg font-semibold">Thank you!</h2>
            <p className="text-foreground-lighter mt-2 text-sm">
              Your feedback has been submitted. We appreciate you taking the time to help us
              improve.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-6"
              onClick={() => {
                setSubmitted(false);
                setSubject('');
                setMessage('');
                setType('general');
                setRating(0);
              }}
            >
              Submit another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageActionBar>
        <div className="flex items-center gap-2">
          <MessageSquarePlus size={16} className="text-foreground-muted" />
          <h1 className="text-foreground text-sm font-semibold">Leave Feedback</h1>
        </div>
      </PageActionBar>

      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <p className="text-foreground-lighter mb-6 text-sm">
          Help us improve by sharing your thoughts, feature requests, or reporting issues.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-foreground-light block text-xs font-medium">Type</label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Feedback type">
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => setType(value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    type === value
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border text-foreground-lighter hover:border-border-strong'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-foreground-light block text-xs font-medium">
              Rating (optional)
            </label>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => setRating(rating === n ? 0 : n)}
                  className="p-0.5"
                >
                  <Star
                    className={`h-5 w-5 transition-colors ${
                      n <= rating
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-surface-300 hover:text-yellow-400/50'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fb-subject" className="text-foreground-light block text-xs font-medium">
              Subject
            </label>
            <input
              id="fb-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              placeholder="What's your feedback about?"
              className="border-border bg-surface-75 text-foreground placeholder:text-foreground-muted focus:border-brand focus:ring-brand/20 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fb-message" className="text-foreground-light block text-xs font-medium">
              Message
            </label>
            <textarea
              id="fb-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={6}
              maxLength={10000}
              aria-describedby="fb-message-count"
              placeholder="Tell us what you think..."
              className="border-border bg-surface-75 text-foreground placeholder:text-foreground-muted focus:border-brand focus:ring-brand/20 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
            />
            <p id="fb-message-count" className="text-foreground-muted text-right text-xs">
              {message.length.toLocaleString()} / 10,000
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="default" size="sm" disabled={submitting}>
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
