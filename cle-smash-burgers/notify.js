// Order/catering confirmations — SMS via Twilio, email via Resend, both
// called directly over REST with fetch (no SDKs to npm-install). Until you
// set the env vars below, both functions just log to the console so you
// can see exactly what would have been sent.

function smsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendSMS(to, body) {
  if (!smsConfigured()) {
    console.log(`[DEV] Would text ${to}:\n  ${body}`);
    return { simulated: true };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body });

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Twilio error:", data.message || data);
      return { simulated: false, error: data.message };
    }
    return { simulated: false, sid: data.sid };
  } catch (e) {
    console.error("Twilio request failed:", e.message);
    return { simulated: false, error: e.message };
  }
}

async function sendEmail(to, subject, html) {
  if (!emailConfigured()) {
    console.log(`[DEV] Would email ${to} — "${subject}"`);
    return { simulated: true };
  }
  const from = process.env.RESEND_FROM_EMAIL || "orders@clesmashburgers.com";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Resend error:", data.message || data);
      return { simulated: false, error: data.message };
    }
    return { simulated: false, id: data.id };
  } catch (e) {
    console.error("Resend request failed:", e.message);
    return { simulated: false, error: e.message };
  }
}

module.exports = { sendSMS, sendEmail, smsConfigured, emailConfigured };
