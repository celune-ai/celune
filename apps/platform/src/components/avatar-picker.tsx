'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Camera, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@repo/db/client';
import { apiUrl } from '@repo/db/api';
import { fetchJson } from '@/lib/fetch-json';
import { DEFAULT_AVATARS } from '@/lib/default-avatars';

/** Bot avatar options — illustrated robot characters */
const BOT_AVATARS = Array.from({ length: 9 }, (_, i) => `/avatars/bots/bot${i + 1}.jpg`);

/** Combined avatar library — bots first, then geometric shapes */
const ALL_AVATARS = [...BOT_AVATARS, ...DEFAULT_AVATARS];

interface AvatarPickerProps {
  /** Current avatar URL (Supabase storage URL or default icon path). */
  avatarUrl: string | null;
  /** Fallback text (first letter shown when no avatar). */
  fallbackText?: string;
  /** Called after avatar changes (new URL). */
  onAvatarChange: (url: string) => void;
  /** @deprecated No longer used. All avatars shown in grid. */
  excludeAgentAvatars?: boolean;
  /** Size in pixels. Default 64. */
  size?: number;
  /** If true, persist the avatar to the user profile API. Default true. */
  persistToProfile?: boolean;
}

export function AvatarPicker({
  avatarUrl,
  fallbackText = '?',
  onAvatarChange,
  size = 64,
  persistToProfile = true,
}: AvatarPickerProps) {
  const [uploading, setUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const currentAvatar = avatarUrl || null;

  // Close picker on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPicker]);

  const persistAvatar = useCallback(
    (url: string) => {
      if (!persistToProfile) return;
      fetchJson(apiUrl('/api/user/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: url }),
      }).catch(() => {
        /* Fire-and-forget */
      });
    },
    [persistToProfile],
  );

  function handleSelect(url: string) {
    onAvatarChange(url);
    persistAvatar(url);
    setShowPicker(false);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      if (persistToProfile) {
        await fetchJson(apiUrl('/api/user/profile'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar_url: publicUrl }),
        });
      }

      onAvatarChange(publicUrl);
      setShowPicker(false);
      toast.success('Avatar updated');
    } catch {
      toast.error('Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div ref={pickerRef} className="relative inline-block">
      {/* Avatar button */}
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="group relative overflow-hidden rounded-full"
      >
        {currentAvatar ? (
          <Image
            src={currentAvatar}
            alt="Avatar"
            className="rounded-full object-cover"
            style={{ width: size, height: size }}
            width={size}
            height={size}
            unoptimized
          />
        ) : (
          <div
            className="flex items-center justify-center rounded-full text-xl font-bold"
            style={{
              width: size,
              height: size,
              backgroundColor: '#34B27B33',
              color: '#34B27B',
            }}
          >
            {fallbackText.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <Camera className="h-5 w-5 text-white" />
        </div>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUpload(file);
          e.target.value = '';
        }}
      />

      {/* Picker popover */}
      {showPicker && (
        <div className="border-border bg-surface-100 absolute top-full left-0 z-20 mt-2 w-72 rounded-lg border p-4 shadow-xl">
          {/* Upload custom */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="border-border hover:bg-surface-200 mb-3 flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploading ? 'Uploading...' : 'Upload custom'}
          </button>

          {/* Avatar grid */}
          <p className="text-foreground-lighter mb-2 text-[11px] font-medium tracking-wide uppercase">
            Choose avatar
          </p>
          <div className="max-h-64 overflow-y-auto pr-1">
            <div className="grid grid-cols-5 gap-2">
              {ALL_AVATARS.map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => handleSelect(src)}
                  className={`hover:border-brand/60 overflow-hidden rounded-lg border-2 transition-all ${
                    currentAvatar === src ? 'border-brand' : 'border-transparent'
                  }`}
                >
                  <Image
                    src={src}
                    alt=""
                    className="aspect-square w-full object-cover"
                    width={80}
                    height={80}
                    unoptimized
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export for backward compat
export { DEFAULT_AVATARS, getNextAvatar, getRandomUserAvatar } from '@/lib/default-avatars';
