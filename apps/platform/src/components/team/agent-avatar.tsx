import Image from 'next/image';
import { Bot } from 'lucide-react';
import { AGENT_AVATAR_MAP } from '@/lib/default-avatars';

interface AgentAvatarProps {
  agentId: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-[34px] w-[34px]',
} as const;

const ICON_CLASSES = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
} as const;

export function AgentAvatar({ agentId, name, size = 'sm' }: AgentAvatarProps) {
  const avatarUrl = AGENT_AVATAR_MAP[agentId];

  return (
    <div
      className={`bg-surface-100 border-border flex shrink-0 items-center justify-center overflow-hidden rounded-full border ${SIZE_CLASSES[size]}`}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name}
          className="h-full w-full object-cover"
          width={34}
          height={34}
          unoptimized
        />
      ) : (
        <Bot className={`text-foreground-lighter ${ICON_CLASSES[size]}`} />
      )}
    </div>
  );
}
