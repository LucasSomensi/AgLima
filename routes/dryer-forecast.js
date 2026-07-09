const DISCHARGE_FORECAST_LOOKBACK_MINUTES = 105;
const DISCHARGE_FORECAST_OFFSET_MINUTES = 100;
const DISCHARGE_FORECAST_TREND_WINDOW_MINUTES = 120;
const DISCHARGE_FORECAST_MIN_TREND_POINTS = 3;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

function toValidTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}

function toFiniteNumber(value) {
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

function deduplicateReadingsByTimestamp(readings) {
  const readingsByTimestamp = new Map();

  readings.forEach((reading) => {
    readingsByTimestamp.set(reading.measuredAtTimestamp, reading);
  });

  return [...readingsByTimestamp.values()].sort((left, right) => left.measuredAtTimestamp - right.measuredAtTimestamp);
}

function calculateLinearTrend(points) {
  const firstTimestamp = points[0].timestamp;
  const normalizedPoints = points.map((point) => ({
    minutes: (point.timestamp - firstTimestamp) / MILLISECONDS_PER_MINUTE,
    moisture: point.moisture,
  }));
  const averageMinutes = normalizedPoints.reduce((sum, point) => sum + point.minutes, 0) / normalizedPoints.length;
  const averageMoisture = normalizedPoints.reduce((sum, point) => sum + point.moisture, 0) / normalizedPoints.length;
  let numerator = 0;
  let denominator = 0;

  normalizedPoints.forEach((point) => {
    const minutesDelta = point.minutes - averageMinutes;
    numerator += minutesDelta * (point.moisture - averageMoisture);
    denominator += minutesDelta ** 2;
  });

  if (denominator === 0) {
    return null;
  }

  const slope = numerator / denominator;
  const intercept = averageMoisture - slope * averageMinutes;

  return {
    firstTimestamp,
    intercept,
    slope,
  };
}

function calculateDischargeForecast({ batch, readings, now = new Date() }) {
  if (!batch) {
    return { status: 'unavailable' };
  }

  if (batch.discharge_started_at) {
    return {
      status: 'started',
      dischargeStartedAt: new Date(batch.discharge_started_at),
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
  const averageMoisture = calculateAverageMoisture({
    readings: readingsWithInitialMoisture,
    periodStart,
    periodEnd,
  });

  if (averageMoisture === null) {
    return { status: 'unavailable' };
  }

  const targetMoisture = toFiniteNumber(batch.target_moisture) || 14.5;
  const trendStart = periodEnd - DISCHARGE_FORECAST_TREND_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;
  const trendPoints = validReadings
    .filter((reading) => reading.measuredAtTimestamp >= trendStart && reading.measuredAtTimestamp <= periodEnd)
    .map((reading, index, filteredReadings) => {
      const readingsUntilPoint = validReadings.filter(
        (validReading) => validReading.measuredAtTimestamp <= reading.measuredAtTimestamp
      );
      const measuredAt = reading.measuredAtTimestamp;
      const pointAverageMoisture = calculateAverageMoisture({
        readings: [
          {
            measured_at: new Date(batchStartedAt),
            moisture_percent: initialMoisture,
          },
          ...readingsUntilPoint,
        ],
        periodStart: measuredAt - DISCHARGE_FORECAST_LOOKBACK_MINUTES * MILLISECONDS_PER_MINUTE,
        periodEnd: measuredAt,
      });

      return {
        timestamp: filteredReadings[index].measuredAtTimestamp,
        moisture: pointAverageMoisture,
      };
    })
    .filter((point) => point.moisture !== null);

  if (trendPoints.length < DISCHARGE_FORECAST_MIN_TREND_POINTS) {
    return { status: 'unavailable', averageMoisture };
  }

  if (averageMoisture <= targetMoisture) {
    return {
      status: 'immediate',
      averageMoisture,
      forecastAt: new Date(periodEnd),
      lastMeasuredAt: new Date(periodEnd),
    };
  }

  const linearTrend = calculateLinearTrend(trendPoints);

  if (!linearTrend || linearTrend.slope >= 0) {
    return { status: 'unavailable', averageMoisture };
  }

  const currentMinutes = (periodEnd - linearTrend.firstTimestamp) / MILLISECONDS_PER_MINUTE;
  const targetMinutes = (targetMoisture - linearTrend.intercept) / linearTrend.slope;
  const minutesRemaining = targetMinutes - currentMinutes - DISCHARGE_FORECAST_OFFSET_MINUTES;

  if (!Number.isFinite(minutesRemaining)) {
    return { status: 'unavailable', averageMoisture };
  }

  const forecastAt = new Date(periodEnd + minutesRemaining * MILLISECONDS_PER_MINUTE);
  const nowTimestamp = toValidTimestamp(now) || Date.now();

  if (nowTimestamp > forecastAt.getTime()) {
    return {
      status: 'immediate',
      averageMoisture,
      forecastAt,
      lastMeasuredAt: new Date(periodEnd),
    };
  }

  return {
    status: 'forecast',
    averageMoisture,
    forecastAt,
    lastMeasuredAt: new Date(periodEnd),
  };
}

module.exports = {
  calculateAverageMoisture,
  calculateDischargeForecast,
};
