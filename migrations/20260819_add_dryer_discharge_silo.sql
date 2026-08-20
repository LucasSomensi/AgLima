BEGIN;

ALTER TABLE public.dryer_batches
  ADD COLUMN IF NOT EXISTS discharge_silo_number integer;

ALTER TABLE public.dryer_settings
  ADD COLUMN IF NOT EXISTS discharge_silo_count integer NOT NULL DEFAULT 4;

ALTER TABLE public.dryer_batches
  DROP CONSTRAINT IF EXISTS dryer_batches_discharge_silo_number_check,
  DROP CONSTRAINT IF EXISTS dryer_batches_discharge_silo_number_positive_check;

ALTER TABLE public.dryer_settings
  DROP CONSTRAINT IF EXISTS dryer_settings_discharge_silo_count_check;

ALTER TABLE public.dryer_batches
  ADD CONSTRAINT dryer_batches_discharge_silo_number_positive_check
  CHECK (discharge_silo_number > 0);

ALTER TABLE public.dryer_settings
  ADD CONSTRAINT dryer_settings_discharge_silo_count_check
  CHECK (discharge_silo_count BETWEEN 1 AND 100);

COMMENT ON COLUMN public.dryer_batches.discharge_silo_number IS
  'Número do silo para o qual a batelada foi descarregada.';

COMMENT ON COLUMN public.dryer_settings.discharge_silo_count IS
  'Quantidade de silos disponíveis como destino de descarga.';

COMMIT;
