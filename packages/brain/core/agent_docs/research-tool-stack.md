# Research Tool Stack — Decision Matrix

Quick reference for agents choosing research tools. All tools are configured as MCP servers or existing integrations.

## Four-Layer Stack

| Layer          | Tool                | Purpose                                     | Cost                | Speed  |
| -------------- | ------------------- | ------------------------------------------- | ------------------- | ------ |
| **Retrieval**  | brain.sqlite (FTS5) | Find relevant vault notes by keyword        | Free                | <100ms |
| **Discovery**  | Tavily Search       | Fast web search, snippets, source discovery | ~$0.01/search       | ~200ms |
| **Extraction** | Firecrawl           | Full page content with JS rendering         | ~$0.01/scrape       | ~2-5s  |
| **YouTube**    | TranscriptAPI       | Video transcript fetching                   | 1 credit/transcript | ~1-2s  |

## When to Use Each Tool

### Tavily (Discovery)

- **Always use for:** Finding web sources, competitive research, news, YouTube video discovery
- **How:** `ToolSearch: "tavily"` -> `tavily_search(query, search_depth="basic"|"advanced")`
- **YouTube trick:** `tavily_search(query="<topic> site:youtube.com", max_results=5)`
- **Extract specific URLs:** `tavily_extract(urls=["https://..."])`
- **Skip when:** You already have the URL and need full content (use Firecrawl)

### Firecrawl (Extraction)

- **Use for:** Deep page extraction, JS-rendered content, anti-bot sites, full article text
- **How:** `ToolSearch: "firecrawl"` -> `firecrawl_scrape(url, formats=["markdown"])`
- **Site mapping:** `firecrawl_map(url)` to discover all pages on a domain
- **Search + scrape:** `firecrawl_search(query, limit=5)` combines both
- **Skip when:** Quick depth research — Tavily snippets are sufficient

### TranscriptAPI (YouTube)

- **Use for:** Fetching video transcripts for analysis
- **How:** Bash curl call (see /research SKILL.md)
- **Skip when:** No video content needed

### brain.sqlite (Vault)

- **Use for:** Checking what you already know before searching externally
- **How:** SQLite FTS5 query against vault notes
- **Skip when:** Topic is clearly new/external with no prior vault coverage

## Pipeline Patterns

### Quick Research (~$0.05)

```
Tavily search (basic, 5 results) -> Synthesize from snippets
```

### Standard Research (~$0.15)

```
Tavily search (advanced, 15 results) -> TranscriptAPI (1-2 videos) -> Synthesize
```

### Deep Research (~$0.50)

```
brain.sqlite -> Tavily search (advanced, 25 results) -> Firecrawl (top 5 pages) -> TranscriptAPI (3-5 videos) -> Synthesize
```

### Exhaustive Research (~$2.00)

```
brain.sqlite -> Tavily (50+ searches, multiple passes) -> Firecrawl (10-20 pages) -> TranscriptAPI (5-10 videos) -> Cross-reference -> Synthesize
```

## Cost Comparison

| Approach                          | Cost for 20-source research          |
| --------------------------------- | ------------------------------------ |
| Pure LLM (WebSearch + WebFetch)   | ~$0.50-1.00 in tokens                |
| Tavily only (snippets)            | ~$0.20 + less token usage            |
| Tavily + Firecrawl (full content) | ~$0.40 + minimal token usage         |
| Full pipeline (all layers)        | ~$0.50 + structured, reusable output |

The MCP pipeline is comparable in cost but produces higher-quality, structured output with proper source attribution.
