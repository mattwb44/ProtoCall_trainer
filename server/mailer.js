// Transactional email via Resend's REST API (https://resend.com/docs/api-reference/emails).
// Env-gated: with no RESEND_API_KEY the mailer no-ops and logs the link, so local dev,
// tests, and a key-less prod boot all keep working. buildServer() accepts an injected
// mailer, so tests capture sends without a network call.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const shell = (heading, body, cta, link) => `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;padding:32px;color:#e2e8f0">
    <div style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:16px;padding:28px">
      <h1 style="margin:0 0 8px;font-size:18px;color:#fff">${heading}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#cbd5e1">${body}</p>
      <a href="${link}" style="display:inline-block;background:#e11d48;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:12px;font-size:14px">${cta}</a>
      <p style="margin:20px 0 0;font-size:12px;color:#64748b">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#94a3b8">${link}</span></p>
      <p style="margin:16px 0 0;font-size:12px;color:#64748b">If you didn't request this, you can ignore this email.</p>
    </div>
  </div>`;

export function createMailer({
  apiKey = process.env.RESEND_API_KEY,
  from = process.env.MAIL_FROM || 'ProtoCall Trainer <onboarding@resend.dev>',
} = {}) {
  async function send(to, subject, html) {
    if (!apiKey) {
      console.log(`[mail:dev] (no RESEND_API_KEY) would send "${subject}" to ${to}`);
      return { ok: false, skipped: true };
    }
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!res.ok) {
        console.error(`[mail] Resend ${res.status}: ${await res.text().catch(() => '')}`);
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      console.error('[mail] send failed:', e.message);
      return { ok: false };
    }
  }

  return {
    sendVerification: (to, name, link) =>
      send(to, 'Verify your ProtoCall Trainer email',
        shell(`Confirm your email, ${name}`,
          'Tap below to confirm this is your address so we can secure your account and reach you about your training sessions.',
          'Verify email', link)),
    sendReset: (to, name, link) =>
      send(to, 'Reset your ProtoCall Trainer password',
        shell(`Reset your password, ${name}`,
          'We received a request to reset your ProtoCall Trainer password. This link expires in one hour and can be used once.',
          'Choose a new password', link)),
  };
}
