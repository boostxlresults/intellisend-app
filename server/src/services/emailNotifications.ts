import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface ConversationMessage {
  direction: string;
  body: string;
  createdAt: Date | string;
  fromNumber?: string;
}

interface SendReplyNotificationOptions {
  toEmail: string;
  tenantName: string;
  contactName: string;
  contactPhone: string;
  conversationId: string;
  conversationUrl: string;
  messages: ConversationMessage[];
  serviceTitanEnabled?: boolean;
}

function formatConversationHtml(messages: ConversationMessage[], contactName: string): string {
  if (!messages || messages.length === 0) {
    return '<p style="color: #718096; font-style: italic;">No messages in conversation.</p>';
  }

  return messages.map(msg => {
    const isInbound = msg.direction === 'INBOUND';
    const timestamp = new Date(msg.createdAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    const bgColor = isInbound ? '#e6f3ff' : '#f0f0f0';
    const borderColor = isInbound ? '#3182ce' : '#a0aec0';
    const label = isInbound ? escapeHtml(contactName) : 'You';
    const escapedBody = escapeHtml(msg.body);
    
    return `
      <div style="background: ${bgColor}; border-left: 4px solid ${borderColor}; padding: 12px; margin-bottom: 10px; border-radius: 0 6px 6px 0;">
        <div style="font-size: 12px; color: #718096; margin-bottom: 4px;">
          <strong>${label}</strong> - ${timestamp}
        </div>
        <div style="color: #2d3748;">${escapedBody}</div>
      </div>
    `;
  }).join('');
}

export async function sendReplyNotification(options: SendReplyNotificationOptions): Promise<boolean> {
  if (!resend) {
    console.log('[Email] Resend not configured, skipping notification');
    return false;
  }

  try {
    const conversationHtml = formatConversationHtml(options.messages, options.contactName);
    
    const serviceTitanSection = options.serviceTitanEnabled ? `
      <a href="https://go.servicetitan.com/#/Bookings" 
         style="display: inline-block; background: #48bb78; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-left: 10px;">
        Respond in ServiceTitan
      </a>
    ` : '';
    
    const { data, error } = await resend.emails.send({
      from: 'IntelliSend Alerts <alerts@mail.intellisend.net>',
      to: options.toEmail,
      subject: `IntelliSend Customer Response - ${options.contactName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto;">
          <div style="background: #2c5282; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 22px;">IntelliSend Customer Response</h1>
          </div>
          
          <div style="padding: 20px; background: #f7fafc; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 15px 0; color: #4a5568; font-size: 16px;">
              Hey! You've received a response from a customer in the IntelliSend Dashboard.
            </p>
            
            <div style="background: white; border-radius: 8px; padding: 15px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
              <p style="margin: 0 0 5px 0;"><strong>Tenant:</strong> ${escapeHtml(options.tenantName)}</p>
              <p style="margin: 0 0 5px 0;"><strong>Customer:</strong> ${escapeHtml(options.contactName)}</p>
              <p style="margin: 0;"><strong>Phone:</strong> ${escapeHtml(options.contactPhone)}</p>
            </div>
            
            <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 16px;">Conversation History:</h3>
            
            <div style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
              ${conversationHtml}
            </div>
            
            <div style="text-align: center; padding-top: 10px;">
              <a href="${options.conversationUrl}" 
                 style="display: inline-block; background: #3182ce; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Respond in IntelliSend
              </a>
              ${serviceTitanSection}
            </div>
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
