// Sends email through the shop's mailbox. Unless MAIL_MODE=send, mail is only written to the
// server log, so a staging copy of the site can never email real customers.
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  fromName?: string;
}

// The shop's own mailbox, which receives new-order alerts.
export const shopMailbox = () => process.env.EMAIL_USER ?? "";

export const mailEnabled = () => process.env.MAIL_MODE === "send";

export async function sendMail(mail: Mail) {
  if (!mailEnabled()) {
    console.log(`[mail not sent, MAIL_MODE=${process.env.MAIL_MODE ?? "unset"}] to=${mail.to} subject=${mail.subject}`);
    const link = mail.html.match(/href="([^"]+)"/)?.[1];
    if (link) console.log(`[mail link] ${link}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  const { fromName = "Bangalore Collective", ...message } = mail;
  await transporter.sendMail({ from: `"${fromName}" <${process.env.EMAIL_USER}>`, ...message });
}

export function siteUrl(path = "") {
  return `${(process.env.SITE_URL ?? "").replace(/\/$/, "")}${path}`;
}
