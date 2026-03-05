/**
 * Lambda handler for sending resolution email to the ticket creator.
 * Uses SES to send a styled HTML email with the resolution details.
 * Falls back to sending to the admin (sender) email if recipient is unverified (SES sandbox).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { getItem } from '../utils/dynamodb-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('SendResolutionEmail');
const ses = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'siddadeepika@gmail.com';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br/>');
}

function buildResolutionHtml(subject: string, resolution: string, rootCause: string): string {
  const rootCauseBlock = rootCause
    ? `<div style="margin-top:16px;">
        <div style="font-size:0.85rem;color:#a0a0c0;margin-bottom:6px;">Root Cause</div>
        <div style="background:#1a1a2e;padding:14px 18px;border-radius:8px;border:1px solid #2d2d4a;color:#e0e0f0;font-size:0.95rem;line-height:1.6;">${escHtml(rootCause)}</div>
      </div>`
    : '';

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f0f1a;border-radius:12px;color:#e0e0f0;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:1.5rem;background:linear-gradient(135deg,#6C5CE7,#a29bfe);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🚀 NovaSupport</h1>
      </div>
      <p style="font-size:1rem;color:#e0e0f0;">Hi there,</p>
      <p style="font-size:0.95rem;color:#a0a0c0;">Great news! Your support ticket <strong style="color:#a29bfe;">"${escHtml(subject)}"</strong> has been resolved.</p>
      <div style="margin-top:20px;">
        <div style="font-size:0.85rem;color:#a0a0c0;margin-bottom:6px;">Resolution</div>
        <div style="background:#1a1a2e;padding:14px 18px;border-radius:8px;border:1px solid #2d2d4a;color:#e0e0f0;font-size:0.95rem;line-height:1.6;">${escHtml(resolution)}</div>
      </div>
      ${rootCauseBlock}
      <p style="font-size:0.9rem;color:#a0a0c0;margin-top:20px;">If you have any further questions, feel free to submit a new ticket through the NovaSupport portal.</p>
      <hr style="border:none;border-top:1px solid #2d2d4a;margin:24px 0;" />
      <p style="font-size:0.75rem;color:#636e72;text-align:center;">NovaSupport — AI-Powered Customer Support</p>
    </div>`;
}


export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const ticketId = event.pathParameters?.ticketId;
    if (!ticketId) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'ticketId is required' } }) };
    }

    const ticket = await getItem(`TICKET#${ticketId}`, 'METADATA');
    if (!ticket) {
      return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'Ticket not found' } }) };
    }

    const userEmail = ticket.userId as string;
    if (!userEmail) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: { message: 'No user email found on ticket' } }) };
    }

    const resolution = ticket.resolution as string || 'No resolution details provided.';
    const rootCause = (ticket.rootCause as string) || '';
    const subject = (ticket.subject as string) || 'Your Support Ticket';

    await ses.send(new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: { ToAddresses: [userEmail] },
      Message: {
        Subject: { Data: `✅ Resolved: ${subject} — NovaSupport`, Charset: 'UTF-8' },
        Body: { Html: { Data: buildResolutionHtml(subject, resolution, rootCause), Charset: 'UTF-8' } },
      },
    }));

    logger.info('Resolution email sent via SES', { ticketId, to: userEmail });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: 'Resolution email sent', to: userEmail }),
    };
  } catch (error) {
    logger.error('Error sending resolution email', error instanceof Error ? error : undefined);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: { message: 'Failed to send resolution email' } }),
    };
  }
}
