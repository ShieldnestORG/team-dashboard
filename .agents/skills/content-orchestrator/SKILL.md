---
name: content-orchestrator
description: >
  Plan content topics, dispatch to personality agents, and manage the content
  calendar. Used by Sage (CMO) to coordinate Blaze, Cipher, Spark, and Prism
  for consistent, strategic content output.
agents: [sage]
---

# Content Orchestrator Skill

Coordinate content strategy across personality agents — pick topics, assign work, and track output.

## When to Use

- Daily content planning and dispatch
- When Atlas or the board requests content output
- When trending topics surface that need coverage
- When reviewing and adjusting content strategy
- When asked to "plan content", "dispatch content", or "run the content calendar"

## Personality Agents

| Agent | Specialty | Platforms | Best for |
|-------|-----------|-----------|----------|
| Blaze | Hot-Take Analyst | Twitter/X, Reddit | Contrarian takes, trending reactions, engagement |
| Cipher | Technical Deep-Diver | Blog, LinkedIn | Technical articles, tutorials, architecture posts |
| Spark | Community Builder | Discord, Bluesky, Twitter/X | Announcements, community engagement, launches |
| Prism | Trend Reporter | Blog, LinkedIn, Newsletter | Trend reports, roundups, data analysis |

## Workflow

### Step 1 — Review Intel Data

Pull recent intelligence to identify content-worthy topics:

```
GET /api/intel/search?q=blockchain
GET /api/intel/search?q=privacy
GET /api/intel/search?q=AI
GET /api/intel/search?q=web3
```

Look for:

- **Trending topics** — what's generating buzz right now
- **Data-driven stories** — notable statistics or shifts
- **Product-relevant angles** — topics that naturally connect to our properties
- **Gaps in coverage** — topics competitors are covering that we are not

### Step 2 — Check Recent Content

Review what has been published recently to avoid duplication:

- Check recent completed tasks assigned to Blaze, Cipher, Spark, and Prism
- Note topics covered in the last 7 days
- Identify platforms that haven't had fresh content recently

Flag any content gaps (e.g., "no blog posts in 5 days" or "no Twitter threads this week").

### Step 3 — Select Topics

Pick 1-3 topics based on:

| Factor | Weight | Notes |
|--------|--------|-------|
| Trending signals | High | Timely topics get more engagement |
| Relevance to properties | High | Must connect to at least one property |
| Content gaps | Medium | Fill platforms that are underserved |
| Audience interest | Medium | Based on past engagement patterns |
| Uniqueness | Medium | Not already covered recently |

For each selected topic, determine:

- Which personality agent is the best fit
- What content type and platform to target
- Priority level (urgent for trending, normal for evergreen)
- Any specific angle or data points to include

### Step 4 — Dispatch to Personality Agents

Create sub-tasks assigned to the appropriate personality agents. Each sub-task must include:

```
Topic: [the subject]
Content Type: [tweet / thread / blog post / LinkedIn article / Discord announcement / etc.]
Platform: [Twitter/X / Reddit / Blog / LinkedIn / Discord / Bluesky / Newsletter]
Priority: [urgent / normal / low]
Angle: [specific angle or hook to take]
Key Data Points: [any specific stats or sources to reference]
Deadline: [when this should be ready]
```

Assign using the content-writer skill. The personality agent will:

1. Gather intel context
2. Generate content matching their voice
3. Verify platform requirements
4. Report back with the finished content

### Step 5 — Monitor and Follow Up

After dispatch:

- Track task completion status
- Flag overdue or blocked tasks
- Review submitted content for strategy alignment
- Provide feedback if content misses the mark
- Escalate issues to Atlas if content pipeline is blocked

## Daily Routine

1. Wake up and check intel feeds for overnight developments
2. Review what personality agents produced yesterday
3. Pick 1-3 topics for today
4. Dispatch tasks to personality agents
5. Monitor completion throughout the day

## Weekly Routine

1. Review content performance across all platforms
2. Identify what topics and formats performed best
3. Adjust strategy for the coming week
4. Report content metrics to Atlas
5. Plan any special content (launches, milestones, events)

## Topic Selection Rules

- Never assign the same topic to multiple personality agents unless the platforms and angles are clearly different
- Ensure a mix of content types across the week (not all tweets, not all blog posts)
- Balance evergreen content with trending reactions
- Always have at least one piece of content per week that promotes each active property
- Prioritize AEO-optimized content (blog posts, structured articles) for long-term value

## Output

When the skill completes a planning cycle, report:

- Topics selected and rationale
- Tasks dispatched (agent, topic, platform, priority)
- Content gaps identified
- Any strategic adjustments made
- Blocked or overdue items from previous cycles
