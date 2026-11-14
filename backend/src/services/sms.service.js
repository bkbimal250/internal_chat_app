export const SMS_API_URL =
  'https://www.hilitemultimedia.co.in/websms/api/http/index.php';

export const DEFAULT_OTP_SMS_TEMPLATE =
  'Dear Customer, your Code for login to {brand} is {code}. This Code is valid for {minutes} minutes. Do not share this OTP with anyone. Thank You';

export function otpValidityMinutes(ttlSeconds) {
  return Math.max(1, Math.round(Number(ttlSeconds || 60) / 60));
}

export function otpSmsMessage(code, config = {}) {
  const template = config.smsOtpTemplate || DEFAULT_OTP_SMS_TEMPLATE;
  return template
    .replaceAll('{brand}', config.smsBrand || 'Spa Advisor')
    .replaceAll('{code}', String(code ?? ''))
    .replaceAll('{minutes}', String(otpValidityMinutes(config.otpTtlSeconds)));
}

export function toSmsMobile(phoneE164) {
  return String(phoneE164 || '').replace(/^\+/, '');
}

export function buildOtpSmsUrl(config, phoneE164, code) {
  const query = new URLSearchParams({
    username: config.smsUsername,
    apikey: config.smsApiKey,
    apirequest: 'Text',
    route: config.smsRoute,
    TemplateID: config.smsTemplateId,
    sender: config.smsSender,
    mobile: toSmsMobile(phoneE164),
  });
  return `${config.smsApiUrl}?${query.toString()}&message=${encodeURIComponent(otpSmsMessage(code, config))}`;
}

function providerRejected(body) {
  const text = String(body || '').trim();
  if (!text) return false;
  try {
    const json = JSON.parse(text);
    const status = String(json.status ?? json.Status ?? json.type ?? '').toLowerCase();
    if (status) return !['success', 'ok', 'sent'].includes(status);
  } catch {
    /* gateway may return a plain-text status */
  }
  return /fail|error|invalid|unauthor/i.test(text) && !/success/i.test(text);
}

export function classifySmsFailure(error) {
  const name = error?.name || '';
  const message = String(error?.message || '');
  const tlsCode = String(error?.cause?.code || error?.code || '');
  if (
    /CERT|UNABLE_TO_VERIFY|SELF_SIGNED|TLS/i.test(tlsCode) ||
    /certificate|tls/i.test(String(error?.cause?.message || ''))
  ) {
    return 'tls_error';
  }
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(message)) {
    return 'timeout';
  }
  return 'network_error';
}

function dispatchError(message, outcome, cause) {
  const error = new Error(message, { cause });
  error.smsFailure = outcome;
  return error;
}

export function smsService(config, defaultLogger, fetchImpl = fetch) {
  const enabled = Boolean(config.smsUsername && config.smsApiKey && config.smsTemplateId);
  return {
    enabled,
    async sendOtp(phoneE164, code, logger = defaultLogger) {
      if (!enabled) {
        logger?.warn({ event: 'SMS_UNCONFIGURED' }, 'SMS provider credentials are missing');
        return { delivered: false, outcome: 'unconfigured' };
      }
      if (config.nodeEnv === 'test') {
        logger?.info({ event: 'SMS_SKIPPED_TEST' }, 'OTP SMS skipped in automated tests');
        return { delivered: false, outcome: 'skipped_test' };
      }
      logger?.info({ event: 'SMS_PROVIDER_ATTEMPTED' }, 'SMS provider request attempted');
      let response;
      try {
        response = await fetchImpl(buildOtpSmsUrl(config, phoneE164, code), {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        const outcome = classifySmsFailure(error);
        logger?.warn(
          {
            event:
              outcome === 'timeout'
                ? 'SMS_TIMEOUT'
                : outcome === 'tls_error'
                  ? 'SMS_TLS_ERROR'
                  : 'SMS_NETWORK_ERROR',
            outcome,
          },
          'SMS provider request failed',
        );
        throw dispatchError('SMS provider request failed', outcome, error);
      }
      let body;
      try {
        body = await response.text();
      } catch {
        body = '';
      }
      if (!response.ok || providerRejected(body)) {
        logger?.warn(
          {
            event: 'SMS_PROVIDER_REJECTED',
            outcome: 'rejected',
            httpStatus: response.status,
          },
          'SMS provider rejected request',
        );
        throw dispatchError('SMS provider rejected the request', 'provider_rejected');
      }
      logger?.info(
        {
          event: 'SMS_PROVIDER_ACCEPTED',
          outcome: 'accepted',
          httpStatus: response.status,
        },
        'SMS provider accepted request',
      );
      return { delivered: true, outcome: 'accepted' };
    },
  };
}
