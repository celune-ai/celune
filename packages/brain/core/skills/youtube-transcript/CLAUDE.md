---
name: youtube-transcript
description: 'Fetch YouTube transcripts, search videos, scan channels via TranscriptAPI. Takes URL or search query.'
user_invocable: true
requires:
  env: [TRANSCRIPT_API_KEY]
---

# youtube-transcript

Fetch and process YouTube content via the TranscriptAPI REST API. Covers transcripts, search, channel monitoring, video metadata, and comments.

## Usage

When invoked, determine the intent from the user's message:

1. A YouTube URL or video ID (fetch transcript)
2. A search query (find videos)
3. A channel handle (monitor or scan)
4. A request for video details or comments

## API Details

- **Base URL:** `https://transcriptapi.com/api/v2`
- **Auth:** `Authorization: Bearer $TRANSCRIPT_API_KEY`
- **Key location:** loaded via `heartbeat_config.py` (variable: `TRANSCRIPT_API_KEY` in `.env`)

### Key extraction

```bash
KEY=$(grep TRANSCRIPT_API_KEY $VAULT_ROOT/.env | cut -d"'" -f2)
```

**Note:** Always extract the key via `grep | cut` as shown. Do NOT use `source .env` because the sandbox may clear the variable when passed to curl headers.

---

## Endpoints (7 total)

### 1. Transcript — `/youtube/transcript`

Fetch the full transcript of a video. **Cost: 1 credit.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/transcript?video_url=VIDEO_URL_OR_ID&format=text&send_metadata=true"
```

| Param               | Required | Default | Notes                                      |
| ------------------- | -------- | ------- | ------------------------------------------ |
| `video_url`         | yes      | —       | Full URL, short URL, or 11-char video ID   |
| `format`            | no       | `json`  | `json` (with timestamps) or `text` (plain) |
| `include_timestamp` | no       | `true`  | Timing data per segment                    |
| `send_metadata`     | no       | `false` | Title, author, thumbnail                   |

**Format selection:**

- `format=text` for readable content (analysis, summaries, knowledge extraction)
- `format=json` for timestamps (creating clips, referencing specific moments)

### 2. Search — `/youtube/search`

Search YouTube for videos by keyword. **Cost: 1 credit.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/search?q=QUERY&limit=10"
```

| Param   | Required | Default | Notes              |
| ------- | -------- | ------- | ------------------ |
| `q`     | yes      | —       | Search query       |
| `limit` | no       | `10`    | Max results (1-50) |

### 3. Channel Latest — `/youtube/channel/latest`

Get the most recent videos from a channel. **FREE, no credit cost.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/channel/latest?channel=@HANDLE"
```

| Param     | Required | Default | Notes                 |
| --------- | -------- | ------- | --------------------- |
| `channel` | yes      | —       | @handle or channel ID |

### 4. Channel Resolve — `/youtube/channel/resolve`

Resolve a @handle to a channel ID. **FREE, no credit cost.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/channel/resolve?input=@HANDLE"
```

| Param   | Required | Default | Notes                                     |
| ------- | -------- | ------- | ----------------------------------------- |
| `input` | yes      | —       | @handle (e.g. @DanMartell) or channel URL |

### 5. Channel Search — `/youtube/channel/search`

Search for YouTube channels by keyword. **Cost: 1 credit.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/channel/search?q=QUERY&channel=QUERY&limit=5"
```

| Param     | Required | Default | Notes                               |
| --------- | -------- | ------- | ----------------------------------- |
| `q`       | yes      | —       | Search query                        |
| `channel` | yes      | —       | Channel name or keyword (same as q) |
| `limit`   | no       | `5`     | Max results                         |

**Note:** This endpoint can be unreliable. For known channels, prefer `/channel/resolve` with a @handle or use `/channel/latest` with a channel ID directly.

### 6. Video Details — `/youtube/video/details`

Get video metadata without pulling the transcript. **Cost: 1 credit.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/video/details?video_url=VIDEO_URL_OR_ID"
```

| Param       | Required | Default | Notes                            |
| ----------- | -------- | ------- | -------------------------------- |
| `video_url` | yes      | —       | Full URL, short URL, or video ID |

### 7. Video Comments — `/youtube/video/comments`

Get top comments on a video. **Cost: 1 credit.**

```bash
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/video/comments?video_url=VIDEO_URL_OR_ID&limit=20"
```

| Param       | Required | Default | Notes                            |
| ----------- | -------- | ------- | -------------------------------- |
| `video_url` | yes      | —       | Full URL, short URL, or video ID |
| `limit`     | no       | `20`    | Max comments                     |

---

## Workflow Recipes

### 1. Quick Analysis

Grab a transcript, summarize it, save to vault.

1. Fetch transcript with `format=text&send_metadata=true`
2. Summarize key points (3-5 bullet points + actionable takeaways)
3. Save to `05-knowledge/` with source attribution and link

### 2. Research Mode

Search a topic, pick the best videos, batch-pull transcripts, extract cross-cutting insights.

1. Search with `/youtube/search?q=TOPIC&limit=10`
2. Review titles, pick 3-5 most relevant
3. Fetch transcripts for each (`format=text`)
4. Synthesize a research note: common themes, disagreements, best quotes
5. Save to `05-knowledge/` as a research compilation

### 3. Follow Someone

Discover a creator, resolve their handle, add to monitoring.

1. Resolve handle: `/youtube/channel/resolve?handle=@HANDLE`
2. Verify with `/youtube/channel/latest?channel=@HANDLE`
3. Add to `feed-sources.yaml` under `youtube.channels`:
   ```yaml
   - handle: '@Handle'
     name: 'Display Name'
   ```
4. Their new videos will appear in feed scanner digests automatically

### 4. Deep Dive on Video

Get everything about a single video for a comprehensive vault note.

1. Fetch details: `/youtube/video/details?video_url=URL`
2. Fetch transcript: `/youtube/transcript?video_url=URL&format=text&send_metadata=true`
3. Fetch comments: `/youtube/video/comments?video_url=URL&limit=30`
4. Combine into a structured note: metadata, key points from transcript, notable audience reactions from comments
5. Save to `05-knowledge/`

### 5. Channel Scan

Review a creator's recent output for trends and knowledge extraction.

1. Get latest: `/youtube/channel/latest?channel=@HANDLE`
2. Pick 3-5 most interesting recent videos by title
3. Fetch transcripts for each
4. Summarize: what topics is this creator focused on? What's new?
5. Save as a creator profile note in `06-influences/` or `05-knowledge/`

---

## Cost Summary

| Endpoint                   | Credit Cost |
| -------------------------- | ----------- |
| `/youtube/transcript`      | 1 credit    |
| `/youtube/search`          | 1 credit    |
| `/youtube/channel/latest`  | FREE        |
| `/youtube/channel/resolve` | FREE        |
| `/youtube/channel/search`  | 1 credit    |
| `/youtube/video/details`   | 1 credit    |
| `/youtube/video/comments`  | 1 credit    |

Credits only charged on successful (200) responses.

## Error Handling

| Status | Meaning                   | Action                      |
| ------ | ------------------------- | --------------------------- |
| 401    | Bad API key               | Check .env                  |
| 402    | No credits                | Top up at transcriptapi.com |
| 404    | No transcript/video found | Video may not have captions |
| 429    | Rate limited              | Wait per Retry-After header |

## After Fetching

Once you have content:

1. **Summarize** key points if the user wants a quick overview
2. **Extract actionable insights** if this is for a task or project
3. **Save to vault** (use `05-knowledge/` for reference material, `00-inbox/` for unprocessed)
4. **Report credit usage** so the user knows the cost
