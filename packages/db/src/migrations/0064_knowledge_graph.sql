-- Knowledge Graph + Agent Memory tables
-- Adds structured relationship intelligence, knowledge tags, and persistent agent memory

-- 1. Knowledge Tags — shared vocabulary of technologies, protocols, categories
CREATE TABLE IF NOT EXISTS knowledge_tags (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tag_type TEXT NOT NULL DEFAULT 'technology',  -- technology | protocol | language | category | ecosystem
  description TEXT,
  aliases JSONB NOT NULL DEFAULT '[]',
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_tags_type ON knowledge_tags (tag_type);

-- 2. Company Relationships — typed directed edges between entities
CREATE TABLE IF NOT EXISTS company_relationships (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,        -- 'company' | 'tag'
  source_id TEXT NOT NULL,          -- slug
  relationship TEXT NOT NULL,       -- uses | built_on | competes_with | partners_with | fork_of | invested_in | maintains | integrates
  target_type TEXT NOT NULL,        -- 'company' | 'tag'
  target_id TEXT NOT NULL,          -- slug
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_report_ids JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  extracted_by TEXT,                -- agent slug that created it
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, relationship, target_type, target_id)
);

CREATE INDEX idx_cr_source ON company_relationships (source_type, source_id);
CREATE INDEX idx_cr_target ON company_relationships (target_type, target_id);
CREATE INDEX idx_cr_relationship ON company_relationships (relationship);

-- 3. Agent Memory — structured fact storage per agent
CREATE TABLE IF NOT EXISTS agent_memory (
  id SERIAL PRIMARY KEY,
  agent_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT,
  embedding vector(1024),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_memory_agent ON agent_memory (agent_name);
CREATE INDEX idx_agent_memory_subject ON agent_memory (subject, predicate);
CREATE INDEX idx_agent_memory_expires ON agent_memory (expires_at) WHERE expires_at IS NOT NULL;
