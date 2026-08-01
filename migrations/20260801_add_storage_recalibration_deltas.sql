ALTER TABLE public.armazenamento_recalibracoes
  ADD COLUMN delta numeric NOT NULL DEFAULT 0,
  ADD COLUMN delta_porcento numeric;

COMMENT ON COLUMN public.armazenamento_recalibracoes.delta IS
  'Diferença em kg entre a quantidade recalibrada e o saldo calculado antes da recalibração.';

COMMENT ON COLUMN public.armazenamento_recalibracoes.delta_porcento IS
  'Delta dividido pelas entradas desde a recalibração anterior, em percentual; nulo quando não há entradas.';
