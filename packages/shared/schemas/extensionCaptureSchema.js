import { z } from 'zod';

import {
  EXTENSION_CAPTURE_KINDS,
  EXTENSION_CAPTURE_MESSAGE_TYPE,
  EXTENSION_COLLECTION_STATUS_CODES,
  EXTENSION_COLLECTION_STATUS_MESSAGE_TYPE,
} from '../constants/extensionProtocol.js';
import { EXTENSION_MESSAGE_PROTOCOL_VERSION } from '../constants/contractValues.js';
import { SHOPEE_PRODUCT_ENDPOINTS } from '../constants/shopeeEndpoints.js';
import { isoTimestampSchema, positiveSafeIntegerSchema, shopeeIdSchema } from './commonSchemas.js';
import {
  availabilityStatusSchema,
  observedPriceSourceSchema,
  voucherStatusSchema,
} from './enumSchemas.js';

const [PRODUCT_DETAIL_ENDPOINT, SELECTED_VARIATION_ENDPOINT] = SHOPEE_PRODUCT_ENDPOINTS;

export const selectedTiersSchema = z
  .record(z.string().regex(/^\d+$/u), z.number().int().nonnegative().safe())
  .refine((value) => Object.keys(value).length > 0, 'At least one selected tier is required');

export const sanitisedPriceEvidenceSchema = z
  .object({
    modelId: shopeeIdSchema.nullable(),
    priceSource: observedPriceSourceSchema.nullable(),
    rawPrice: positiveSafeIntegerSchema.nullable(),
    voucherStatus: voucherStatusSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if ((evidence.rawPrice === null) !== (evidence.priceSource === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A raw price and its source must be present or absent together',
        path: ['priceSource'],
      });
    }
  });

const captureEnvelopeFields = {
  capturedAt: isoTimestampSchema,
  protocolVersion: z.literal(EXTENSION_MESSAGE_PROTOCOL_VERSION),
  type: z.literal(EXTENSION_CAPTURE_MESSAGE_TYPE),
};

export const extensionCollectionStatusSchema = z
  .object({
    capturedAt: isoTimestampSchema,
    code: z.enum(Object.values(EXTENSION_COLLECTION_STATUS_CODES)),
    protocolVersion: z.literal(EXTENSION_MESSAGE_PROTOCOL_VERSION),
    type: z.literal(EXTENSION_COLLECTION_STATUS_MESSAGE_TYPE),
  })
  .strict();

const productModelEvidenceSchema = z
  .object({
    availability: availabilityStatusSchema,
    modelId: shopeeIdSchema,
    name: z.string().max(300),
    tierIndex: z.array(z.number().int().nonnegative().safe()).max(20),
  })
  .strict();

const tierVariationEvidenceSchema = z
  .object({
    name: z.string().max(200),
    options: z.array(z.string().max(300)).max(1_000),
  })
  .strict();

export const productDetailCaptureSchema = z
  .object({
    ...captureEnvelopeFields,
    endpoint: z.literal(PRODUCT_DETAIL_ENDPOINT),
    kind: z.literal(EXTENSION_CAPTURE_KINDS.PRODUCT_DETAIL),
    priceEvidence: sanitisedPriceEvidenceSchema,
    product: z
      .object({
        currency: z.literal('VND'),
        image: z.string().max(2_048).nullable(),
        itemId: shopeeIdSchema,
        models: z.array(productModelEvidenceSchema).min(1).max(10_000),
        shopId: shopeeIdSchema,
        tierVariations: z.array(tierVariationEvidenceSchema).max(20),
        title: z.string().trim().min(1).max(500),
      })
      .strict(),
  })
  .strict();

export const selectedVariationCaptureSchema = z
  .object({
    ...captureEnvelopeFields,
    endpoint: z.literal(SELECTED_VARIATION_ENDPOINT),
    kind: z.literal(EXTENSION_CAPTURE_KINDS.SELECTED_VARIATION),
    priceEvidence: sanitisedPriceEvidenceSchema,
    request: z
      .object({
        itemId: shopeeIdSchema,
        quantity: z.number().int().positive().safe(),
        selectedTiers: selectedTiersSchema,
        shopId: shopeeIdSchema,
      })
      .strict(),
    response: z
      .object({
        errorCode: z.string().trim().min(1).max(96).nullable(),
        ok: z.boolean(),
        status: z.number().int().min(0).max(599).nullable(),
      })
      .strict(),
  })
  .strict();

export const extensionCaptureMessageSchema = z.discriminatedUnion('kind', [
  productDetailCaptureSchema,
  selectedVariationCaptureSchema,
]);
