import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface SendReplyNotificationOptions {
  toEmail: string;
  tenantName: string;
  contactName: string;
  contactPhone: string;
  message: string;
  conversationId: string;
  conversationUrl?: string;
}

export async function sendReplyNotification(options: SendReplyNotificationOptions): Promise<boolean> {
  if (!resend) {
    console.log('[Email] Resend not configured, skipping notification');
    return false;
  }

  try {
    const conversationLink = options.conversationUrl || `#`;
    
    const { data, error } = await resend.emails.send({
      from: 'IntelliSend Alerts <alerts@mail.intellisend.net>',
      to: options.toEmail,
      subject: `New SMS Reply from ${options.contactName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #3182ce; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">New SMS Reply</h1>
          </div>
          
          <div style="padding: 20px; background: #f7fafc; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 15px 0; color: #4a5568;">
              You have a new SMS reply from a customer:
            </p>
            
            <div style="background: white; border-radius: 8px; padding: 15px; margin-bottom: 15px; border: 1px solid #e2e8f0;">
              <p style="margin: 0 0 8px 0;"><strong>From:</strong> ${options.contactName}</p>
              <p style="margin: 0 0 8px 0;"><strong>Phone:</strong> ${options.contactPhone}</p>
              <p style="margin: 0 0 8px 0;"><strong>Tenant:</strong> ${options.tenantName}</p>
            </div>
            
            <div style="background: #edf2f7; border-left: 4px solid #3182ce; padding: 15px; margin-bottom: 20px;">
              <p style="margin: 0; font-style: italic; color: #2d3748;">
                "${options.message}"
              </p>
            </div>
            
            <a href="${conversationLink}" 
               style="display: inline-block; background: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              View Conversation
            </a>
          </div>
          
          <div style="padding: 15px; text-align: center; color: #718096; font-size: 12px;">
            <p style="margin: 0;">Sent by IntelliSend SMS Platform</p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('[Email] Failed to send notification:', error);
      return false;
    }

    console.log(`[Email] Notification sent to ${options.toEmail}, id: ${data?.id}`);
    return true;
  } catch (error) {
    console.error('[Email] Error sending notification:', error);
    return false;
  }
}
