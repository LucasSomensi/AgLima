const DISCHARGE_FORECAST_LOOKBACK_MINUTES = 105;
const DISCHARGE_FORECAST_TABLE = [
  { moisture: 29.5, minutesRemaining: 520 },
  { moisture: 25, minutesRemaining: 415 },
  { moisture: 22, minutesRemaining: 300 },
  { moisture: 18.5, minutesRemaining: 150 },
  { moisture: 16.5, minutesRemaining: 45 },
  { moisture: 15.2, minutesRemaining: 0 },
];
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


function calculateMinutesRemainingFromAverageMoisture(averageMoisture) {
  const moisture = toFiniteNumber(averageMoisture);

  if (moisture === null) {
    return null;
  }

  const descendingTable = DISCHARGE_FORECAST_TABLE;
  const highestMoisturePoint = descendingTable[0];
  const lowestMoisturePoint = descendingTable[descendingTable.length - 1];

  if (moisture >= highestMoisturePoint.moisture) {
    return highestMoisturePoint.minutesRemaining;
  }

  if (moisture < lowestMoisturePoint.moisture) {
    return 0;
  }

  for (let index = 1; index < descendingTable.length; index += 1) {
    const higherPoint = descendingTable[index - 1];
    const lowerPoint = descendingTable[index];

    if (moisture >= lowerPoint.moisture) {
      const ratio = (moisture - lowerPoint.moisture) / (higherPoint.moisture - lowerPoint.moisture);

      return lowerPoint.minutesRemaining
        + (higherPoint.minutesRemaining - lowerPoint.minutesRemaining) * ratio;
    }
  }

  return null;
}

function deduplicateReadingsByTimestamp(readings) {
  const readingsByTimestamp = new Map();

  readings.forEach((reading) => {
    readingsByTimestamp.set(reading.measuredAtTimestamp, reading);
  });

  return [...readingsByTimestamp.values()].sort((left, right) => left.measuredAtTimestamp - right.measuredAtTimestamp);
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

  const minutesRemaining = calculateMinutesRemainingFromAverageMoisture(averageMoisture);

  if (!Number.isFinite(minutesRemaining)) {
    return { status: 'unavailable', averageMoisture };
  }

  const forecastBaseTimestamp = lastReading ? periodEnd : batchStartedAt;
  const forecastAt = new Date(forecastBaseTimestamp + minutesRemaining * MILLISECONDS_PER_MINUTE);
  const nowTimestamp = toValidTimestamp(now) || Date.now();

  if (nowTimestamp > forecastAt.getTime()) {
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
};
