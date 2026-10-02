'use client';

import Link from 'next/link';
import { Alert, AlertDescription } from '@repo/ui/components/alert';

/**
 * Shown when the host refuses a board token for the workspace: 402 means the org has
 * no plan (the paywall), 403 means this user has no access to the board.
 */
export function EmbedLockedNotice({ status }: { status: 402 | 403 }) {
  return (
    <div className="px-4 pt-4">
      <Alert variant="warning">
        <AlertDescription>
          {status === 402 ? (
            <>
              This workspace is locked until the organization subscribes to Celune Cloud.{' '}
              <Link href="/subscribe" className="underline underline-offset-2">
                View plans
              </Link>
            </>
          ) : (
            'You do not have access to this workspace’s board. Ask an admin for access.'
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
