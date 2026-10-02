'use client';

import { useState, useRef, useCallback } from 'react';
import { Bug, Lightbulb, MessageCircle, Camera, X, Loader2, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/components/popover';
import { Button } from '@repo/ui/components/button';
import { Textarea } from '@repo/ui/components/textarea';
import { Label } from '@repo/ui/components/label';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { useWorkspace } from '@/providers/workspace-provider';
import { createClient } from '@repo/db/client';

type Category = 'bug_report' | 'feature_request' | 'general';
type Priority = 'low' | 'normal' | 'urgent';

const CATEGORIES: { value: Category; label: string; icon: typeof Bug }[] = [
  { value: 'bug_report', label: 'Bug', icon: Bug },
  { value: 'feature_request', label: 'Idea', icon: Lightbulb },
  { value: 'general', label: 'Other', icon: MessageCircle },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'urgent', label: 'Urgent' },
];

export function FeedbackPopover({
  children,
  userEmail,
  userName,
}: {
  children: React.ReactNode;
  userEmail?: string;
  userName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('bug_report');
  const [priority, setPriority] = useState<Priority>('normal');
  const [message, setMessage] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeWorkspace } = useWorkspace();

  const reset = useCallback(() => {
    setCategory('bug_report');
    setPriority('normal');
    setMessage('');
    setScreenshotFile(null);
    setScreenshotPreview(null);
    setSubmitted(false);
    setError(null);
  }, []);

  const handleScreenshot = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const VALID_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!VALID_MIMES.includes(file.type)) {
      setError('Only PNG, JPEG, GIF, and WebP images are allowed');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Screenshot must be under 5MB');
      return;
    }
    setScreenshotFile(file);
    const reader = new FileReader();
    reader.onload = () => setScreenshotPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeScreenshot = () => {
    setScreenshotFile(null);
    setScreenshotPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      let screenshot_url: string | null = null;

      // Upload screenshot if provided
      if (screenshotFile) {
        const supabase = createClient();
        const ext = screenshotFile.name.split('.').pop() ?? 'png';
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('feedback-screenshots')
          .upload(path, screenshotFile, { contentType: screenshotFile.type });
        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('feedback-screenshots')
            .getPublicUrl(path);
          screenshot_url = urlData.publicUrl;
        }
      }

      // Generate subject from category + first 50 chars of message
      const subjectPrefix =
        category === 'bug_report' ? 'Bug: ' : category === 'feature_request' ? 'Idea: ' : '';
      const subject = `${subjectPrefix}${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`;

      const wsParam = activeWorkspace?.id ? `?workspace_id=${activeWorkspace.id}` : '';
      await fetchJson(apiUrl(`/api/support/feedback${wsParam}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail ?? 'unknown@user.com',
          name: userName ?? null,
          subject,
          message,
          category,
          priority,
          screenshot_url,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
        }),
      });

      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        setTimeout(reset, 200);
      }, 1500);
    } catch {
      setError('Failed to send feedback. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v: boolean) => {
        setOpen(v);
        if (!v) setTimeout(reset, 200);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        sideOffset={16}
        align="end"
        sticky="always"
        className="border-border bg-surface-100 w-[380px] rounded-xl border p-0 shadow-xl"
      >
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-foreground text-sm font-medium">Thanks for your feedback!</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-foreground text-sm font-semibold">Provide Feedback</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-foreground-muted hover:text-foreground -mr-1 rounded p-1 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* Category toggles */}
              <div>
                <Label className="text-foreground-lighter mb-2 block text-xs font-medium">
                  Category
                </Label>
                <div className="flex gap-2">
                  {CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    const active = category === cat.value;
                    return (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={() => setCategory(cat.value)}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-xs font-medium transition-colors ${
                          active
                            ? 'border-white/20 bg-white/10 text-white'
                            : 'border-border text-foreground-lighter hover:bg-surface-200 hover:text-foreground'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Priority */}
              <div>
                <Label className="text-foreground-lighter mb-2 block text-xs font-medium">
                  Priority
                </Label>
                <div className="flex gap-2">
                  {PRIORITIES.map((p) => {
                    const active = priority === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setPriority(p.value)}
                        className={`flex-1 rounded border px-3 py-2 text-xs font-medium transition-colors ${
                          active
                            ? 'border-white/20 bg-white/10 text-white'
                            : 'border-border text-foreground-lighter hover:bg-surface-200'
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Message */}
              <div>
                <Label
                  htmlFor="feedback-message"
                  className="text-foreground-lighter mb-2 block text-xs font-medium"
                >
                  Message
                </Label>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setMessage(e.target.value)
                  }
                  placeholder={
                    category === 'bug_report'
                      ? 'What happened? What did you expect?'
                      : category === 'feature_request'
                        ? 'What would you like to see?'
                        : "Tell us what's on your mind..."
                  }
                  className="bg-surface-75 border-border min-h-[100px] resize-none text-sm"
                  maxLength={10000}
                />
              </div>

              {/* Screenshot */}
              <div>
                {screenshotPreview ? (
                  <div className="relative">
                    <img
                      src={screenshotPreview}
                      alt="Screenshot preview"
                      className="border-border h-24 w-full rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      onClick={removeScreenshot}
                      className="bg-surface-100/80 hover:bg-surface-200 absolute top-1 right-1 rounded-full p-1 backdrop-blur-sm"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="border-border text-foreground-lighter hover:bg-surface-200 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs transition-colors"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Attach screenshot
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshot}
                  className="hidden"
                />
              </div>

              {/* Error message */}
              {error && <p className="text-xs text-red-400">{error}</p>}

              {/* Submit */}
              <Button
                onClick={handleSubmit}
                disabled={!message.trim() || submitting}
                className="w-full"
                size="sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send Feedback'
                )}
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
