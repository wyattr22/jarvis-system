-- ============================================================
-- JARVIS v2 — Full Database Schema (Turso/SQLite)
-- ============================================================

-- ── Strategy + execution layer ──────────────────────────────

CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules_json TEXT,
  enabled INTEGER DEFAULT 1,
  weight REAL DEFAULT 1.0,
  config_json TEXT,
  capital_tier INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  strategy_id TEXT REFERENCES strategies(id),
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry REAL,
  stop REAL,
  target REAL,
  confidence REAL,
  reasoning_json TEXT,
  feature_snapshot_json TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  signal_id TEXT REFERENCES signals(id),
  broker TEXT,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL,
  size REAL,
  fill_price REAL,
  exit_price REAL,
  pnl REAL,
  r_multiple REAL,
  mfe REAL,
  mae REAL,
  regime_tag TEXT,
  opened_at INTEGER,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS attribution (
  trade_id TEXT REFERENCES trades(id),
  strategy_id TEXT REFERENCES strategies(id),
  contribution_pct REAL,
  PRIMARY KEY (trade_id, strategy_id)
);

-- ── Feature engineering layer ────────────────────────────────

CREATE TABLE IF NOT EXISTS features (
  instrument TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  feature_name TEXT NOT NULL,
  value REAL,
  PRIMARY KEY (instrument, timestamp, feature_name)
);
CREATE INDEX IF NOT EXISTS idx_features_lookup ON features(instrument, feature_name, timestamp);

CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,
  discovered_by TEXT,
  pattern_json TEXT,
  validated INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- ── Agent council layer ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT,
  model_provider TEXT,
  model_id TEXT,
  model_family TEXT,
  status TEXT DEFAULT 'active',
  spawned_at INTEGER NOT NULL,
  spawned_by TEXT DEFAULT 'user'
);

CREATE TABLE IF NOT EXISTS agent_outputs (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id),
  output_type TEXT NOT NULL,
  output_json TEXT NOT NULL,
  related_id TEXT,
  context_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_scores (
  agent_id TEXT REFERENCES agents(id),
  output_id TEXT REFERENCES agent_outputs(id),
  outcome TEXT,
  pnl_impact REAL,
  type_1_error INTEGER DEFAULT 0,
  type_2_error INTEGER DEFAULT 0,
  scored_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, output_id)
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  agent_id TEXT REFERENCES agents(id),
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  changed_by TEXT DEFAULT 'user',
  performance_score REAL,
  active_from INTEGER NOT NULL,
  active_to INTEGER,
  PRIMARY KEY (agent_id, version)
);

CREATE TABLE IF NOT EXISTS meta_decisions (
  id TEXT PRIMARY KEY,
  decision_type TEXT NOT NULL,
  target_agent_id TEXT,
  rationale TEXT,
  proposed_change_json TEXT,
  evidence_json TEXT,
  approval_required INTEGER DEFAULT 1,
  approved_by_user INTEGER,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- ── Proposals + experiments ──────────────────────────────────

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  strategy_id TEXT,
  hypothesis TEXT NOT NULL,
  proposed_change_json TEXT,
  evidence_json TEXT,
  walk_forward_result_json TEXT,
  holdout_result_json TEXT,
  stability_score REAL,
  causality_score REAL,
  ensemble_confidence REAL,
  critic_scores_json TEXT,
  risk_verdict TEXT,
  status TEXT DEFAULT 'pending',
  reviewer_notes TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  proposal_id TEXT REFERENCES proposals(id),
  original_strategy_id TEXT,
  modified_config_json TEXT,
  shadow_trades_required INTEGER DEFAULT 50,
  shadow_trades_completed INTEGER DEFAULT 0,
  original_pnl REAL,
  modified_pnl REAL,
  original_sharpe REAL,
  modified_sharpe REAL,
  significance_p REAL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS drift_log (
  strategy_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  expected_r REAL,
  actual_r REAL,
  divergence_sigma REAL,
  auto_paused INTEGER DEFAULT 0,
  PRIMARY KEY (strategy_id, window_start)
);

CREATE TABLE IF NOT EXISTS correlation_matrix (
  strategy_a TEXT NOT NULL,
  strategy_b TEXT NOT NULL,
  regime_tag TEXT NOT NULL,
  correlation REAL,
  sample_size INTEGER,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (strategy_a, strategy_b, regime_tag)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

-- ── Alerts ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  instrument TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  triggered_at INTEGER,
  created_at INTEGER NOT NULL
);

-- ── Holdout boundary ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS holdout_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  boundary_timestamp INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
