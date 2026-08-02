BEGIN;

ALTER TABLE public.dryer_batches
  ADD COLUMN IF NOT EXISTS n bigint;

CREATE SEQUENCE IF NOT EXISTS public.dryer_batches_n_seq;

ALTER SEQUENCE public.dryer_batches_n_seq
  OWNED BY public.dryer_batches.n;

SET CONSTRAINTS ALL DEFERRED;

WITH numbered_batches AS (
  SELECT id,
         row_number() OVER (ORDER BY started_at, created_at, id) AS n
  FROM public.dryer_batches
)
UPDATE public.dryer_batches batches
SET n = numbered_batches.n
FROM numbered_batches
WHERE batches.id = numbered_batches.id;

-- Use PERFORM inside a procedural block instead of a top-level SELECT. Railway's
-- query editor can append LIMIT to top-level SELECT statements, which makes a
-- multi-statement migration fail with "syntax error at or near LIMIT".
DO $$
BEGIN
  PERFORM setval(
    'public.dryer_batches_n_seq',
    GREATEST(COALESCE((SELECT MAX(n) FROM public.dryer_batches), 0), 1),
    EXISTS (SELECT 1 FROM public.dryer_batches)
  );
END
$$ LANGUAGE plpgsql;

ALTER TABLE public.dryer_batches
  ALTER COLUMN n SET DEFAULT nextval('public.dryer_batches_n_seq'),
  ALTER COLUMN n SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.dryer_batches'::regclass
      AND conname = 'dryer_batches_n_check'
  ) THEN
    ALTER TABLE public.dryer_batches
      ADD CONSTRAINT dryer_batches_n_check CHECK (n > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.dryer_batches'::regclass
      AND conname = 'dryer_batches_n_key'
  ) THEN
    ALTER TABLE public.dryer_batches
      ADD CONSTRAINT dryer_batches_n_key UNIQUE (n) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN public.dryer_batches.n IS
  'Número sequencial da batelada, atribuído em ordem cronológica.';

COMMIT;
