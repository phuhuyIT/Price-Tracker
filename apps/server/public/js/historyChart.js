import { formatDateTime, formatVnd } from './dashboardFormatters.js';

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

function variantName(dataset) {
  return String(dataset.label ?? 'Variant').replace(/\s+\([^)]*\)$/u, '');
}

function chartDataset(dataset, index) {
  const color = COLORS[index % COLORS.length];
  const name = variantName(dataset);

  return {
    backgroundColor: color,
    borderColor: color,
    borderWidth: 2,
    data: dataset.data,
    label: name,
    pointHoverRadius: 5,
    pointRadius: 3,
    spanGaps: false,
    tension: 0.18,
    tooltipVariantName: name,
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
            backgroundColor: 'rgb(31 30 27 / 96%)',
            bodyColor: '#ffcfbf',
            bodyFont: {
              size: 14,
              weight: '700',
            },
            bodySpacing: 8,
            borderColor: 'rgb(255 255 255 / 14%)',
            borderWidth: 1,
            callbacks: {
              label(context) {
                return [context.dataset.tooltipVariantName ?? 'Variant', formatVnd(context.raw.y)];
              },
              title() {
                return '';
              },
            },
            caretPadding: 8,
            cornerRadius: 10,
            displayColors: false,
            filter(context) {
              return context.raw?.y !== null;
            },
            padding: 12,
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
