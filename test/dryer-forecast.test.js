const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateAverageMoisture, calculateDischargeForecast } = require('../routes/dryer-forecast');

const DRYER_DECAY_A = 0.79542;
const DRYER_DECAY_B = 1.88673;

function calculateExpectedForecastAt(baseDate, averageMoisture, targetMoisture = 14.5) {
  const xInf = DRYER_DECAY_B / (1 - DRYER_DECAY_A);
  const alpha = DRYER_DECAY_A ** (1 / 6);
  const beta = (targetMoisture - xInf) / (averageMoisture - xInf);
  const minutesRemaining = (15 * Math.log(beta)) / Math.log(alpha) - 90;

  return new Date(baseDate.getTime() + minutesRemaining * 60 * 1000);
}

test('calcula previsão antes da primeira medição usando a umidade inicial da batelada', () => {
  const batchStartedAt = new Date('2026-06-21T13:00:00.000Z');
  const forecast = calculateDischargeForecast({
    batch: {
      started_at: batchStartedAt,
      target_moisture: 14.5,
      umidade_inicial: 28,
    },
    readings: [],
    now: new Date('2026-06-21T13:01:00.000Z'),
  });

  const expectedForecastAt = calculateExpectedForecastAt(batchStartedAt, 28);

  assert.equal(forecast.status, 'forecast');
  assert.equal(forecast.averageMoisture, 28);
  assert.equal(forecast.lastMeasuredAt.toISOString(), batchStartedAt.toISOString());
  assert.equal(forecast.forecastAt.toISOString(), expectedForecastAt.toISOString());
});

test('preenche o período anterior ao início da batelada com a umidade inicial na média de 1h45min', () => {
  const batchStartedAt = new Date('2026-06-21T13:00:00.000Z');
  const lastMeasuredAt = new Date('2026-06-21T13:15:00.000Z');
  const forecast = calculateDischargeForecast({
    batch: {
      started_at: batchStartedAt,
      target_moisture: 14.5,
      umidade_inicial: 28,
    },
    readings: [
      {
        measured_at: lastMeasuredAt,
        moisture_percent: 20,
      },
    ],
    now: new Date('2026-06-21T13:16:00.000Z'),
  });

  const expectedAverage = ((90 * 28) + (15 * ((28 + 20) / 2))) / 105;
  const expectedForecastAt = calculateExpectedForecastAt(lastMeasuredAt, expectedAverage);

  assert.equal(forecast.status, 'forecast');
  assert.ok(Math.abs(forecast.averageMoisture - expectedAverage) < 0.0000001);
  assert.equal(forecast.lastMeasuredAt.toISOString(), lastMeasuredAt.toISOString());
  assert.equal(forecast.forecastAt.toISOString(), expectedForecastAt.toISOString());
});

test('calcula média pela interpolação das leituras reais da janela sem reinjetar umidade inicial no lookback', () => {
  const batchStartedAt = new Date('2026-06-21T10:00:00.000Z');
  const lastMeasuredAt = new Date('2026-06-21T13:45:00.000Z');
  const forecast = calculateDischargeForecast({
    batch: {
      started_at: batchStartedAt,
      target_moisture: 14.5,
      umidade_inicial: 30,
    },
    readings: [
      {
        measured_at: new Date('2026-06-21T12:30:00.000Z'),
        moisture_percent: 18,
      },
      {
        measured_at: new Date('2026-06-21T13:00:00.000Z'),
        moisture_percent: 16,
      },
      {
        measured_at: new Date('2026-06-21T13:30:00.000Z'),
        moisture_percent: 15,
      },
      {
        measured_at: lastMeasuredAt,
        moisture_percent: 14,
      },
    ],
    now: new Date('2026-06-21T13:46:00.000Z'),
  });

  const interpolatedMoistureAtLookbackStart = 20.4;
  const expectedAverage = (
    (30 * ((interpolatedMoistureAtLookbackStart + 18) / 2))
    + (30 * ((18 + 16) / 2))
    + (30 * ((16 + 15) / 2))
    + (15 * ((15 + 14) / 2))
  ) / 105;
  const averageWithReinjectedInitialMoisture = (
    (30 * ((30 + 18) / 2))
    + (30 * ((18 + 16) / 2))
    + (30 * ((16 + 15) / 2))
    + (15 * ((15 + 14) / 2))
  ) / 105;
  const expectedForecastAt = calculateExpectedForecastAt(lastMeasuredAt, expectedAverage);

  assert.equal(forecast.status, 'forecast');
  assert.ok(Math.abs(forecast.averageMoisture - expectedAverage) < 0.0000001);
  assert.notEqual(forecast.averageMoisture, averageWithReinjectedInitialMoisture);
  assert.equal(forecast.lastMeasuredAt.toISOString(), lastMeasuredAt.toISOString());
  assert.equal(forecast.forecastAt.toISOString(), expectedForecastAt.toISOString());
});

test('mantém a umidade inicial antes da primeira medição real da batelada', () => {
  const batchStartedAt = new Date('2026-06-21T13:00:00.000Z');
  const lastMeasuredAt = new Date('2026-06-21T13:30:00.000Z');
  const forecast = calculateDischargeForecast({
    batch: {
      started_at: batchStartedAt,
      target_moisture: 14.5,
      umidade_inicial: 30,
    },
    readings: [
      {
        measured_at: lastMeasuredAt,
        moisture_percent: 18,
      },
    ],
    now: new Date('2026-06-21T13:31:00.000Z'),
  });

  const expectedAverage = ((75 * 30) + (30 * ((30 + 18) / 2))) / 105;
  const expectedForecastAt = calculateExpectedForecastAt(lastMeasuredAt, expectedAverage);

  assert.equal(forecast.status, 'forecast');
  assert.ok(Math.abs(forecast.averageMoisture - expectedAverage) < 0.0000001);
  assert.equal(forecast.lastMeasuredAt.toISOString(), lastMeasuredAt.toISOString());
  assert.equal(forecast.forecastAt.toISOString(), expectedForecastAt.toISOString());
});

test('calcula umidade média por integral com interpolação no período informado', () => {
  const periodStart = new Date('2026-06-21T14:00:00.000Z').getTime();
  const periodEnd = new Date('2026-06-21T15:00:00.000Z').getTime();
  const averageMoisture = calculateAverageMoisture({
    readings: [
      {
        measured_at: '2026-06-21T13:30:00.000Z',
        moisture_percent: 20,
      },
      {
        measured_at: '2026-06-21T14:30:00.000Z',
        moisture_percent: 16,
      },
      {
        measured_at: '2026-06-21T15:30:00.000Z',
        moisture_percent: 14,
      },
    ],
    periodStart,
    periodEnd,
  });

  assert.ok(Math.abs(averageMoisture - 16.25) < 0.0000001);
});
