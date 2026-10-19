import * as Joi from 'joi';

// Project vars of API_SPEC 11 (PRD 8.12), concatenated onto baseEnvSchema
// by AppConfigModule.forProject(). Seed-only vars stay out of the boot schema.
export const projectEnvSchema = Joi.object({
  // Single public frontend URL used as the link inside emails (BR-68).
  APP_URL: Joi.string().uri().required(),
  // HMAC key for the QR join tokens (BR-19).
  JOIN_TOKEN_SECRET: Joi.string().min(32).required(),
  OTP_TTL_MINUTES: Joi.number().integer().min(1).max(60).default(10),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(0).default(60),
  // `console` refuses to start in production (skill rule 23).
  OTP_SENDER: Joi.string().valid('resend', 'console').default('resend'),
  RESEND_API_KEY: Joi.when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_FROM: Joi.when('OTP_SENDER', {
    is: 'resend',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  // Throttle window in seconds; the throttler receives it * 1000 ms (BR-80).
  THROTTLE_TTL: Joi.number().integer().min(1).default(60),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  AUTH_THROTTLE_LIMIT: Joi.number().integer().min(1).default(5),
  SEND_CODE_THROTTLE_LIMIT: Joi.number().integer().min(1).default(3),
  JOIN_THROTTLE_LIMIT: Joi.number().integer().min(1).default(10),
  SOS_THROTTLE_LIMIT: Joi.number().integer().min(1).default(5),
});
