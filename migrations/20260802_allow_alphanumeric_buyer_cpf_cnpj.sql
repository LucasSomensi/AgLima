BEGIN;

ALTER TABLE public.compradores
  DROP CONSTRAINT IF EXISTS compradores_cpf_cnpj_check;

ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_cpf_cnpj_check CHECK (
    cpf_cnpj IS NULL
    OR cpf_cnpj ~ '^([A-Z0-9]{11}|[A-Z0-9]{14})$'
  );

COMMIT;
