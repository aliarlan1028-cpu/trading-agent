export const SQLITE_WAL_AUTOCHECKPOINT_PAGES = 1_000;
export const SQLITE_WAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

export function applySqliteRuntimePolicy(database) {
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  database.pragma("foreign_keys = ON");
  database.pragma(`wal_autocheckpoint = ${SQLITE_WAL_AUTOCHECKPOINT_PAGES}`);
  database.pragma(`journal_size_limit = ${SQLITE_WAL_SIZE_LIMIT_BYTES}`);
}
