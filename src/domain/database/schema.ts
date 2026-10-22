/**
 * SQLite Database Schema and Versioned Migrations as specified in DATA_MODEL.md.
 */

export const DATABASE_NAME = 'telegram_gallery_backup.db';
export const CURRENT_DATABASE_VERSION = 1;

export interface Migration {
  version: number;
  description: string;
  upSql: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description:
      'Initial schema for media, telegram objects, jobs, exclusions, and settings',
    upSql: [
      `CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        source_key TEXT,
        media_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        relative_path TEXT,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL,
        modified_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        content_hash TEXT,
        state TEXT NOT NULL,
        is_excluded INTEGER NOT NULL DEFAULT 0,
        last_scanned_at_ms INTEGER NOT NULL,
        created_at_ms_local INTEGER NOT NULL,
        updated_at_ms_local INTEGER NOT NULL
      );`,

      `CREATE INDEX IF NOT EXISTS idx_media_items_state ON media_items(state);`,
      `CREATE INDEX IF NOT EXISTS idx_media_items_source_key ON media_items(source_key);`,

      `CREATE TABLE IF NOT EXISTS telegram_objects (
        id TEXT PRIMARY KEY,
        media_item_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        remote_file_id TEXT,
        metadata_version INTEGER NOT NULL,
        content_hash TEXT,
        uploaded_at_ms INTEGER NOT NULL,
        verified_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        UNIQUE(channel_id, message_id),
        FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
      );`,

      `CREATE INDEX IF NOT EXISTS idx_telegram_objects_media_item ON telegram_objects(media_item_id);`,

      `CREATE TABLE IF NOT EXISTS upload_jobs (
        id TEXT PRIMARY KEY,
        media_item_id TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at_ms INTEGER,
        last_error_code TEXT,
        last_error_summary TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
      );`,

      `CREATE INDEX IF NOT EXISTS idx_upload_jobs_state_attempt ON upload_jobs(state, next_attempt_at_ms);`,

      `CREATE TABLE IF NOT EXISTS media_versions (
        id TEXT PRIMARY KEY,
        media_item_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        content_hash TEXT,
        size_bytes INTEGER NOT NULL,
        modified_at_ms INTEGER NOT NULL,
        telegram_object_id TEXT,
        state TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE(media_item_id, version_number),
        FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
      );`,

      `CREATE TABLE IF NOT EXISTS folder_exclusions (
        id TEXT PRIMARY KEY,
        folder_key TEXT NOT NULL UNIQUE,
        display_label TEXT,
        created_at_ms INTEGER NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS backup_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );`,

      `CREATE TABLE IF NOT EXISTS restore_jobs (
        id TEXT PRIMARY KEY,
        telegram_object_id TEXT NOT NULL,
        destination_uri TEXT,
        conflict_policy TEXT NOT NULL,
        state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        FOREIGN KEY (telegram_object_id) REFERENCES telegram_objects(id)
      );`,
    ],
  },
];
