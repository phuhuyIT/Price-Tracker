import {
  contextLabel,
  formatDateTime,
  formatVnd,
  priceSourceLabel,
  voucherLabel,
} from './dashboardFormatters.js';

const COLORS = Object.freeze([
  '#ee4d2d',
  '#246b8e',
  '#18845a',
  '#8e5a9f',
  '#b67912',
  '#c13d72',
  '#4d6fc4',
  '#69713a',
]);

function contextSuffix(dataset) {
  const key = dataset.pricingContextKey;
  const shortKey = typeof key === 'string' && key.length > 8 ? ` · …${key.slice(-6)}` : '';
  return `${contextLabel(dataset.pricingContext)}${shortKey}`;
}

function variantName(dataset) {
  return String(dataset.label ?? 'Variant').replace(/\s+\([^)]*\)$/u, '');
}

function chartDataset(dataset, index) {
  const color = COLORS[index % COLORS.length];

  return {
    backgroundColor: color,
    borderColor: color,
    borderWidth: 2,
    data: dataset.data,
    label: `${variantName(dataset)} · ${contextSuffix(dataset)}`,
    pointHoverRadius: 5,
    pointRadius: 3,
    spanGaps: false,
    tension: 0.18,
  };
}

/** Own one Chart.js instance and always destroy it before replacement. */
export function createHistoryChartController({ canvas, ChartConstructor = window.Chart }) {
  let chart = null;

  function destroy() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  function render(history) {
    destroy();

    if (typeof ChartConstructor !== 'function') {
      throw new Error('The local Chart.js bundle did not load.');
    }

    chart = new ChartConstructor(canvas, {
      data: {
        datasets: history.datasets.map(chartDataset),
      },
      options: {
        interaction: {
          intersect: false,
          mode: 'nearest',
        },
        maintainAspectRatio: false,
        parsing: false,
        plugins: {
          legend: {
            labels: {
              boxHeight: 8,
              boxWidth: 20,
              usePointStyle: true,
            },
            position: 'bottom',
          },
          tooltip: {
            callbacks: {
              afterLabel(context) {
                const point = context.raw;
                return [
                  `Source: ${priceSourceLabel(point.priceSource)}`,
                  `Voucher: ${voucherLabel(point.voucherStatus)}`,
                  `Availability: ${point.availability ?? 'unknown'}`,
                ];
              },
              label(context) {
                return context.raw.y === null
                  ? `${context.dataset.label}: not observed`
                  : `${context.dataset.label}: ${formatVnd(context.raw.y)}`;
              },
              title(items) {
                return items[0]?.raw?.x ? formatDateTime(items[0].raw.x) : '';
              },
            },
          },
        },
        responsive: true,
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              callback(value) {
                return formatDateTime(this.getLabelForValue(value));
              },
              maxRotation: 0,
              maxTicksLimit: 7,
            },
            type: 'category',
          },
          y: {
            beginAtZero: false,
            ticks: {
              callback(value) {
                return formatVnd(Number(value));
              },
            },
          },
        },
      },
      type: 'line',
    });

    return chart;
  }

  return Object.freeze({ destroy, render });
}
