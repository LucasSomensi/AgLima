BEGIN;

-- Captura criada a partir de uma foto automática (botão "usar foto automática"
-- dos formulários): aponta para a foto automática de onde o arquivo foi
-- copiado. Vazio nas capturas do botão de peso atual. A cópia continua
-- guardada mesmo quando a foto automática é apagada pela retenção.
ALTER TABLE public.balanca_fotos
  ADD COLUMN IF NOT EXISTS foto_origem_id uuid
    REFERENCES public.balanca_fotos(id) ON DELETE SET NULL
    CONSTRAINT balanca_fotos_origem_lancamento_check CHECK (foto_origem_id IS NULL OR origem = 'lancamento');

COMMENT ON COLUMN public.balanca_fotos.foto_origem_id IS
  'Foto automática copiada para esta captura. NULL quando a captura veio do peso atual.';

CREATE INDEX IF NOT EXISTS balanca_fotos_origem_idx
  ON public.balanca_fotos(foto_origem_id)
  WHERE foto_origem_id IS NOT NULL;

COMMIT;
