const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calculateAverageMoisture,
  calculateDischargeForecast,
  calculateMinutesRemainingFromAverageMoisture,
} = require('../routes/dryer-forecast');

test('calcula previsão antes da primeira medição usando umidade inicial e início da batelada', () => {
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

  assert.equal(forecast.status, 'forecast');
  assert.equal(forecast.averageMoisture, 28);
  assert.equal(forecast.lastMeasuredAt, null);
  assert.equal(forecast.forecastAt.toISOString(), '2026-06-21T20:37:36.870Z');
});


test('marca descarga imediata quando o horário atual é igual à previsão', () => {
  const forecast = calculateDischargeForecast({
    batch: {
      started_at: '2026-07-10T12:00:00.000Z',
      target_moisture: '14',
      umidade_inicial: '20',
    },
    readings: [],
    now: '2026-07-10T13:40:00.000Z',
    curveSettings: {
      discharge_forecast_quadratic_coefficient: 0,
      discharge_forecast_linear_coefficient: 10,
      discharge_forecast_initial_moisture_quadratic_coefficient: 0,
      discharge_forecast_initial_moisture_linear_coefficient: 0,
      discharge_forecast_constant_coefficient: -100,
    },
  });

  assert.equal(forecast.status, 'immediate');
  assert.equal(forecast.forecastAt.toISOString(), '2026-07-10T13:40:00.000Z');
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

  assert.equal(forecast.status, 'forecast');
  assert.ok(Math.abs(forecast.averageMoisture - expectedAverage) < 0.0000001);
  assert.equal(forecast.forecastAt.toISOString(), '2026-06-21T20:41:21.582Z');
});

test('calcula previsão pela curva quadrática de umidade média', () => {
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
  assert.equal(forecast.forecastAt.toISOString(), '2026-07-09T10:43:57.279Z');
});


test('aplica a equação diretamente à umidade média e à umidade inicial', () => {
  assert.ok(Math.abs(calculateMinutesRemainingFromAverageMoisture(29.5, 14, 28) - 512.136875) < 0.000001);
  assert.ok(Math.abs(calculateMinutesRemainingFromAverageMoisture(35, 14, 28) - 539.8324) < 0.000001);
  assert.ok(Math.abs(calculateMinutesRemainingFromAverageMoisture(40, 14, 28) - 480.1649) < 0.000001);
});

test('aplica correção de umidade alvo aos minutos restantes da curva', () => {
  const commonReadings = [
    { measured_at: '2026-07-09T01:00:00.000Z', moisture_percent: 25 },
  ];

  const forecastWithLowerTarget = calculateDischargeForecast({
    batch: {
      started_at: '2026-07-09T00:00:00.000Z',
      target_moisture: 12.5,
      umidade_inicial: 25,
    },
    readings: commonReadings,
    now: '2026-07-09T01:00:00.000Z',
  });
  const forecastWithHigherTarget = calculateDischargeForecast({
    batch: {
      started_at: '2026-07-09T00:00:00.000Z',
      target_moisture: 18.5,
      umidade_inicial: 25,
    },
    readings: commonReadings,
    now: '2026-07-09T01:00:00.000Z',
  });

  assert.ok(Math.abs(calculateMinutesRemainingFromAverageMoisture(24.55, 14, 25) - 396.23018975) < 0.0000001);
  assert.equal(calculateMinutesRemainingFromAverageMoisture(15.2, 14, 25), 0);
  assert.equal(forecastWithLowerTarget.status, 'forecast');
  assert.equal(forecastWithHigherTarget.status, 'forecast');
  assert.equal(forecastWithLowerTarget.forecastAt.toISOString(), '2026-07-09T09:19:22.110Z');
  assert.equal(forecastWithHigherTarget.forecastAt.toISOString(), '2026-07-09T03:19:22.110Z');
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

test('usa parâmetros customizados da curva de previsão quando informados', () => {
  assert.equal(
    calculateMinutesRemainingFromAverageMoisture(20, 14, 20, {
      discharge_forecast_quadratic_coefficient: 0,
      discharge_forecast_linear_coefficient: 10,
      discharge_forecast_initial_moisture_quadratic_coefficient: 0,
      discharge_forecast_initial_moisture_linear_coefficient: 0,
      discharge_forecast_constant_coefficient: -100,
    }),
    100,
  );
});

test('mantém coeficientes padrão como fallback quando parâmetros da curva são nulos', () => {
  assert.equal(
    calculateMinutesRemainingFromAverageMoisture(35, undefined, 28, {
      discharge_forecast_quadratic_coefficient: null,
      discharge_forecast_linear_coefficient: null,
      discharge_forecast_constant_coefficient: null,
    }),
    calculateMinutesRemainingFromAverageMoisture(35, 14, 28),
  );
});
