import twilio from 'twilio';

export function smsService(config, logger) {
  const enabled = Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber);
  const client = enabled ? twilio(config.twilioAccountSid, config.twilioAuthToken) : null;
  return {
    enabled,
    async sendOtp(phoneE164, code) {
      if (!enabled || config.nodeEnv === 'test') {
        logger?.info({ code: 'OTP_DISPATCH_SKIPPED' }, 'OTP SMS skipped; provider is not configured');
        return { delivered: false };
      }
      await client.messages.create({
        to: phoneE164,
        from: config.twilioFromNumber,
        body: `Your Company Chat code is ${code}. It expires in ${Math.max(1, Math.round(config.otpTtlSeconds / 60))} minutes.`,
      });
      return { delivered: true };
    },
  };
}
