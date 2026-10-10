BEGIN;

CREATE TABLE IF NOT EXISTS public.database_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_started_at timestamptz NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0)
);

CREATE INDEX IF NOT EXISTS database_backups_delivered_at_idx
  ON public.database_backups (delivered_at DESC);

COMMIT;
