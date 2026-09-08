BEGIN;

CREATE TABLE IF NOT EXISTS public.balancas_pesos_atuais (
  balanca_id integer PRIMARY KEY,
  peso_kg integer NOT NULL,
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT balancas_pesos_atuais_balanca_id_positivo_check CHECK (balanca_id > 0),
  CONSTRAINT balancas_pesos_atuais_peso_nao_negativo_check CHECK (peso_kg >= 0)
);

COMMENT ON TABLE public.balancas_pesos_atuais IS
  'Último peso estável, em quilogramas, recebido de cada balança integrada.';

COMMENT ON COLUMN public.balancas_pesos_atuais.atualizado_em IS
  'Data e hora do servidor em que a leitura mais recente foi recebida.';

COMMIT;
