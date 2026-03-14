export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS matches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_type       TEXT NOT NULL,
    status          TEXT DEFAULT 'active',
    legs_to_win     INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT
);
CREATE TABLE IF NOT EXISTS match_players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL,
    is_winner   INTEGER DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS legs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL,
    leg_number      INTEGER NOT NULL,
    winner_id       INTEGER,
    starting_score  INTEGER DEFAULT 501,
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (winner_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS turns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    leg_id      INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    turn_number INTEGER NOT NULL,
    score       INTEGER NOT NULL,
    remaining   INTEGER NOT NULL,
    is_bust     INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (leg_id) REFERENCES legs(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS throws (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id     INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    segment     TEXT NOT NULL,
    multiplier  INTEGER NOT NULL DEFAULT 1,
    score       INTEGER NOT NULL,
    throw_order INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (turn_id) REFERENCES turns(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS cricket_matches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL,
    status          TEXT DEFAULT 'active',
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(id)
);
CREATE TABLE IF NOT EXISTS cricket_marks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    number      INTEGER NOT NULL,
    marks       INTEGER DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS cricket_scores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    score       INTEGER DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS cricket_throws (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    number      INTEGER NOT NULL,
    multiplier  INTEGER NOT NULL,
    throw_order INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS shanghai_games (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL,
    max_round       INTEGER DEFAULT 7,
    current_round   INTEGER DEFAULT 1,
    status          TEXT DEFAULT 'active',
    created_at      TEXT DEFAULT (datetime('now')),
    completed_at    TEXT,
    FOREIGN KEY (match_id) REFERENCES matches(id)
);
CREATE TABLE IF NOT EXISTS shanghai_rounds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id     INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    round       INTEGER NOT NULL,
    score       INTEGER DEFAULT 0,
    shanghai    INTEGER DEFAULT 0,
    FOREIGN KEY (game_id) REFERENCES shanghai_games(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS shanghai_throws (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id     INTEGER NOT NULL,
    player_id   INTEGER NOT NULL,
    round       INTEGER NOT NULL,
    multiplier  INTEGER NOT NULL,
    throw_order INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (game_id) REFERENCES shanghai_games(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS practice_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id   INTEGER NOT NULL,
    mode        TEXT NOT NULL,
    started_at  TEXT DEFAULT (datetime('now')),
    ended_at    TEXT,
    FOREIGN KEY (player_id) REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS practice_throws (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL,
    player_id       INTEGER NOT NULL,
    segment         TEXT NOT NULL,
    multiplier      INTEGER NOT NULL DEFAULT 1,
    score           INTEGER NOT NULL,
    throw_order     INTEGER NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES practice_sessions(id),
    FOREIGN KEY (player_id) REFERENCES players(id)
)`;