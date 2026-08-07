ALTER TABLE dryer_settings
  ADD COLUMN IF NOT EXISTS discharge_forecast_initial_moisture_quadratic_coefficient numeric DEFAULT -0.5309,
  ADD COLUMN IF NOT EXISTS discharge_forecast_initial_moisture_linear_coefficient numeric DEFAULT 30.5990;

UPDATE dryer_settings
SET discharge_forecast_quadratic_coefficient = COALESCE(discharge_forecast_quadratic_coefficient, -1.6161),
    discharge_forecast_linear_coefficient = COALESCE(discharge_forecast_linear_coefficient, 109.2740),
    discharge_forecast_initial_moisture_quadratic_coefficient = COALESCE(discharge_forecast_initial_moisture_quadratic_coefficient, -0.5309),
    discharge_forecast_initial_moisture_linear_coefficient = COALESCE(discharge_forecast_initial_moisture_linear_coefficient, 30.5990),
    discharge_forecast_constant_coefficient = COALESCE(discharge_forecast_constant_coefficient, -1745.5815);
