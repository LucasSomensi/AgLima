const DISCHARGE_FORECAST_LOOKBACK_MINUTES = 105;
const DEFAULT_DISCHARGE_FORECAST_CURVE = {
  quadraticCoefficient: -1.6161,
  linearCoefficient: 109.2740,
  initialMoistureQuadraticCoefficient: -0.5309,
  initialMoistureLinearCoefficient: 30.5990,
  constantCoefficient: -1745.5815,
};
const TARGET_MOISTURE_REFERENCE = 14;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

function toValidTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function getMoistureAt(timestamp, points) {
  if (points.length === 1 || timestamp <= points[0].timestamp) {
    return points[0].moisture;
  }

  const lastPoint = points[points.length - 1];

  if (timestamp >= lastPoint.timestamp) {
    return lastPoint.moisture;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previousPoint = points[index - 1];
    const nextPoint = points[index];

    if (timestamp <= nextPoint.timestamp) {
      const elapsed = timestamp - previousPoint.timestamp;
      const duration = nextPoint.timestamp - previousPoint.timestamp;
      const ratio = duration === 0 ? 0 : elapsed / duration;

      return previousPoint.moisture + (nextPoint.moisture - previousPoint.moisture) * ratio;
    }
  }

  return lastPoint.moisture;
}

function calculateAverageMoisture({ readings, periodStart, periodEnd }) {
  const points = readings
    .map((reading) => ({
      timestamp: toValidTimestamp(reading.measured_at),
      moisture: toFiniteNumber(reading.moisture_percent),
    }))
    .filter((point) => point.timestamp !== null && point.moisture !== null)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (points.length === 0) {
    return null;
  }

  if (periodEnd <= periodStart) {
    return getMoistureAt(periodEnd, points);
  }

  const integrationPoints = [
    {
      timestamp: periodStart,
      moisture: getMoistureAt(periodStart, points),
    },
    ...points.filter((point) => point.timestamp > periodStart && point.timestamp < periodEnd),
    {
      timestamp: periodEnd,
      moisture: getMoistureAt(periodEnd, points),
    },
  ];

  let area = 0;

  for (let index = 1; index < integrationPoints.length; index += 1) {
    const previousPoint = integrationPoints[index - 1];
    const nextPoint = integrationPoints[index];
    const duration = nextPoint.timestamp - previousPoint.timestamp;

    area += ((previousPoint.moisture + nextPoint.moisture) / 2) * duration;
  }

  return area / (periodEnd - periodStart);
}


function normalizeDischargeForecastCurve(settings = {}) {
  return {
    quadraticCoefficient: toFiniteNumber(settings.discharge_forecast_quadratic_coefficient) ?? DEFAULT_DISCHARGE_FORECAST_CURVE.quadraticCoefficient,
    linearCoefficient: toFiniteNumber(settings.discharge_forecast_linear_coefficient) ?? DEFAULT_DISCHARGE_FORECAST_CURVE.linearCoefficient,
    initialMoistureQuadraticCoefficient: toFiniteNumber(settings.discharge_forecast_initial_moisture_quadratic_coefficient) ?? DEFAULT_DISCHARGE_FORECAST_CURVE.initialMoistureQuadraticCoefficient,
    initialMoistureLinearCoefficient: toFiniteNumber(settings.discharge_forecast_initial_moisture_linear_coefficient) ?? DEFAULT_DISCHARGE_FORECAST_CURVE.initialMoistureLinearCoefficient,
    constantCoefficient: toFiniteNumber(settings.discharge_forecast_constant_coefficient) ?? DEFAULT_DISCHARGE_FORECAST_CURVE.constantCoefficient,
  };
}

function calculateForecastCurveMinutes(moisture, initialMoisture, curveSettings) {
  const {
    quadraticCoefficient,
    linearCoefficient,
    initialMoistureQuadraticCoefficient,
    initialMoistureLinearCoefficient,
    constantCoefficient,
  } = normalizeDischargeForecastCurve(curveSettings);

  return (quadraticCoefficient * (moisture ** 2))
    + (linearCoefficient * moisture)
    + (initialMoistureQuadraticCoefficient * (initialMoisture ** 2))
    + (initialMoistureLinearCoefficient * initialMoisture)
    + constantCoefficient;
}

function calculateTargetMoistureCorrection(targetMoisture) {
  const target = toFiniteNumber(targetMoisture);

  if (target === null) {
    return 0;
  }

  return (TARGET_MOISTURE_REFERENCE - target) * 60;
}

function calculateMinutesRemainingFromAverageMoisture(averageMoisture, targetMoisture, initialMoisture, curveSettings) {
  const moisture = toFiniteNumber(averageMoisture);
  const batchInitialMoisture = toFiniteNumber(initialMoisture);

  if (moisture === null || batchInitialMoisture === null) {
    return null;
  }

  const curveMinutes = calculateForecastCurveMinutes(moisture, batchInitialMoisture, curveSettings);
  const correctedMinutes = curveMinutes + calculateTargetMoistureCorrection(targetMoisture);

  return Math.max(0, correctedMinutes);
}

function deduplicateReadingsByTimestamp(readings) {
  const readingsByTimestamp = new Map();

  readings.forEach((reading) => {
    readingsByTimestamp.set(reading.measuredAtTimestamp, reading);
  });

  return [...readingsByTimestamp.values()].sort((left, right) => left.measuredAtTimestamp - right.measuredAtTimestamp);
}

function calculateDischargeForecast({ batch, readings, now = new Date(), curveSettings } = {}) {
  if (!batch) {
    return { status: 'unavailable' };
  }

  if (batch.discharge_started_at) {
    const dischargeStartedAt = new Date(batch.discharge_started_at);

    return {
      status: 'started',
      dischargeStartedAt,
      estimatedEndAt: new Date(dischargeStartedAt.getTime() + DISCHARGE_FORECAST_LOOKBACK_MINUTES * MILLISECONDS_PER_MINUTE),
      batchStartedAt: new Date(batch.started_at),
    };
  }

  const batchStartedAt = toValidTimestamp(batch.started_at);
  const initialMoisture = toFiniteNumber(batch.umidade_inicial);

  if (batchStartedAt === null || initialMoisture === null) {
    return { status: 'unavailable' };
  }

  const validReadings = deduplicateReadingsByTimestamp(readings
    .map((reading) => ({
      ...reading,
      measuredAtTimestamp: toValidTimestamp(reading.measured_at),
    }))
    .filter((reading) => reading.measuredAtTimestamp !== null && toFiniteNumber(reading.moisture_percent) !== null)
    .sort((left, right) => left.measuredAtTimestamp - right.measuredAtTimestamp));

  const lastReading = validReadings[validReadings.length - 1];
  const periodEnd = lastReading ? lastReading.measuredAtTimestamp : batchStartedAt;
  const lookbackStart = periodEnd - DISCHARGE_FORECAST_LOOKBACK_MINUTES * MILLISECONDS_PER_MINUTE;
  const periodStart = lookbackStart;
  const readingsWithInitialMoisture = [
    {
      measured_at: new Date(batchStartedAt),
      moisture_percent: initialMoisture,
    },
    ...validReadings,
  ];
  const averageMoisture = lastReading
    ? calculateAverageMoisture({
        readings: readingsWithInitialMoisture,
        periodStart,
        periodEnd,
      })
    : initialMoisture;

  if (averageMoisture === null) {
    return { status: 'unavailable' };
  }

  const minutesRemaining = calculateMinutesRemainingFromAverageMoisture(averageMoisture, batch.target_moisture, initialMoisture, curveSettings);

  if (!Number.isFinite(minutesRemaining)) {
    return { status: 'unavailable', averageMoisture };
  }

  const forecastBaseTimestamp = lastReading ? periodEnd : batchStartedAt;
  const forecastAt = new Date(forecastBaseTimestamp + minutesRemaining * MILLISECONDS_PER_MINUTE);
  const nowTimestamp = toValidTimestamp(now) || Date.now();

  if (nowTimestamp >= forecastAt.getTime()) {
    return {
      status: 'immediate',
      averageMoisture,
      forecastAt,
      lastMeasuredAt: lastReading ? new Date(periodEnd) : null,
    };
  }

  return {
    status: 'forecast',
    averageMoisture,
    forecastAt,
    lastMeasuredAt: lastReading ? new Date(periodEnd) : null,
  };
}

module.exports = {
  calculateAverageMoisture,
  calculateDischargeForecast,
  calculateMinutesRemainingFromAverageMoisture,
  DISCHARGE_FORECAST_LOOKBACK_MINUTES,
  DEFAULT_DISCHARGE_FORECAST_CURVE,
  normalizeDischargeForecastCurve,
};
