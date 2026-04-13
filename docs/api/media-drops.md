# Media Drops API

Upload images, GIFs, and videos from Canva (or anywhere) so agents can post them to Twitter/X via the API.

## How It Works

1. **You** export a design from Canva and upload it here with a caption and hashtags
2. **The agent** sees available drops via the `get-media-drops` tool
3. **The agent** queues a tweet using `queue-post` with the caption and file URLs
4. **The post-dispatcher** publishes the queued post to X via the API

## Endpoints

All endpoints (except file serving) require the `Content-API-Key` header.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/media/drop` | POST | Content-API-Key | Upload 1-4 files with caption and hashtags |
| `/api/media/drops` | GET | Content-API-Key | List drops (filter by status, platform) |
| `/api/media/drops/:id` | GET | Content-API-Key | Get a single drop |
| `/api/media/drops/:id` | PATCH | Content-API-Key | Update caption, hashtags, status |
| `/api/media/drops/:id` | DELETE | Content-API-Key | Remove a drop and its files |
| `/api/media/drops/:id/file/:index` | GET | None | Serve the file (public) |

## Upload

```bash
curl -X POST https://your-server/api/media/drop \
  -H "Content-API-Key: YOUR_KEY" \
  -F "files=@design1.png" \
  -F "files=@design2.png" \
  -F "caption=TX ecosystem is growing fast" \
  -F "hashtags=TX,Cosmos,Blockchain" \
  -F "platform=twitter"
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | File(s) | Yes | 1-4 images or videos (max 50MB each) |
| `caption` | string | No | Tweet text / context for the agent |
| `hashtags` | string | No | Comma-separated or JSON array |
| `platform` | string | No | Target platform (default: `twitter`) |

**Response:**

```json
{
  "id": "uuid",
  "caption": "TX ecosystem is growing fast",
  "hashtags": ["TX", "Cosmos", "Blockchain"],
  "platform": "twitter",
  "status": "available",
  "files": [
    { "index": 0, "filename": "design1.png", "contentType": "image/png", "byteSize": 245000, "url": "/api/media/drops/uuid/file/0" },
    { "index": 1, "filename": "design2.png", "contentType": "image/png", "byteSize": 180000, "url": "/api/media/drops/uuid/file/1" }
  ],
  "createdAt": "2026-04-06T..."
}

```

## List Drops

```bash
curl "https://your-server/api/media/drops?status=available&platform=twitter&limit=10" \
  -H "Content-API-Key: YOUR_KEY"
```

## Update a Drop

```bash
curl -X PATCH https://your-server/api/media/drops/UUID \
  -H "Content-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "queued", "postedTweetId": "123456"}'
```

## Status Lifecycle

```
available  -->  queued  -->  posted
    |
    v
  (deleted)
```

- `available` — ready for an agent to pick up
- `queued` — agent has queued a tweet with this media
- `posted` — tweet has been posted successfully

## Agent Tool

The Twitter plugin exposes `get-media-drops` which agents use to discover available drops:

```
Tool: get-media-drops
Params: { status: "available", platform: "twitter", limit: 10 }
Returns: drops with captions, hashtags, and absolute file URLs (mediaUrls)
```

Agents then call `queue-post` with the drop's caption, hashtags, and `mediaUrls` to schedule the post.

## Database

Table: `media_drops`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| company_id | TEXT | Company scope |
| caption | TEXT | Tweet text / context |
| hashtags | TEXT[] | Suggested hashtags |
| platform | TEXT | Target platform (default: twitter) |
| status | TEXT | available / queued / posted |
| files | JSONB | Array of stored file references |
| posted_tweet_id | TEXT | Tweet ID after posting |
| created_at | TIMESTAMPTZ | Upload time |
| updated_at | TIMESTAMPTZ | Last update |
