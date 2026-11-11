BEGIN;

-- Versão das sessões web de cada usuário. O cookie de sessão guarda a versão
-- vigente no login; quando ela muda, todos os cookies anteriores deixam de valer.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;

-- Troca de senha, de perfil ou desativação revogam imediatamente as sessões web,
-- inclusive quando a alteração é feita diretamente no banco. Espelha a trigger
-- users_revogar_sessoes_api_balanca, que faz o mesmo para a API da balança.
CREATE OR REPLACE FUNCTION public.revogar_sessoes_web()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.disabled IS DISTINCT FROM OLD.disabled THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_revogar_sessoes_web ON public.users;
CREATE TRIGGER users_revogar_sessoes_web
BEFORE UPDATE OF password_hash, role, disabled ON public.users
FOR EACH ROW EXECUTE FUNCTION public.revogar_sessoes_web();

COMMIT;
