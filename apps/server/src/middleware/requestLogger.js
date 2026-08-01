/**
 * Log one structured completion record without request bodies or credentials.
 *
 * @param {object} input
 * @param {object} input.logger
 */
export function createRequestLogger({ logger }) {
  return function requestLogger(request, response, next) {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const productId = request.validated?.params?.productId ?? request.params?.productId;

      logger.info(
        {
          durationMs: Math.round(durationMs * 10) / 10,
          method: request.method,
          path: request.path,
          productId,
          requestId: request.requestId,
          statusCode: response.statusCode,
        },
        'Request completed',
      );
    });

    next();
  };
}
