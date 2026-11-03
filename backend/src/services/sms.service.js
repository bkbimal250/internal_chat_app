export const SMS_API_URL =
  'https://www.hilitemultimedia.co.in/websms/api/http/index.php';

export function otpSmsMessage(code) {
  return `Dear Customer, your Code for login to Spa Advisor is ${code}. This Code is valid for 1 minutes. Do not share this OTP with anyone. Thank You`;
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
  return `${config.smsApiUrl}?${query.toString()}&message=${encodeURIComponent(otpSmsMessage(code))}`;
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

export function smsService(config, logger, fetchImpl = fetch) {
  const enabled = Boolean(config.smsUsername && config.smsApiKey && config.smsTemplateId);
  return {
    enabled,
    async sendOtp(phoneE164, code) {
      if (!enabled || config.nodeEnv === 'test') {
        logger?.info({ code: 'OTP_DISPATCH_SKIPPED' }, 'OTP SMS skipped; provider is not configured');
        return { delivered: false };
      }
      const response = await fetchImpl(buildOtpSmsUrl(config, phoneE164, code), {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.text();
      if (!response.ok || providerRejected(body)) {
        throw new Error('SMS provider rejected the request');
      }
      logger?.info({ code: 'OTP_DISPATCHED' }, 'OTP SMS accepted by provider');
      return { delivered: true };
    },
  };
}
