-- Índices para paginação por cursor das listagens históricas.
-- Execute com: psql "$DATABASE_URL" -f migrations/20260712_cursor_pagination_indexes.sql

CREATE INDEX IF NOT EXISTS idx_entradas_balanca_data_entrada_id_desc
  ON entradas_balanca (data_entrada DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_saidas_balanca_data_saida_id_desc
  ON saidas_balanca (data_saida DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_dryer_batches_started_created_id_desc
  ON dryer_batches (started_at DESC, created_at DESC, id DESC);
