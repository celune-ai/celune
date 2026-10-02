/**
 * Edition migration: the feature diff between editions (read from the gates
 * themselves) and the self-host to Cloud push. The push reads the source
 * workspace, uploads it in merge mode, and never deletes source rows.
 */
import {
  GATE_FEATURE_LABELS,
  NoopGate,
  describeGate,
  type Edition,
  type Gate,
  type GateFeature,
  type GateFeaturePolicy,
} from '@celuneai/core';
import { createCloudGate } from '@/lib/gate';
import { buildWorkspaceZip } from './archive';
import { exportWorkspace, type Db } from './export';
import { WorkspaceTransferError } from './format';
import type { WorkspaceImportResult } from './import';

export type FeatureChange = 'same' | 'adds_limit' | 'removes_limit' | 'changes_limit';

export interface FeatureDiffRow {
  feature: GateFeature;
  label: string;
  current: GateFeaturePolicy;
  target: GateFeaturePolicy;
  change: FeatureChange;
}

export function gateForEdition(edition: Edition): Gate {
  return edition === 'cloud' ? createCloudGate() : new NoopGate();
}

export function featureDiff(
  from: Edition,
  to: Edition,
  gates: (edition: Edition) => Gate = gateForEdition,
): FeatureDiffRow[] {
  const current = new Map(describeGate(gates(from)).map((d) => [d.feature, d.policy]));
  return describeGate(gates(to)).map(({ feature, policy: target }) => {
    const was = current.get(feature) ?? 'open';
    const change: FeatureChange =
      was === target
        ? 'same'
        : target === 'open'
          ? 'removes_limit'
          : was === 'open'
            ? 'adds_limit'
            : 'changes_limit';
    return { feature, label: GATE_FEATURE_LABELS[feature], current: was, target, change };
  });
}

/** Loose shape check only; the Cloud instance does the real key validation. */
export function assertApiKeyShape(apiKey: unknown): asserts apiKey is string {
  if (
    typeof apiKey !== 'string' ||
    apiKey.length < 16 ||
    apiKey.length > 512 ||
    /\s/.test(apiKey)
  ) {
    throw new WorkspaceTransferError('invalid_api_key', 'Paste a Cloud API key with write scope');
  }
}

export interface PushToCloudOptions {
  db: Db;
  workspaceId: string;
  /** Used for this request only. Never stored or logged. */
  apiKey: string;
  cloudUrl: string;
  productName: string;
  docsUrl: string;
  fetchImpl?: typeof fetch;
}

export interface PushToCloudResult {
  exported: Record<string, number>;
  imported: WorkspaceImportResult;
}

export async function pushToCloud(opts: PushToCloudOptions): Promise<PushToCloudResult> {
  assertApiKeyShape(opts.apiKey);
  const exported = await exportWorkspace(opts.db, opts.workspaceId, 'community');
  const zip = await buildWorkspaceZip(opts.db, exported, {
    productName: opts.productName,
    docsUrl: opts.docsUrl,
  });

  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.cloudUrl}/api/workspace/import?mode=merge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/zip' },
      body: zip as unknown as BodyInit,
      // A redirect would resend the pasted key to another host.
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new WorkspaceTransferError(
      'cloud_unreachable',
      `Could not reach ${opts.productName} Cloud. Check the network and try again.`,
      502,
    );
  }

  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new WorkspaceTransferError(
      'cloud_import_failed',
      `${opts.productName} Cloud answered with a redirect. Check the Cloud URL setting.`,
      502,
    );
  }

  const body = (await res.json().catch(() => null)) as
    (WorkspaceImportResult & { error?: string }) | null;
  if (!res.ok || !body) {
    const status = res.status === 401 || res.status === 403 ? res.status : 502;
    const reason = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new WorkspaceTransferError(
      'cloud_import_failed',
      `${opts.productName} Cloud did not accept the import: ${reason}`,
      status,
    );
  }
  return { exported: exported.file.counts ?? {}, imported: body };
}
