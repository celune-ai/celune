import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Nango client
// ---------------------------------------------------------------------------

vi.mock('../nango-client', () => ({
  getNangoToken: vi.fn().mockResolvedValue('mock-token-123'),
  createNangoConnection: vi.fn().mockReturnValue('https://nango.test/oauth'),
}));

// ---------------------------------------------------------------------------
// Mock ingest — we test the pipeline separately
// ---------------------------------------------------------------------------

vi.mock('../ingest', () => ({
  ingestContent: vi.fn().mockResolvedValue({
    processed: 1,
    added: 1,
    updated: 0,
    unchanged: 0,
    errors: [],
  }),
}));

// Mock optional deps that upload.ts dynamically imports (Vite resolves them statically)
vi.mock('pdf-parse', () => ({ default: vi.fn() }));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }));

// Now import after mocks are set up
import { CONNECTORS, type ConnectorDef } from '../connectors/index';

describe('Connector Registry', () => {
  it('has all expected connectors registered', () => {
    const expected = [
      'notion',
      'github',
      'google-drive',
      'gmail',
      'linear',
      'asana',
      'confluence',
      'dropbox',
      'figma',
      'google-calendar',
      'upload',
      'url-crawl',
    ];

    for (const id of expected) {
      expect(CONNECTORS[id]).toBeDefined();
      expect(CONNECTORS[id]!.name).toBeTruthy();
      expect(CONNECTORS[id]!.description).toBeTruthy();
    }
  });

  it('every connector has required fields', () => {
    for (const [id, def] of Object.entries(CONNECTORS)) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(['oauth', 'upload', 'url']).toContain(def.authType);
      expect(typeof def.syncFunction).toBe('function');
      expect(def.icon).toBeTruthy();
    }
  });

  it('OAuth connectors have Nango integration IDs', () => {
    for (const [id, def] of Object.entries(CONNECTORS)) {
      if (def.authType === 'oauth') {
        expect(def.nangoIntegrationId).toBeTruthy();
      }
    }
  });

  it('non-OAuth connectors have null Nango integration IDs', () => {
    for (const [id, def] of Object.entries(CONNECTORS)) {
      if (def.authType !== 'oauth') {
        expect(def.nangoIntegrationId).toBeNull();
      }
    }
  });

  it('upload connector throws when called via syncFunction', async () => {
    await expect(
      CONNECTORS['upload']!.syncFunction({
        sourceId: 'test',
        workspaceId: 'test',
        connectionId: 'test',
      }),
    ).rejects.toThrow('Use processUpload() directly');
  });
});

describe('Notion connector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches pages and ingests content', async () => {
    const { getNangoToken } = await import('../nango-client');
    const { ingestContent } = await import('../ingest');

    // Mock Notion API responses
    const mockSearchResponse = {
      results: [
        {
          id: 'page-1',
          properties: { title: { title: [{ plain_text: 'Test Page' }] } },
          url: 'https://notion.so/page-1',
        },
      ],
      has_more: false,
    };

    const mockBlocksResponse = {
      results: [{ id: 'block-1', type: 'paragraph', has_children: false }],
      has_more: false,
    };

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(mockSearchResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockBlocksResponse), { status: 200 }));

    const { syncNotion } = await import('../connectors/notion');
    const result = await syncNotion({
      sourceId: 'src-1',
      workspaceId: 'ws-1',
      connectionId: 'conn-1',
    });

    expect(getNangoToken).toHaveBeenCalledWith('conn-1', 'notion');
    expect(ingestContent).toHaveBeenCalledWith({
      sourceId: 'src-1',
      workspaceId: 'ws-1',
      documents: expect.arrayContaining([
        expect.objectContaining({
          externalId: 'page-1',
          title: 'Test Page',
          format: 'notion_blocks',
        }),
      ]),
    });
  });
});

describe('Nango integration ID mapping', () => {
  it('maps gmail to google-mail', () => {
    expect(CONNECTORS['gmail']!.nangoIntegrationId).toBe('google-mail');
  });

  it('maps github to github-getting-started', () => {
    expect(CONNECTORS['github']!.nangoIntegrationId).toBe('github-getting-started');
  });

  it('notion maps to notion', () => {
    expect(CONNECTORS['notion']!.nangoIntegrationId).toBe('notion');
  });
});
