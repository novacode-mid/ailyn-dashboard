// ── Email Sender via Resend API ───────────────────────────────────────────

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;        // HTML body
  from_name: string;
  from_email: string;
  reply_to?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendEmail(apiKey: string, options: SendEmailOptions): Promise<EmailResult> {
  try {
    console.log("[email] sending to:", options.to, "| from:", options.from_email, "| subject:", options.subject);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${options.from_name} <${options.from_email}>`,
        to: [options.to],
        subject: options.subject,
        html: options.body,
        reply_to: options.reply_to ?? options.from_email,
      }),
    });

    console.log("[email] Resend response status:", response.status);
    const responseText = await response.text();
    console.log("[email] Resend response body:", responseText);

    if (!response.ok) {
      return { success: false, error: `Resend API error ${response.status}: ${responseText}` };
    }

    const data = JSON.parse(responseText) as { id?: string };
    return { success: true, messageId: data.id };
  } catch (error) {
    console.log("[email] fetch exception:", String(error));
    return { success: false, error: String(error) };
  }
}
