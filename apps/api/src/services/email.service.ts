import { UserRole, UserStatus } from "@prisma/client";
import { env } from "../config/env.js";

type EmailProviderKind = "console" | "sendgrid" | "ses";

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
    // Placeholder integration: wire official SendGrid client here when credentials are enabled.
    console.info("[email:sendgrid-placeholder]", {
      messageId: `sg-${Date.now()}`,
      from: env.EMAIL_FROM,
      hasApiKey: Boolean(env.SENDGRID_API_KEY),
      to: message.to,
      subject: message.subject
    });
    return {
      provider: this.kind,
      messageId: `sg-${Date.now()}`
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
