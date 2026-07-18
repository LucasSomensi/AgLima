ALTER TABLE dryer_settings
  ADD COLUMN IF NOT EXISTS discharge_forecast_quadratic_coefficient numeric,
  ADD COLUMN IF NOT EXISTS discharge_forecast_linear_coefficient numeric,
  ADD COLUMN IF NOT EXISTS discharge_forecast_constant_coefficient numeric;
