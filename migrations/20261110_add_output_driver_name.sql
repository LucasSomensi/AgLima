BEGIN;

-- Nome do motorista da saída. Opcional: as saídas já existentes permanecem
-- com NULL e o operador pode preencher depois pela edição da saída.
ALTER TABLE public.saidas_balanca
  ADD COLUMN IF NOT EXISTS nome_motorista character varying(120);

ALTER TABLE public.saidas_balanca
  DROP CONSTRAINT IF EXISTS saidas_balanca_nome_motorista_preenchido_check;

-- A aplicação grava NULL quando o campo fica em branco; o banco rejeita
-- textos vazios ou compostos apenas por espaços para manter um único
-- representante de "sem motorista informado".
ALTER TABLE public.saidas_balanca
  ADD CONSTRAINT saidas_balanca_nome_motorista_preenchido_check
  CHECK (nome_motorista IS NULL OR btrim(nome_motorista) <> '');

COMMENT ON COLUMN public.saidas_balanca.nome_motorista IS
  'Nome do motorista do caminhão da saída. Opcional; NULL quando não informado.';

COMMIT;
