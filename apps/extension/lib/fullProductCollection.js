function collectionError(result, fallbackMessage) {
  const error = new Error(result?.error ?? fallbackMessage);
  error.code = result?.errorCode ?? 'COLLECTION_REQUEST_FAILED';
  return error;
}

function successfulData(result, fallbackMessage) {
  if (result?.kind !== 'success' || result.body?.success !== true) {
    throw collectionError(result, fallbackMessage);
  }

  return result.body.data;
}

/** Queue and immediately start full variant-price collection for one product. */
export function createFullProductCollectionCoordinator({
  backendClient,
  backgroundCollection,
  store,
}) {
  return Object.freeze({
    async start(canonicalUrl) {
      const state = await store.load();
      const tracked = successfulData(
        await backendClient.trackProduct(state.settings, state.auth, canonicalUrl),
        'Unable to queue product tracking',
      );
      let job = tracked?.job ?? null;
      let product = tracked?.product ?? null;

      if (!job) {
        if (!Number.isSafeInteger(product?.id) || product.id <= 0) {
          throw collectionError(null, 'The backend returned no product or collection job');
        }

        const refreshed = successfulData(
          await backendClient.refreshProduct(state.settings, state.auth, product.id),
          'Unable to queue product price collection',
        );
        job = refreshed?.job ?? null;
        product = refreshed?.product ?? product;
      }

      if (!Number.isSafeInteger(job?.id) || job.id <= 0) {
        throw collectionError(null, 'The backend returned an invalid collection job');
      }

      const collection = await backgroundCollection.pollNow(job.id);
      return { collection, job, product };
    },
  });
}
