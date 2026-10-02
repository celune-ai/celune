# Research MCP Tools & Recipes

## Layer 1: Vault Retrieval (Voyage AI + brain.sqlite)

Internal knowledge — what we already know.

```
sqlite3 $VAULT_ROOT/memory/brain.sqlite \
  "SELECT path, snippet FROM fts_notes WHERE fts_notes MATCH '<query>' LIMIT 10"
```

## Layer 2: Web Discovery (Tavily)

Fast web search — find sources, get snippets.

```
ToolSearch: "tavily"
-> tavily_search(query, search_depth="basic"|"advanced", max_results=5, include_domains=[], exclude_domains=[])
-> tavily_extract(urls=["..."])  # extract content from specific URLs
```

**Cost:** ~$0.01/search. Use `search_depth="basic"` for quick depth, `"advanced"` for deep/exhaustive.

**YouTube discovery:** Use `tavily_search(query="<topic> site:youtube.com", max_results=5)` to find relevant videos. Parse video URLs from results, then fetch transcripts via TranscriptAPI.

## Layer 3: Deep Extraction (Firecrawl)

Full page extraction with JS rendering — when Tavily snippets aren't enough.

```
ToolSearch: "firecrawl"
-> firecrawl_scrape(url, formats=["markdown"])  # single page, full content
-> firecrawl_map(url)  # discover all pages on a site
-> firecrawl_search(query, limit=5)  # search + scrape in one call
```

**Cost:** ~$0.01/scrape. Use only for `deep` or `exhaustive` depth.

## Layer 4: YouTube Transcripts (TranscriptAPI)

```bash
KEY=$(grep TRANSCRIPT_API_KEY $VAULT_ROOT/.env | cut -d"'" -f2)
# Fetch transcript
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/transcript?video_url=VIDEO_URL&format=text&send_metadata=true"
# Search YouTube (alternative to Tavily site:youtube.com)
curl -s -H "Authorization: Bearer $KEY" \
  "https://transcriptapi.com/api/v2/youtube/search?query=QUERY&max_results=5"
```

## Usage Recipes

| Recipe                | Tools                                                       | When                                         |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| **Quick scan**        | Tavily search (basic)                                       | `quick` depth — 5-10 searches, snippets only |
| **Standard research** | Tavily search (advanced) + TranscriptAPI                    | `standard` depth — web + 1-2 videos          |
| **Deep dive**         | Tavily -> Firecrawl extract top results + TranscriptAPI     | `deep` depth — full page content             |
| **Exhaustive**        | Vault + Tavily + Firecrawl + TranscriptAPI, multiple passes | `exhaustive` depth — everything              |
| **Content analysis**  | Firecrawl scrape a specific URL                             | Analyzing a specific page in detail          |
| **Competitive audit** | Tavily search competitors -> Firecrawl scrape each          | Feature/pricing comparison                   |

## Cost Tracking

Note total research cost in the output:

```
**Research Cost:** ~$X.XX (N Tavily searches x $0.01 + N Firecrawl scrapes x $0.01)
```
