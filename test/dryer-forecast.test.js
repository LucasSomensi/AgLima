const assert = require('node:assert/strict');
const test = require('node:test');

const { calculateAverageMoisture, calculateDischargeForecast } = require('../routes/dryer-forecast');

test('não calcula previsão linear antes de haver pontos suficientes de tendência', () => {
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

  assert.equal(forecast.status, 'unavailable');
  assert.equal(forecast.averageMoisture, 28);
});

test('mantém a umidade inicial antes da primeira medição ao calcular a média real', () => {
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

  assert.equal(forecast.status, 'unavailable');
  assert.ok(Math.abs(forecast.averageMoisture - expectedAverage) < 0.0000001);
});

test('calcula previsão linear local com média real e 100 minutos de antecedência', () => {
  const readings = [
    ['2026-07-09T02:23:00.000Z', 27.0],
    ['2026-07-09T02:51:00.000Z', 25.8],
    ['2026-07-09T03:27:00.000Z', 24.5],
    ['2026-07-09T04:05:00.000Z', 23.0],
    ['2026-07-09T04:30:00.000Z', 22.0],
    ['2026-07-09T05:11:00.000Z', 22.3],
    ['2026-07-09T05:35:00.000Z', 23.1],
    ['2026-07-09T06:01:00.000Z', 19.8],
    ['2026-07-09T06:31:00.000Z', 19.7],
    ['2026-07-09T06:55:00.000Z', 19.7],
    ['2026-07-09T08:24:00.000Z', 16.8],
    ['2026-07-09T09:20:00.000Z', 17.6],
    ['2026-07-09T09:50:00.000Z', 16.0],
    ['2026-07-09T10:16:00.000Z', 14.0],
    ['2026-07-09T10:16:00.000Z', 14.0],
    ['2026-07-09T10:20:00.000Z', 14.0],
  ].map(([measured_at, moisture_percent]) => ({ measured_at, moisture_percent }));

  const forecast = calculateDischargeForecast({
    batch: {
      started_at: '2026-07-09T02:23:00.000Z',
      target_moisture: 14.5,
      umidade_inicial: 27,
    },
    readings,
    now: '2026-07-09T10:20:00.000Z',
  });

  assert.equal(forecast.status, 'forecast');
  assert.ok(Math.abs(forecast.averageMoisture - 16.452721088435375) < 0.0000001);
  assert.equal(forecast.lastMeasuredAt.toISOString(), '2026-07-09T10:20:00.000Z');
  assert.equal(forecast.forecastAt.toISOString(), '2026-07-09T10:37:15.453Z');
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
