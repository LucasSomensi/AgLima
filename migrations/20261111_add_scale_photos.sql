BEGIN;

-- Foto mais recente enviada pelo AutoWeight junto com o peso atual. A foto só
-- vale para o peso quando foto_atualizado_em = atualizado_em: um peso enviado
-- depois, sem foto, deixa a foto antiga automaticamente inválida.
ALTER TABLE public.balancas_pesos_atuais
  ADD COLUMN IF NOT EXISTS foto_arquivo text,
  ADD COLUMN IF NOT EXISTS foto_atualizado_em timestamp with time zone;

COMMENT ON COLUMN public.balancas_pesos_atuais.foto_arquivo IS
  'Caminho relativo, dentro do volume de fotos, da foto recebida junto com o peso atual.';

COMMENT ON COLUMN public.balancas_pesos_atuais.foto_atualizado_em IS
  'Valor de atualizado_em do peso que acompanhou a foto. Diferente de atualizado_em significa foto desatualizada.';

CREATE TABLE IF NOT EXISTS public.balanca_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balanca_id integer NOT NULL DEFAULT 1 CHECK (balanca_id > 0),
  origem text NOT NULL CHECK (origem IN ('automatica', 'lancamento')),
  status text NOT NULL CHECK (status IN ('recebida', 'substituida', 'temporaria', 'vinculada')),
  arquivo text NOT NULL UNIQUE CHECK (arquivo ~ '^(automaticas|capturas)/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}\.jpg$'),
  tamanho_bytes integer NOT NULL CHECK (tamanho_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  peso_kg integer NOT NULL CHECK (peso_kg >= 0),
  capturada_em timestamp with time zone NOT NULL,
  recebida_em timestamp with time zone NOT NULL DEFAULT now(),
  contingencia boolean NOT NULL DEFAULT false,
  chave_cliente text UNIQUE CHECK (chave_cliente ~ '^[A-Za-z0-9._-]{1,120}$'),
  entrada_id bigint REFERENCES public.entradas_balanca(id) ON DELETE SET NULL,
  saida_id bigint REFERENCES public.saidas_balanca(id) ON DELETE SET NULL,
  tipo_peso text CHECK (tipo_peso IN ('bruto', 'tara')),
  criada_por_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  expira_em timestamp with time zone,
  vinculada_em timestamp with time zone,
  CONSTRAINT balanca_fotos_automatica_check CHECK (
    origem <> 'automatica' OR (
      status IN ('recebida', 'substituida')
      AND chave_cliente IS NOT NULL
      AND entrada_id IS NULL AND saida_id IS NULL AND tipo_peso IS NULL
    )
  ),
  CONSTRAINT balanca_fotos_lancamento_check CHECK (
    origem <> 'lancamento' OR (
      status IN ('temporaria', 'vinculada')
      AND chave_cliente IS NULL
    )
  ),
  CONSTRAINT balanca_fotos_temporaria_check CHECK (
    status <> 'temporaria' OR (
      expira_em IS NOT NULL
      AND entrada_id IS NULL AND saida_id IS NULL AND tipo_peso IS NULL
    )
  ),
  CONSTRAINT balanca_fotos_vinculada_check CHECK (
    status <> 'vinculada' OR (tipo_peso IS NOT NULL AND vinculada_em IS NOT NULL AND expira_em IS NULL)
  ),
  CONSTRAINT balanca_fotos_um_registro_check CHECK (entrada_id IS NULL OR saida_id IS NULL)
);

COMMENT ON TABLE public.balanca_fotos IS
  'Fotos da câmera da balança. Os bytes ficam no volume (FOTOS_DIR); a tabela guarda metadados e vínculos.';

CREATE INDEX IF NOT EXISTS balanca_fotos_entrada_idx ON public.balanca_fotos(entrada_id) WHERE entrada_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS balanca_fotos_saida_idx ON public.balanca_fotos(saida_id) WHERE saida_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS balanca_fotos_automaticas_idx ON public.balanca_fotos(capturada_em) WHERE origem = 'automatica';
CREATE INDEX IF NOT EXISTS balanca_fotos_temporarias_idx ON public.balanca_fotos(expira_em) WHERE status = 'temporaria';

COMMIT;
