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
