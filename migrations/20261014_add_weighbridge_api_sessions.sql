BEGIN;

CREATE TABLE IF NOT EXISTS public.balanca_api_sessoes (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  usuario_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  CHECK (expira_em > criado_em)
);
CREATE INDEX IF NOT EXISTS balanca_api_sessoes_usuario_idx ON public.balanca_api_sessoes(usuario_id);
CREATE INDEX IF NOT EXISTS balanca_api_sessoes_expira_idx ON public.balanca_api_sessoes(expira_em);

-- A change of credentials or permissions immediately revokes API sessions.
CREATE OR REPLACE FUNCTION public.revogar_sessoes_api_balanca()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.disabled IS DISTINCT FROM OLD.disabled THEN
    DELETE FROM public.balanca_api_sessoes WHERE usuario_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS users_revogar_sessoes_api_balanca ON public.users;
CREATE TRIGGER users_revogar_sessoes_api_balanca
AFTER UPDATE OF password_hash, role, disabled ON public.users
FOR EACH ROW EXECUTE FUNCTION public.revogar_sessoes_api_balanca();

COMMIT;
