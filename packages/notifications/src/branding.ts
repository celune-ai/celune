/**
 * Default branding URL constants for the notifications package, read from host config.
 */
import { resolveHostConfig } from '@celuneai/core/config';

export const DEFAULT_APP_URL = resolveHostConfig().appUrl;
