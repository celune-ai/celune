import { getNangoToken } from '../nango-client';
import { ingestContent, type IngestResult, type IngestDocument } from '../ingest';
import type { ContentFormat } from '../normalize';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

interface SyncParams {
  sourceId: string;
  workspaceId: string;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

async function calFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const delay = 1000 * Math.pow(2, attempt);
      console.log(`[google-calendar] Rate limited, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  throw new Error('[google-calendar] Rate limit retries exhausted');
}

// ---------------------------------------------------------------------------
// Calendar API helpers
// ---------------------------------------------------------------------------

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string; responseStatus: string }>;
  location?: string;
  htmlLink: string;
  organizer?: { email: string; displayName?: string };
}

async function listEvents(token: string): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  // Fetch events from the past 90 days to 30 days ahead
  const timeMin = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      maxResults: '250',
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${CALENDAR_API}/calendars/primary/events?${params.toString()}`;
    const res = await calFetch(url, token);
    if (!res.ok) break;

    const data = (await res.json()) as {
      items: CalendarEvent[];
      nextPageToken?: string;
    };
    events.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return events;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncGoogleCalendar(params: SyncParams): Promise<IngestResult> {
  const { sourceId, workspaceId, connectionId } = params;
  const token = await getNangoToken(connectionId, 'google-calendar');

  console.log('[google-calendar] Fetching events...');
  const events = await listEvents(token);
  console.log(`[google-calendar] Found ${events.length} events`);

  const documents: IngestDocument[] = events
    .filter((e) => e.summary) // skip empty events
    .map((event) => {
      const startTime = event.start.dateTime || event.start.date || '';
      const endTime = event.end.dateTime || event.end.date || '';
      const attendeeList =
        event.attendees
          ?.map((a) => `- ${a.displayName || a.email} (${a.responseStatus})`)
          .join('\n') || '';

      const content = [
        `# ${event.summary}`,
        `When: ${startTime} — ${endTime}`,
        event.location ? `Location: ${event.location}` : '',
        event.organizer ? `Organizer: ${event.organizer.displayName || event.organizer.email}` : '',
        '',
        event.description || '',
        attendeeList ? `\n## Attendees\n${attendeeList}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        externalId: event.id,
        title: event.summary,
        content,
        format: 'markdown' as ContentFormat,
        metadata: {
          start: startTime,
          end: endTime,
          url: event.htmlLink,
        },
      };
    });

  console.log(`[google-calendar] Ingesting ${documents.length} documents...`);
  return ingestContent({ sourceId, workspaceId, documents });
}
