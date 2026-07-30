import { z } from 'zod';

export const isoTimestampSchema = z.string().datetime({ offset: true });

export const httpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Expected an HTTPS URL' },
  );

export const positiveSafeIntegerSchema = z.number().int().positive().safe();

export const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

export const positivePriceAmountSchema = positiveSafeIntegerSchema;

export const shopeeIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,29}$/u, 'Expected a positive numeric Shopee identifier');

export const pricingContextKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    'Context keys may contain only letters, numbers, dot, underscore, colon, and hyphen',
  );

export const reasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-z][a-z0-9_]*$/u, 'Expected a lowercase reason code');

export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const passwordSchema = z.string().superRefine((value, context) => {
  const characterCount = Array.from(value).length;

  if (characterCount < 15) {
    context.addIssue({
      code: z.ZodIssueCode.too_small,
      inclusive: true,
      message: 'Password must contain at least 15 characters',
      minimum: 15,
      type: 'string',
    });
  }

  if (characterCount > 128) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      inclusive: true,
      maximum: 128,
      message: 'Password must contain at most 128 characters',
      type: 'string',
    });
  }

  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });

  if (hasControlCharacter) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Password must not contain control characters',
    });
  }

  if (value.trim().length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Password must not contain only whitespace',
    });
  }
});

export const opaqueSessionTokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Expected an opaque base64url session token');
