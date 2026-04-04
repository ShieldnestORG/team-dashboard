---
name: content-writer
description: >
  Generate content using the content generation API and publish to platforms.
  Used by personality agents (Blaze, Cipher, Spark, Prism) to produce
  platform-specific content from assigned topics.
agents: [blaze, cipher, spark, prism]
---

# Content Writer Skill

Produce platform-ready content for an assigned topic using intel data and the content generation API.

## When to Use

- When assigned a content task by Sage (CMO) or the content-orchestrator skill
- When a topic, content type, and target platform are specified in the task
- When asked to write content for any supported platform

## Workflow

### Step 1 — Read the Assignment

Parse the assigned task for:

- **Topic** — the subject to write about
- **Content type** — tweet, thread, blog post, LinkedIn article, Discord announcement, newsletter, etc.
- **Platform** — Twitter/X, Reddit, Blog, LinkedIn, Discord, Bluesky, Newsletter
- **Priority** — how urgently this needs to be produced
- **Additional context** — any specific angle, data points, or links to include

If any of these are missing, comment on the task asking for clarification before proceeding.

### Step 2 — Gather Context

Pull recent intelligence on the topic:

```
GET /api/intel/search?q={topic}
```

Review the results for:

- Recent news and developments
- Relevant data points and statistics
- Source URLs for citations
- Related trends that add depth

Also check:

- Your own agent personality and voice guidelines (in your AGENTS.md)
- Platform-specific requirements (character limits, formatting conventions)
- Recent content from other personality agents to avoid duplication

### Step 3 — Generate Content

Call the content generation API with your personality context:

```
POST /api/content/generate
Content-Type: application/json

{
  "personality": "<your-agent-id>",
  "topic": "<topic>",
  "contentType": "<content-type>",
  "platform": "<platform>",
  "context": {
    "intelResults": <intel-data-from-step-2>,
    "additionalNotes": "<any-extra-context>"
  }
}
```

### Step 4 — Verify Output

Before reporting, verify the generated content meets requirements:

| Check | Criteria |
|-------|----------|
| Platform fit | Meets character limits, formatting conventions |
| Voice match | Matches your personality's voice and tone |
| Factual accuracy | All claims are backed by cited sources |
| Cross-property mentions | Natural, not forced — only if relevant |
| Safety rules | No false claims, no financial advice, no spam |
| Links | All referenced URLs are valid and relevant |
| Uniqueness | Not duplicating recent content from other agents |

If the content fails any check, revise it before proceeding.

### Step 5 — Report Results

Comment on the assigned task with:

1. **The generated content** — full text, ready to publish
2. **Target platform** — where this should be published
3. **Sources cited** — list of data sources and URLs used
4. **Recommended publish time** — based on platform best practices (if applicable)
5. **Cross-property mentions** — note any ecosystem references included

Mark the task as complete once the content is reported.

## Platform Requirements

| Platform | Format | Limits |
|----------|--------|--------|
| Twitter/X (tweet) | Plain text, optional media | 280 characters |
| Twitter/X (thread) | Numbered tweets, 1/ 2/ 3/ format | 280 chars per tweet, 3-10 tweets |
| Reddit | Markdown, descriptive title | No hard limit, aim for 500-2000 words |
| Blog | Markdown with headers, code blocks | 1000-3000 words |
| LinkedIn | Professional markdown | 500-1500 words |
| Discord | Markdown, mentions, embeds | 2000 characters per message |
| Bluesky | Plain text | 300 characters |
| Newsletter | HTML-friendly markdown, sections | 500-1500 words |

## Output

When the skill completes, the task comment should contain:

- The complete content ready for publishing
- Platform and content type confirmation
- All sources and citations
- Any notes on timing or scheduling
