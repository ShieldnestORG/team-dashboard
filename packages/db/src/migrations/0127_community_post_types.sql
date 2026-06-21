-- 0127_community_post_types.sql
-- Coherent Ones University — COMMUNITY feed legibility (Spec A). Makes the
-- previously-undifferentiated post stream typed, topic-filterable, and
-- answerable. Three additive columns on university_community_posts, plus two
-- filter indexes. Every existing row backfills to a plain statement with no
-- topic and no accepted answer, so today's behavior is preserved when no
-- filter is applied.
--
--   - post_type           — statement (default catch-all) | question | idea.
--                           The assert-vs-ask-vs-propose frame; CHECK-gated.
--   - topic               — optional, single, curated slug from a fixed set
--                           (wins | tools_workflows | body_mind |
--                           building_revenue | meta); nullable; CHECK-gated.
--                           A CHECK-constrained slug column instead of a
--                           topics table — the set is fixed + owner-curated.
--   - accepted_comment_id — the single source of truth for "this question is
--                           answered": the post points at the chosen comment
--                           (no per-comment is_accepted flag). Nullable FK to
--                           university_community_comments(id). Only question
--                           posts are ever accepted (enforced in the service).
--
-- Two indexes back the new feed filters (type, topic), each riding the same
-- (status, created_at DESC) shape as the existing feed index so filtered
-- queries stay newest-first and cursor-paginate the same way.
--
-- Mirrors the 0126 table/index style. Additive only: 3 columns + 2 indexes.
-- Safe to apply against prod; existing rows read back post_type='statement',
-- topic=NULL, accepted_comment_id=NULL.

ALTER TABLE university_community_posts
  ADD COLUMN IF NOT EXISTS post_type TEXT NOT NULL DEFAULT 'statement'
    CHECK (post_type IN ('statement','question','idea'));

ALTER TABLE university_community_posts
  ADD COLUMN IF NOT EXISTS topic TEXT
    CHECK (topic IN ('wins','tools_workflows','body_mind','building_revenue','meta'));

ALTER TABLE university_community_posts
  ADD COLUMN IF NOT EXISTS accepted_comment_id UUID
    REFERENCES university_community_comments(id);

-- Type filter (All / Statements / Questions / Ideas): visible posts of a type,
-- newest first. Also backs the Open-questions board (post_type='question').
CREATE INDEX IF NOT EXISTS university_community_posts_type_idx
  ON university_community_posts (post_type, status, created_at DESC);

-- Topic filter (the 5 curated topics): visible posts under a topic, newest first.
CREATE INDEX IF NOT EXISTS university_community_posts_topic_idx
  ON university_community_posts (topic, status, created_at DESC);
