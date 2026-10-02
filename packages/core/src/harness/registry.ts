import { ValidationError } from '../errors.ts';
import type { HarnessAdapter } from './types.ts';

export interface HarnessRegistration {
  /** Celune agent id to harness agent id. A claim by an unmapped agent starts no run. */
  agents: Record<string, string>;
  /** Replace an existing registration instead of refusing it. */
  replace?: boolean;
}

export interface HarnessBinding {
  adapter: HarnessAdapter;
  agents: Readonly<Record<string, string>>;
}

export interface ResolvedHarnessAgent {
  adapter: HarnessAdapter;
  harnessAgentId: string;
}

/**
 * Builds an adapter from a stored connection. `config` never holds secrets;
 * the factory reads credentials from the host's environment or key storage.
 */
export type HarnessAdapterFactory = (
  config: Readonly<Record<string, unknown>>,
  context: { workspaceId: string },
) => HarnessAdapter;

export interface HarnessRegistryOptions {
  /** Adapter factories by harness name, for connections stored per workspace. */
  factories?: Record<string, HarnessAdapterFactory>;
}

/**
 * One harness adapter per workspace. Adapters registered in code take
 * precedence over connections stored in the database.
 */
export class HarnessRegistry {
  private readonly bindings = new Map<string, HarnessBinding>();
  private readonly factories: Map<string, HarnessAdapterFactory>;

  constructor(options: HarnessRegistryOptions = {}) {
    this.factories = new Map(Object.entries(options.factories ?? {}));
  }

  /** Makes a harness available to stored connections. */
  registerFactory(harness: string, factory: HarnessAdapterFactory): void {
    if (!harness) throw new ValidationError('A harness factory needs a harness name');
    this.factories.set(harness, factory);
  }

  factory(harness: string): HarnessAdapterFactory | null {
    return this.factories.get(harness) ?? null;
  }

  register(workspaceId: string, adapter: HarnessAdapter, registration: HarnessRegistration): void {
    if (!workspaceId) throw new ValidationError('A harness registration needs a workspace id');
    const existing = this.bindings.get(workspaceId);
    if (existing && !registration.replace) {
      throw new ValidationError('Workspace already has a harness adapter', {
        workspaceId,
        harness: existing.adapter.capabilities().name,
      });
    }
    this.bindings.set(workspaceId, {
      adapter,
      agents: Object.freeze({ ...registration.agents }),
    });
  }

  unregister(workspaceId: string): boolean {
    return this.bindings.delete(workspaceId);
  }

  get(workspaceId: string): HarnessBinding | null {
    return this.bindings.get(workspaceId) ?? null;
  }

  resolveAgent(workspaceId: string, agentId: string): ResolvedHarnessAgent | null {
    const binding = this.bindings.get(workspaceId);
    const harnessAgentId =
      binding && Object.hasOwn(binding.agents, agentId) ? binding.agents[agentId] : undefined;
    if (!binding || !harnessAgentId) return null;
    return { adapter: binding.adapter, harnessAgentId };
  }
}
