BEGIN;

-- O e-mail usado na nota fiscal pertence ao comprador, não ao contrato:
-- um comprador com vários contratos tem o e-mail preenchido uma única vez.
ALTER TABLE public.compradores
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.compradores
  DROP CONSTRAINT IF EXISTS compradores_email_preenchido_check;

-- A aplicação grava NULL quando o campo fica em branco.
ALTER TABLE public.compradores
  ADD CONSTRAINT compradores_email_preenchido_check
  CHECK (email IS NULL OR btrim(email) <> '');

COMMENT ON COLUMN public.compradores.email IS
  'E-mail do comprador para apoio à emissão da nota fiscal. Opcional; NULL quando não informado.';

-- Copia para cada comprador o e-mail do contrato atualizado por último entre
-- os que têm e-mail preenchido (desempate pelo maior id) e remove a coluna
-- antiga. O bloco só roda enquanto contratos.email existir, para que a
-- migration possa ser reaplicada sem erro.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contratos'
      AND column_name = 'email'
  ) THEN
    UPDATE public.compradores comp
    SET email = ultimo.email,
        atualizado_em = now()
    FROM (
      SELECT DISTINCT ON (c.comprador_id)
             c.comprador_id,
             btrim(c.email) AS email
      FROM public.contratos c
      WHERE c.email IS NOT NULL
        AND btrim(c.email) <> ''
      ORDER BY c.comprador_id, c.atualizado_em DESC, c.id DESC
    ) ultimo
    WHERE comp.id = ultimo.comprador_id
      AND comp.email IS NULL;

    ALTER TABLE public.contratos DROP COLUMN email;
  END IF;
END
$$;

COMMIT;
