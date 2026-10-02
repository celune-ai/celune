# /afk-tweeting — Autonomous Twitter/X Posting for @celuneapp

Post tweets from a content queue, engage with relevant threads, and build organic presence ahead of launch.

## Arguments

`/afk-tweeting` — run default posting cycle
`/afk-tweeting dry-run` — preview what would be posted without actually posting
`/afk-tweeting post "text"` — post a single tweet immediately
`/afk-tweeting thread "t1" "t2" "t3"` — post a thread immediately

---

## On Invocation

### 1. Check if already running

```bash
if [ -f ~/.claude/state/afk_active ]; then
    echo "AFK session already running"
    exit 0
fi
```

### 2. Validate X API access

```bash
node ~/.claude/scripts/x-client.mjs me
```

If this fails, stop and report the error. Common issues:

- 403: Check Read+Write permissions on X Developer portal
- 401: Regenerate tokens
- Rate limit: Wait per Retry-After header

### 3. Load content queue

```bash
cat ~/.claude/state/tweet-queue.json
```

The queue is a JSON array of tweet objects. See "Content Queue Format" below.

### 4. Create sentinel + timeout

```bash
touch ~/.claude/state/afk_active
echo $$ > ~/.claude/state/afk.pid
date +%s > ~/.claude/state/afk_start_time
echo "14400" > ~/.claude/state/afk_timeout_secs  # 4 hours default
```

## The Posting Cycle

Run phases in order. Repeat until stopped or queue empty.

### Phase 1: Post from Queue

1. Read `~/.claude/state/tweet-queue.json`
2. Find the next unposted tweet (status: "queued") with highest priority
3. Post it via `node ~/.claude/scripts/x-client.mjs tweet "text"`
4. Update the queue entry: set `status: "posted"`, `posted_at: ISO timestamp`, `tweet_url: URL`
5. Write updated queue back to file
6. Log to `~/.claude/state/tweet-log.json`

### Phase 2: Engagement (every 3rd cycle)

1. Search X for relevant conversations using engagement targets
2. Find 1-2 threads worth replying to (AI agents, Claude, dev tools)
3. Compose thoughtful replies (not promotional — add value)
4. Post replies via `node ~/.claude/scripts/x-client.mjs reply <id> "text"`
5. Log engagement actions

### Phase 3: Cooldown

Wait 15-30 minutes between posts (randomized to appear organic).

```bash
WAIT=$((900 + RANDOM % 900))  # 15-30 min
sleep $WAIT
```

### Phase 4: Safety Checks

Before each post:

- Check daily post count (max 10/day)
- Check rate limit status
- Check timeout: `$((NOW - START)) > TIMEOUT`
- Check sentinel: `[ -f ~/.claude/state/afk_active ]`
- Check $5 budget (estimate ~$0.01 per API call, stop at 400 calls)

## Content Queue Format

File: `~/.claude/state/tweet-queue.json`

```json
[
  {
    "id": 1,
    "text": "Tweet text here (max 280 chars)",
    "category": "build-in-public|insight|engagement|announcement|thread",
    "priority": 1,
    "status": "queued|posted|skipped",
    "posted_at": null,
    "tweet_url": null,
    "notes": "Optional context"
  }
]
```

Categories:

- **build-in-public**: What we're building, progress updates, behind-the-scenes
- **insight**: AI agent opinions, dev tool takes, technical observations
- **engagement**: Replies to trending conversations, community participation
- **announcement**: Launch-related, feature reveals, milestones
- **thread**: Multi-tweet deep dives (use `tweets` array field instead of `text`)

## Engagement Targets

File: `~/.claude/state/engagement-targets.json`

Search terms and accounts to monitor for reply opportunities.

## Rate Limits

- **X Free tier ($5 credit):** 50 tweets/day, 100 requests/15 min
- **Self-imposed:** Max 10 tweets/day, 15-min minimum gap, max 5 replies/day
- **Budget guard:** Stop posting if estimated spend exceeds $4 (keep $1 reserve)

## On Return

1. Remove sentinel: `rm -f ~/.claude/state/afk_active`
2. Read tweet log, summarize: posts made, engagement, any errors
3. Report remaining queue size

## Integration

- Shares `afk_active` sentinel — only one AFK skill runs at a time
- Can be chained from `/closing-time` for overnight posting
- Content queue can be refreshed by running `/afk-tweeting refill`
