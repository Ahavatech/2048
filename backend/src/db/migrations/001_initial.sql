CREATE TABLE scores (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 12),
  score INTEGER NOT NULL CHECK (score >= 0),
  highest_tile INTEGER NOT NULL CHECK (highest_tile >= 2),
  moves INTEGER NOT NULL CHECK (moves >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  submitted_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  submission_rank INTEGER NOT NULL CHECK (submission_rank >= 1)
);

CREATE INDEX scores_leaderboard_order_idx ON scores (score DESC, submitted_at ASC, id ASC);
