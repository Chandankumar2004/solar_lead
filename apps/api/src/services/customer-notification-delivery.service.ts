import { randomUUID } from "crypto";
import { NotificationChannel } from "@prisma/client";
import { env } from "../config/env.js";
import { sendEmail } from "./email.service.js";
import { buildEmailUnsubscribeUrl } from "./customer-communication-preferences.service.js";

type DeliveryResult = {
  provider: string;
  providerMessageId: string;
};

type SmsInput = {
  to: string;
  body: string;
  metadata?: Record<string, unknown>;
};

type EmailInput = {
  to: string;
  subject: string;
  body: string;
  unsubscribeUrl?: string | null;
  metadata?: Record<string, unknown>;
};

type WhatsappInput = {
  to: string;
  body: string;
  metadata?: Record<string, unknown>;
};

interface SmsProviderAdapter {
  provider: "console" | "msg91";
  send(input: SmsInput): Promise<DeliveryResult>;
}

interface EmailProviderAdapter {
  provider: "console" | "sendgrid" | "ses" | "resend";
  send(input: EmailInput): Promise<DeliveryResult>;
}

interface WhatsappProviderAdapter {
  provider: "console" | "twilio" | "interakt" | "wati";
  send(input: WhatsappInput): Promise<DeliveryResult>;
}

class ConsoleSmsProvider implements SmsProviderAdapter {
  provider: SmsProviderAdapter["provider"] = "console";

  async send(input: SmsInput) {
    const providerMessageId = `sms-console-${randomUUID()}`;
    console.info("[sms:console]", {
      providerMessageId,
      to: input.to,
      body: input.body,
      metadata: input.metadata ?? {}
    });
    return {
      provider: this.provider,
      providerMessageId
    };
  }
}

class Msg91SmsProvider implements SmsProviderAdapter {
  provider: SmsProviderAdapter["provider"] = "msg91";

  private normalizePhoneForMsg91(rawPhone: string) {
    const digits = rawPhone.replace(/\D/g, "");
    if (!digits) {
      throw new Error("Invalid phone number for SMS");
    }

    if (digits.length === 10) {
      return digits;
    }

    if (digits.length === 12 && digits.startsWith("91")) {
      return digits.slice(2);
    }

    if (digits.length === 11 && digits.startsWith("0")) {
      return digits.slice(1);
    }

    throw new Error("Phone number must be a valid 10-digit Indian mobile number");
  }

  async send(input: SmsInput) {
    if (!env.MSG91_AUTH_KEY || !env.MSG91_SENDER_ID) {
      throw new Error("MSG91 provider selected but credentials are missing");
    }

    const localMobile = this.normalizePhoneForMsg91(input.to);

    const payload: Record<string, unknown> = {
      sender: env.MSG91_SENDER_ID,
      route: env.MSG91_ROUTE,
      country: env.MSG91_COUNTRY,
      sms: [
        {
          message: input.body,
          to: [localMobile]
        }
      ]
    };

    if (env.MSG91_TEMPLATE_ID) {
      payload.DLT_TE_ID = env.MSG91_TEMPLATE_ID;
    }
    if (env.MSG91_ENTITY_ID) {
      payload.DLT_PE_ID = env.MSG91_ENTITY_ID;
    }

    const response = await fetch("https://api.msg91.com/api/v2/sendsms", {
      method: "POST",
      headers: {
        authkey: env.MSG91_AUTH_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const failureMessage =
        String(parsedBody?.message ?? parsedBody?.type ?? "").trim() || rawBody || "Unknown error";
      throw new Error(
        `MSG91 request failed (${response.status}): ${failureMessage}`
      );
    }

    const providerMessageId = String(
      parsedBody?.request_id ??
        parsedBody?.requestId ??
        parsedBody?.messageId ??
        parsedBody?.message_id ??
        `msg91-${randomUUID()}`
    );

    console.info("[sms:msg91]", {
      providerMessageId,
      to: localMobile,
      hasTemplateId: Boolean(env.MSG91_TEMPLATE_ID),
      hasEntityId: Boolean(env.MSG91_ENTITY_ID)
    });

    return {
      provider: this.provider,
      providerMessageId
    };
  }
}

class ConsoleEmailProvider implements EmailProviderAdapter {
  provider: EmailProviderAdapter["provider"] = "console";

  async send(input: EmailInput) {
    const email = await sendEmail({
      to: input.to,
      subject: input.subject,
      text: buildCustomerEmailText(input.body, input.unsubscribeUrl),
      html: buildCustomerEmailHtml(input.body, input.unsubscribeUrl),
      metadata: input.metadata,
      tags: ["customer_notification"]
    });
    if (!email) {
      throw new Error("Email send failed using console provider");
    }

    return {
      provider: email.provider,
      providerMessageId: email.messageId
    };
  }
}

class SendGridEmailProvider implements EmailProviderAdapter {
  provider: EmailProviderAdapter["provider"] = "sendgrid";

  async send(input: EmailInput) {
    const email = await sendEmail({
      to: input.to,
      subject: input.subject,
      text: buildCustomerEmailText(input.body, input.unsubscribeUrl),
      html: buildCustomerEmailHtml(input.body, input.unsubscribeUrl),
      metadata: input.metadata,
      tags: ["customer_notification", "sendgrid"]
    });
    if (!email) {
      throw new Error("Email send failed using SendGrid provider");
    }

    return {
      provider: email.provider,
      providerMessageId: email.messageId
    };
  }
}

class SesEmailProvider implements EmailProviderAdapter {
  provider: EmailProviderAdapter["provider"] = "ses";

  async send(input: EmailInput) {
    const email = await sendEmail({
      to: input.to,
      subject: input.subject,
      text: buildCustomerEmailText(input.body, input.unsubscribeUrl),
      html: buildCustomerEmailHtml(input.body, input.unsubscribeUrl),
      metadata: input.metadata,
      tags: ["customer_notification", "ses"]
    });
    if (!email) {
      throw new Error("Email send failed using SES provider");
    }

    return {
      provider: email.provider,
      providerMessageId: email.messageId
    };
  }
}

class ResendEmailProvider implements EmailProviderAdapter {
  provider: EmailProviderAdapter["provider"] = "resend";

  async send(input: EmailInput) {
    const email = await sendEmail({
      to: input.to,
      subject: input.subject,
      text: buildCustomerEmailText(input.body, input.unsubscribeUrl),
      html: buildCustomerEmailHtml(input.body, input.unsubscribeUrl),
      metadata: input.metadata,
      tags: ["customer_notification", "resend"]
    });
    if (!email) {
      throw new Error("Email send failed using Resend provider");
    }

    return {
      provider: email.provider,
      providerMessageId: email.messageId
    };
  }
}

class ConsoleWhatsappProvider implements WhatsappProviderAdapter {
  provider: WhatsappProviderAdapter["provider"] = "console";

  async send(input: WhatsappInput) {
    const providerMessageId = `wa-console-${randomUUID()}`;
    console.info("[whatsapp:console]", {
      providerMessageId,
      to: input.to,
      body: input.body,
      metadata: input.metadata ?? {}
    });
    return {
      provider: this.provider,
      providerMessageId
    };
  }
}

class TwilioWhatsappProvider implements WhatsappProviderAdapter {
  provider: WhatsappProviderAdapter["provider"] = "twilio";

  private normalizeFrom() {
    const raw = (env.TWILIO_WHATSAPP_FROM ?? "").trim();
    if (!raw) {
      throw new Error("TWILIO_WHATSAPP_FROM is required for Twilio WhatsApp provider");
    }
    return raw.startsWith("whatsapp:") ? raw : `whatsapp:${raw}`;
  }

  private normalizeTo(rawPhone: string) {
    const trimmed = rawPhone.trim();
    if (!trimmed) {
      throw new Error("Invalid WhatsApp recipient");
    }

    if (trimmed.startsWith("whatsapp:+")) {
      return trimmed;
    }

    const digits = trimmed.replace(/\D/g, "");
    if (!digits) {
      throw new Error("Invalid WhatsApp recipient");
    }

    if (digits.length === 10) {
      return `whatsapp:+91${digits}`;
    }
    if (digits.length === 12 && digits.startsWith("91")) {
      return `whatsapp:+${digits}`;
    }
    if (digits.length >= 11 && digits.startsWith("0")) {
      return `whatsapp:+91${digits.slice(1)}`;
    }
    if (digits.startsWith("91")) {
      return `whatsapp:+${digits}`;
    }
    return `whatsapp:+${digits}`;
  }

  async send(input: WhatsappInput) {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
      throw new Error("Twilio WhatsApp provider selected but credentials are missing");
    }

    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const authToken = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
      "utf-8"
    ).toString("base64");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        From: this.normalizeFrom(),
        To: this.normalizeTo(input.to),
        Body: input.body
      }).toString()
    });

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const message =
        String(parsedBody?.message ?? parsedBody?.error ?? "").trim() ||
        rawBody ||
        "Unknown Twilio error";
      throw new Error(`Twilio WhatsApp request failed (${response.status}): ${message}`);
    }

    const providerMessageId = String(parsedBody?.sid ?? `twilio-${randomUUID()}`);
    return {
      provider: this.provider,
      providerMessageId
    };
  }
}

class InteraktWhatsappProvider implements WhatsappProviderAdapter {
  provider: WhatsappProviderAdapter["provider"] = "interakt";

  async send(input: WhatsappInput) {
    if (!env.INTERAKT_API_KEY) {
      throw new Error("Interakt provider selected but API key is missing");
    }

    const providerMessageId = `interakt-${randomUUID()}`;
    // Placeholder integration: wire Interakt HTTP API client here.
    console.info("[whatsapp:interakt-placeholder]", {
      providerMessageId,
      hasApiKey: Boolean(env.INTERAKT_API_KEY),
      to: input.to
    });
    return {
      provider: this.provider,
      providerMessageId
    };
  }
}

class WatiWhatsappProvider implements WhatsappProviderAdapter {
  provider: WhatsappProviderAdapter["provider"] = "wati";

  async send(input: WhatsappInput) {
    if (!env.WATI_API_KEY) {
      throw new Error("WATI provider selected but API key is missing");
    }

    const providerMessageId = `wati-${randomUUID()}`;
    // Placeholder integration: wire WATI HTTP API client here.
    console.info("[whatsapp:wati-placeholder]", {
      providerMessageId,
      hasApiKey: Boolean(env.WATI_API_KEY),
      to: input.to
    });
    return {
      provider: this.provider,
      providerMessageId
    };
  }
}

function resolveSmsProvider(): SmsProviderAdapter {
  if (env.SMS_PROVIDER === "msg91") {
    return new Msg91SmsProvider();
  }
  return new ConsoleSmsProvider();
}

function resolveEmailProvider(): EmailProviderAdapter {
  if (env.EMAIL_PROVIDER === "sendgrid") {
    return new SendGridEmailProvider();
  }
  if (env.EMAIL_PROVIDER === "resend") {
    return new ResendEmailProvider();
  }
  if (env.EMAIL_PROVIDER === "ses") {
    return new SesEmailProvider();
  }
  return new ConsoleEmailProvider();
}

function resolveWhatsappProvider(): WhatsappProviderAdapter {
  if (env.WHATSAPP_PROVIDER === "twilio") {
    return new TwilioWhatsappProvider();
  }
  if (env.WHATSAPP_PROVIDER === "interakt") {
    return new InteraktWhatsappProvider();
  }
  if (env.WHATSAPP_PROVIDER === "wati") {
    return new WatiWhatsappProvider();
  }
  return new ConsoleWhatsappProvider();
}

const smsProvider = resolveSmsProvider();
const emailProvider = resolveEmailProvider();
const whatsappProvider = resolveWhatsappProvider();

export type CustomerDeliveryInput = {
  channel: NotificationChannel;
  recipient: string;
  subject?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCustomerEmailHtml(body: string, unsubscribeUrl?: string | null) {
  const brandName = env.CUSTOMER_NOTIFICATION_BRAND_NAME ?? "Solar Admin";
  const escapedBody = escapeHtml(body).replace(/\r?\n/g, "<br />");
  const unsubscribeHtml = unsubscribeUrl
    ? `<p style="margin-top:20px;font-size:12px;color:#6b7280">To manage notifications, <a href="${escapeHtml(unsubscribeUrl)}" target="_blank" rel="noreferrer">unsubscribe here</a>.</p>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
      <h2 style="margin:0 0 12px 0;font-size:18px;color:#0f172a;">${escapeHtml(brandName)} Update</h2>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#1e293b;">${escapedBody}</p>
      ${unsubscribeHtml}
    </div>
  </body>
</html>`;
}

function buildCustomerEmailText(body: string, unsubscribeUrl?: string | null) {
  if (!unsubscribeUrl) return body;
  return `${body}\n\nManage notifications: ${unsubscribeUrl}`;
}

export async function sendCustomerNotification(
  input: CustomerDeliveryInput
): Promise<DeliveryResult> {
  if (input.channel === "SMS") {
    return smsProvider.send({
      to: input.recipient,
      body: input.body,
      metadata: input.metadata
    });
  }

  if (input.channel === "EMAIL") {
    const metadataLeadId =
      input.metadata && typeof input.metadata.leadId === "string"
        ? input.metadata.leadId
        : null;
    const unsubscribeUrl = metadataLeadId
      ? buildEmailUnsubscribeUrl({
          leadId: metadataLeadId,
          recipient: input.recipient
        })
      : env.CUSTOMER_NOTIFICATIONS_UNSUBSCRIBE_URL?.trim() ?? null;

    return emailProvider.send({
      to: input.recipient,
      subject: input.subject || "Solar Lead Update",
      body: input.body,
      unsubscribeUrl,
      metadata: input.metadata
    });
  }

  if (input.channel === "WHATSAPP") {
    return whatsappProvider.send({
      to: input.recipient,
      body: input.body,
      metadata: input.metadata
    });
  }

  throw new Error(`Unsupported customer notification channel: ${input.channel}`);
}
