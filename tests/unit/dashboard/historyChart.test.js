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
      ],
    };

    controller.render(history);
    const firstConfiguration = ChartConstructor.mock.calls[0][1];
    expect(firstConfiguration.data.datasets[0].data[1].y).toBeNull();
    expect(firstConfiguration.data.datasets[0].spanGaps).toBe(false);

    controller.render(history);
    expect(destroyFirst).toHaveBeenCalledOnce();
    controller.destroy();
    expect(destroySecond).toHaveBeenCalledOnce();
  });
});
