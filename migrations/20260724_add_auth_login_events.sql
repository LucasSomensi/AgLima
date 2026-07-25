CREATE TABLE IF NOT EXISTS auth_login_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  login_informado text NOT NULL,
  usuario_id uuid REFERENCES users(id) ON DELETE SET NULL,
  resultado text NOT NULL,
  ip_origem text,
  user_agent text,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT auth_login_events_login_informado_texto_check CHECK (length(btrim(login_informado)) > 0),
  CONSTRAINT auth_login_events_resultado_check CHECK (
    resultado IN (
      'sucesso',
      'senha_invalida',
      'usuario_inexistente',
      'usuario_desativado',
      'erro_sistema'
    )
  ),
  CONSTRAINT auth_login_events_ip_origem_texto_check CHECK (ip_origem IS NULL OR length(btrim(ip_origem)) > 0),
  CONSTRAINT auth_login_events_user_agent_texto_check CHECK (user_agent IS NULL OR length(btrim(user_agent)) > 0)
);

CREATE INDEX IF NOT EXISTS auth_login_events_criado_em_idx
  ON auth_login_events (criado_em DESC);

CREATE INDEX IF NOT EXISTS auth_login_events_login_criado_em_idx
  ON auth_login_events (login_informado, criado_em DESC);

CREATE INDEX IF NOT EXISTS auth_login_events_usuario_criado_em_idx
  ON auth_login_events (usuario_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS auth_login_events_resultado_criado_em_idx
  ON auth_login_events (resultado, criado_em DESC);
