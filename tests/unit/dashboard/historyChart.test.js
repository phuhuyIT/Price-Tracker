import { describe, expect, it, vi } from 'vitest';

import { createHistoryChartController } from '../../../apps/server/public/js/historyChart.js';

describe('history chart controller', () => {
  it('keeps null gaps and destroys the old chart before rendering another', () => {
    const destroyFirst = vi.fn();
    const destroySecond = vi.fn();
    const ChartConstructor = vi
      .fn()
      .mockImplementationOnce(() => ({ destroy: destroyFirst }))
      .mockImplementationOnce(() => ({ destroy: destroySecond }));
    const controller = createHistoryChartController({
      canvas: {},
      ChartConstructor,
    });
    const history = {
      datasets: [
        {
          data: [
            { x: '2026-08-08T01:00:00.000Z', y: 199_000 },
            { x: '2026-08-08T02:00:00.000Z', y: null },
          ],
          label: 'Default (user_session)',
          pricingContext: 'user_session',
          pricingContextKey: 'extension-profile-key',
        },
        {
          data: [{ x: '2026-08-08T01:00:00.000Z', y: 199_000 }],
          label: 'Large (user_session)',
          pricingContext: 'user_session',
          pricingContextKey: 'extension-profile-key',
        },
      ],
    };

    controller.render(history);
    const firstConfiguration = ChartConstructor.mock.calls[0][1];
    expect(firstConfiguration.data.datasets[0].data[1].y).toBeNull();
    expect(firstConfiguration.data.datasets[0].spanGaps).toBe(false);

    const tooltip = firstConfiguration.options.plugins.tooltip;
    const dataset = firstConfiguration.data.datasets[0];
    const overlappingDataset = firstConfiguration.data.datasets[1];
    const observedPoint = { dataset, raw: dataset.data[0] };
    const overlappingPoint = {
      dataset: overlappingDataset,
      raw: overlappingDataset.data[0],
    };
    const missingPoint = { dataset, raw: dataset.data[1] };

    expect(dataset.label).toBe('Default');
    expect(overlappingDataset.label).toBe('Large');
    expect(tooltip.callbacks.title([observedPoint, overlappingPoint])).toBe('');
    expect(tooltip.callbacks.label(observedPoint)).toEqual(['Default', '199.000\u00a0\u20ab']);
    expect(tooltip.callbacks.label(overlappingPoint)).toEqual(['Large', '199.000\u00a0\u20ab']);
    expect(tooltip.callbacks.afterLabel).toBeUndefined();
    expect(tooltip.displayColors).toBe(false);
    expect(tooltip.filter(observedPoint)).toBe(true);
    expect(tooltip.filter(missingPoint)).toBe(false);

    controller.render(history);
    expect(destroyFirst).toHaveBeenCalledOnce();
    controller.destroy();
    expect(destroySecond).toHaveBeenCalledOnce();
  });
});
