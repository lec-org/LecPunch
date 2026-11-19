import * as Joi from 'joi';
import * as ipaddr from 'ipaddr.js';

const csvToArray = (value?: string) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

const csvSchema = (
  validator: (value: string) => boolean,
  label: 'IP address' | 'CIDR'
) =>
  Joi.string()
    .allow('')
    .default('')
    .custom((value, helpers) => {
      const path = helpers.state.path?.join('.') ?? 'value';

      for (const item of csvToArray(value)) {
        if (!validator(item)) {
          return helpers.error('csv.invalid', {
            path,
            item,
            itemLabel: label
          });
        }
      }

      return value;
    })
    .messages({
      'csv.invalid': '{{#path}} contains an invalid {{#itemLabel}}: {{#item}}'
    });

const ipListSchema = csvSchema((value) => ipaddr.isValid(value), 'IP address');
const cidrListSchema = csvSchema((value) => {
  try {
    ipaddr.parseCIDR(value);
    return true;
  } catch {
    return false;
  }
}, 'CIDR');

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(4000),
  MONGODB_URI: Joi.string().uri().required(),
  LOGTO_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  LOGTO_API_RESOURCE: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  LOGTO_ORGANIZATION_ID: Joi.string().default('lec-studio'),
  AUTH_SECRET: Joi.string().min(16).required(),
  MEET_JWT_APP_ID: Joi.string().pattern(/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/).required(),
  MEET_JWT_SECRET: Joi.string().min(32).required(),
  LECPUNCH_TEAM_ID: Joi.string().pattern(/^[a-f\d]{24}$/i).allow('').optional(),
  DEFAULT_TEAM_NAME: Joi.string().default('FocusTeam'),
  ALLOW_OPEN_REGISTRATION: Joi.boolean().truthy('true').falsy('false').default(true),
  ATTENDANCE_BALANCED_ACCOUNTING_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  ALLOW_ANY_NETWORK: Joi.boolean().truthy('true').falsy('false').default(true),
  ALLOWED_PUBLIC_IPS: ipListSchema,
  ALLOWED_CIDRS: cidrListSchema,
  TRUST_PROXY: Joi.boolean().truthy('true').falsy('false').default(false),
  TRUSTED_PROXY_HOPS: Joi.number().min(1).default(1),
  REPORT_IMAGES_DIR: Joi.string().min(1).default('./data/report-images'),
  REPORT_IMAGE_RETENTION_HOURS: Joi.number().integer().min(1).max(24).default(3),
  REPORT_IMAGE_MAX_BYTES: Joi.number().integer().min(1_024).max(3 * 1024 * 1024).default(3 * 1024 * 1024),
  LEC_S3_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }).allow('').optional(),
  LEC_S3_BUCKET: Joi.string().allow('').optional(),
  LEC_S3_REGION: Joi.string().default('us-east-1'),
  LEC_S3_ACCESS_KEY: Joi.string().allow('').optional(),
  LEC_S3_SECRET_KEY: Joi.string().allow('').optional(),
  LEC_S3_CARD_ASSETS_PREFIX: Joi.string().default('punch/cards/20261027-v1'),
  LEC_S3_REPORT_IMAGES_PREFIX: Joi.string().default('punch/reports')
})
  .custom((value, helpers) => {
    const hasAllowedIps = csvToArray(value.ALLOWED_PUBLIC_IPS).length > 0;
    const hasAllowedCidrs = csvToArray(value.ALLOWED_CIDRS).length > 0;

    if (!value.ALLOW_ANY_NETWORK && !hasAllowedIps && !hasAllowedCidrs) {
      return helpers.error('network.allowlistRequired');
    }
    if (value.AUTH_SECRET === value.MEET_JWT_SECRET) {
      return helpers.error('secret.reused');
    }

    return value;
  })
  .messages({
    'network.allowlistRequired':
      'ALLOWED_PUBLIC_IPS or ALLOWED_CIDRS must be configured when ALLOW_ANY_NETWORK=false',
    'secret.reused': 'MEET_JWT_SECRET must differ from AUTH_SECRET'
  });
