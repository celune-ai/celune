import type { IngestResult } from '../ingest';
import { syncNotion } from './notion';
import { syncGitHub } from './github';
import { syncGoogleDrive } from './google-drive';
import { syncGmail } from './gmail';
import { syncLinear } from './linear';
import { syncAsana } from './asana';
import { syncConfluence } from './confluence';
import { syncDropbox } from './dropbox';
import { syncFigma } from './figma';
import { syncGoogleCalendar } from './google-calendar';
import { processUpload } from './upload';
import { crawlUrl } from './url-crawl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthType = 'oauth' | 'upload' | 'url';

export interface ConnectorSyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
  /** Extra params — e.g. teamId for Figma, siteUrl for Confluence */
  options?: Record<string, string>;
}

export type SyncFunction = (params: ConnectorSyncParams) => Promise<IngestResult>;

export interface ConnectorDef {
  name: string;
  description: string;
  authType: AuthType;
  nangoIntegrationId: string | null;
  syncFunction: SyncFunction;
  icon: string;
}

// ---------------------------------------------------------------------------
// Adapter wrappers — normalize connector-specific params
// ---------------------------------------------------------------------------

const wrapNotion: SyncFunction = (p) =>
  syncNotion({ sourceId: p.sourceId, workspaceId: p.workspaceId, connectionId: p.connectionId });

const wrapGitHub: SyncFunction = (p) =>
  syncGitHub({ sourceId: p.sourceId, workspaceId: p.workspaceId, connectionId: p.connectionId });

const wrapGoogleDrive: SyncFunction = (p) =>
  syncGoogleDrive({
    sourceId: p.sourceId,
    workspaceId: p.workspaceId,
    connectionId: p.connectionId,
  });

const wrapGmail: SyncFunction = (p) =>
  syncGmail({ sourceId: p.sourceId, workspaceId: p.workspaceId, connectionId: p.connectionId });

const wrapLinear: SyncFunction = (p) =>
  syncLinear({ sourceId: p.sourceId, workspaceId: p.workspaceId, connectionId: p.connectionId });

const wrapAsana: SyncFunction = (p) =>
  syncAsana({ sourceId: p.sourceId, workspaceId: p.workspaceId, connectionId: p.connectionId });

const wrapConfluence: SyncFunction = (p) =>
  syncConfluence({
    sourceId: p.sourceId,
    workspaceId: p.workspaceId,
    connectionId: p.connectionId,
    siteUrl: p.options?.siteUrl,
  });

const wrapDropbox: SyncFunction = (p) =>
  syncDropbox({ sourceId: p.sourceId, workspaceId: p.workspaceId, connectionId: p.connectionId });

const wrapFigma: SyncFunction = (p) =>
  syncFigma({
    sourceId: p.sourceId,
    workspaceId: p.workspaceId,
    connectionId: p.connectionId,
    teamId: p.options?.teamId || '',
  });

const wrapGoogleCalendar: SyncFunction = (p) =>
  syncGoogleCalendar({
    sourceId: p.sourceId,
    workspaceId: p.workspaceId,
    connectionId: p.connectionId,
  });

const wrapUpload: SyncFunction = async () => {
  // Upload uses processUpload() directly — not triggered via CONNECTORS map
  throw new Error('Use processUpload() directly for file uploads');
};

const wrapUrlCrawl: SyncFunction = (p) =>
  crawlUrl({
    sourceId: p.sourceId,
    workspaceId: p.workspaceId,
    baseUrl: p.options?.baseUrl || '',
  });

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CONNECTORS: Record<string, ConnectorDef> = {
  notion: {
    name: 'Notion',
    description: 'Import pages and databases from Notion',
    authType: 'oauth',
    nangoIntegrationId: 'notion',
    syncFunction: wrapNotion,
    icon: 'notion',
  },
  github: {
    name: 'GitHub',
    description: 'Import READMEs, docs, and issues from GitHub repos',
    authType: 'oauth',
    nangoIntegrationId: 'github-getting-started',
    syncFunction: wrapGitHub,
    icon: 'github',
  },
  'google-drive': {
    name: 'Google Drive',
    description: 'Import documents and files from Google Drive',
    authType: 'oauth',
    nangoIntegrationId: 'google-drive',
    syncFunction: wrapGoogleDrive,
    icon: 'google-drive',
  },
  gmail: {
    name: 'Gmail',
    description: 'Import recent emails from Gmail (last 90 days)',
    authType: 'oauth',
    nangoIntegrationId: 'google-mail',
    syncFunction: wrapGmail,
    icon: 'mail',
  },
  linear: {
    name: 'Linear',
    description: 'Import issues, projects, and comments from Linear',
    authType: 'oauth',
    nangoIntegrationId: 'linear',
    syncFunction: wrapLinear,
    icon: 'linear',
  },
  asana: {
    name: 'Asana',
    description: 'Import projects and tasks from Asana',
    authType: 'oauth',
    nangoIntegrationId: 'asana',
    syncFunction: wrapAsana,
    icon: 'asana',
  },
  confluence: {
    name: 'Confluence',
    description: 'Import pages and spaces from Confluence',
    authType: 'oauth',
    nangoIntegrationId: 'confluence',
    syncFunction: wrapConfluence,
    icon: 'confluence',
  },
  dropbox: {
    name: 'Dropbox',
    description: 'Import text files from Dropbox',
    authType: 'oauth',
    nangoIntegrationId: 'dropbox',
    syncFunction: wrapDropbox,
    icon: 'dropbox',
  },
  figma: {
    name: 'Figma',
    description: 'Import file structure and comments from Figma',
    authType: 'oauth',
    nangoIntegrationId: 'figma',
    syncFunction: wrapFigma,
    icon: 'figma',
  },
  'google-calendar': {
    name: 'Google Calendar',
    description: 'Import calendar events as knowledge items',
    authType: 'oauth',
    nangoIntegrationId: 'google-calendar',
    syncFunction: wrapGoogleCalendar,
    icon: 'calendar',
  },
  upload: {
    name: 'File Upload',
    description: 'Upload PDF, DOCX, MD, or TXT files directly',
    authType: 'upload',
    nangoIntegrationId: null,
    syncFunction: wrapUpload,
    icon: 'upload',
  },
  'url-crawl': {
    name: 'URL Crawler',
    description: 'Crawl a website and import its content',
    authType: 'url',
    nangoIntegrationId: null,
    syncFunction: wrapUrlCrawl,
    icon: 'globe',
  },
};

// Re-export for direct use
export { processUpload } from './upload';
export { crawlUrl } from './url-crawl';
