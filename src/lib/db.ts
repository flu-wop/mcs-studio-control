import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let ready: Promise<void> | null = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studio TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    done_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_commands_pending ON commands(studio, status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS studio_status (
    studio TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    cam TEXT PRIMARY KEY,
    studio TEXT NOT NULL,
    jpeg_b64 TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    revoked INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invites_hash ON invites(code_hash)`,
  `CREATE TABLE IF NOT EXISTS engineers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studio TEXT NOT NULL,
    tc TEXT NOT NULL,
    tc_ms INTEGER NOT NULL,
    rec_start INTEGER NOT NULL,
    label TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    studio TEXT NOT NULL,
    client TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    cancelled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_window ON bookings(studio, cancelled, end_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studio TEXT NOT NULL,
    name TEXT NOT NULL,
    booking_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    started_by TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_studio ON sessions(studio, ended_at)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    k TEXT,
    w INTEGER,
    c INTEGER,
    PRIMARY KEY (k, w)
  )`,
];

function raw(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "file:local.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

/** Returns the Turso client, creating the tables on first use of each server instance. */
export async function getDb(): Promise<Client> {
  const c = raw();
  if (!ready) {
    ready = c
      .batch(SCHEMA.map((sql) => ({ sql, args: [] })), "write")
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  await ready;
  return c;
}
