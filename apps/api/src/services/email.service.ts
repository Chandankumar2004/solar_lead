import { env } from "../config/env.js";
import { UserRole, UserStatus } from "../types.js";

type EmailProviderKind = "console" | "sendgrid" | "ses" | "resend";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type EmailSendResult = {
  provider: EmailProviderKind;
  messageId: string;
};

interface EmailProvider {
  kind: EmailProviderKind;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

class ConsoleEmailProvider implements EmailProvider {
  kind: EmailProviderKind = "console";

  async send(message: EmailMessage) {
    const messageId = `dev-${Date.now()}`;
    console.info("[email:console]", {
      messageId,
      from: env.EMAIL_FROM,
      ...message
    });
    return {
      provider: this.kind,
      messageId
    };
  }
}

class SendGridEmailProvider implements EmailProvider {
  kind: EmailProviderKind = "sendgrid";

  async send(message: EmailMessage) {
    if (!env.SENDGRID_API_KEY) {
      throw new Error("SENDGRID_API_KEY is required when EMAIL_PROVIDER=sendgrid");
    }

    const metadata = Object.fromEntries(
      Object.entries(message.metadata ?? {}).map(([key, value]) => [key, String(value)])
    );

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: message.to }],
            subject: message.subject
          }
        ],
        from: {
          email: env.EMAIL_FROM
        },
        content: [
          {
            type: "text/plain",
            value: message.text
          },
          {
            type: "text/html",
            value: message.html ?? message.text
          }
        ],
        ...(message.tags?.length ? { categories: message.tags.slice(0, 10) } : {}),
        ...(Object.keys(metadata).length ? { custom_args: metadata } : {})
      })
    });

    const rawBody = await response.text();
    if (!response.ok) {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }
      const firstError =
        Array.isArray(parsed?.errors) && parsed?.errors.length
          ? (parsed.errors[0] as Record<string, unknown>)
          : null;
      const messageText =
        String(firstError?.message ?? "").trim() || rawBody || "Unknown SendGrid error";
      throw new Error(`SendGrid request failed (${response.status}): ${messageText}`);
    }

    const providerMessageId =
      response.headers.get("x-message-id") ??
      `sg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return {
      provider: this.kind,
      messageId: providerMessageId
    };
  }
}

class ResendEmailProvider implements EmailProvider {
  kind: EmailProviderKind = "resend";

  async send(message: EmailMessage) {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html ?? message.text,
        ...(message.tags?.length
          ? {
              tags: message.tags.slice(0, 10).map((tag) => ({
                name: "tag",
                value: tag
              }))
            }
          : {})
      })
    });

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const messageText =
        String(parsedBody?.message ?? parsedBody?.error ?? "").trim() ||
        rawBody ||
        "Unknown Resend error";
      throw new Error(`Resend request failed (${response.status}): ${messageText}`);
    }

    const providerMessageId =
      String(parsedBody?.id ?? "").trim() ||
      `resend-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return {
      provider: this.kind,
      messageId: providerMessageId
    };
  }
}

class SesEmailProvider implements EmailProvider {
  kind: EmailProviderKind = "ses";

  async send(message: EmailMessage) {
    // Placeholder integration: wire AWS SES SDK client here when SES setup is ready.
    console.info("[email:ses-placeholder]", {
      messageId: `ses-${Date.now()}`,
      from: env.EMAIL_FROM,
      region: env.SES_REGION ?? "not-configured",
      to: message.to,
      subject: message.subject
    });
    return {
      provider: this.kind,
      messageId: `ses-${Date.now()}`
    };
  }
}

function resolveEmailProvider(): EmailProvider {
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

const emailProvider = resolveEmailProvider();

function roleLabel(role: UserRole) {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "District Manager";
  return "Field Executive";
}

function statusLabel(status: UserStatus) {
  if (status === "ACTIVE") return "Active";
  if (status === "PENDING") return "Pending";
  if (status === "DEACTIVATED") return "Deactivated";
  return "Suspended";
}

export async function sendEmail(message: EmailMessage) {
  try {
    return await emailProvider.send(message);
  } catch (error) {
    console.error("email_send_failed", {
      provider: emailProvider.kind,
      to: message.to,
      subject: message.subject,
      error
    });
    return null;
  }
}

export async function sendUserPendingApprovalEmail(input: {
  to: string;
  fullName: string;
  role: UserRole;
}) {
  return sendEmail({
    to: input.to,
    subject: "Account created: pending approval",
    text: `Hi ${input.fullName}, your ${roleLabel(input.role)} account was created and is currently pending approval.`,
    tags: ["user", "pending_approval"]
  });
}

export async function sendUserSetupPasswordEmail(input: {
  to: string;
  fullName: string;
  role: UserRole;
  setupLink: string;
  expiresAt: Date;
}) {
  return sendEmail({
    to: input.to,
    subject: "Set up your Solar Admin password",
    text: `Hi ${input.fullName}, your ${roleLabel(input.role)} account is created. Set your password using this one-time link: ${input.setupLink}. This link expires on ${input.expiresAt.toUTCString()}.`,
    tags: ["user", "setup_password"]
  });
}

export async function sendUserStatusChangedEmail(input: {
  to: string;
  fullName: string;
  status: UserStatus;
  reason?: string;
}) {
  const reasonLine = input.reason ? ` Reason: ${input.reason}` : "";
  return sendEmail({
    to: input.to,
    subject: `Account status updated: ${statusLabel(input.status)}`,
    text: `Hi ${input.fullName}, your account status is now ${statusLabel(input.status)}.${reasonLine}`,
    tags: ["user", "status_change"]
  });
}

export async function sendUserRoleChangedEmail(input: {
  to: string;
  fullName: string;
  previousRole: UserRole;
  nextRole: UserRole;
  warnings: string[];
}) {
  const warningText = input.warnings.length
    ? ` Warnings: ${input.warnings.join(" ")}`
    : "";
  return sendEmail({
    to: input.to,
    subject: "Account role updated",
    text: `Hi ${input.fullName}, your role changed from ${roleLabel(input.previousRole)} to ${roleLabel(input.nextRole)}.${warningText}`,
    tags: ["user", "role_change"]
  });
}
