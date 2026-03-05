/**
 * Cognito Custom Message Lambda trigger
 * Intercepts Cognito emails and customizes them:
 * - Sign-up verification: styled welcome email with code
 * - Resolution notification: styled resolution email (triggered via AdminUpdateUserAttributes)
 */

import { CustomMessageTriggerEvent } from 'aws-lambda';
import { SESClient, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';
import { createLogger } from '../utils/logger';

const logger = createLogger('CognitoCustomMessage');
const sesClient = new SESClient({});

export async function handler(event: CustomMessageTriggerEvent): Promise<CustomMessageTriggerEvent> {
  logger.info('Custom message trigger', {
    triggerSource: event.triggerSource,
    clientMetadata: event.request.clientMetadata,
  });

  const metadata = event.request.clientMetadata || {};

  // Resolution notification — triggered by send-resolution-email handler
  if (metadata.type === 'resolution_notification') {
    const subject = metadata.ticketSubject || 'Your Support Ticket';
    const resolution = metadata.resolution || 'Your issue has been resolved.';
    const rootCause = metadata.rootCause || '';

    event.response.emailSubject = `✅ Resolved: ${subject} — NovaSupport`;
    event.response.emailMessage = buildResolutionEmail(subject, resolution, rootCause);
    return event;
  }

  // Normal sign-up / resend code verification emails
  if (
    event.triggerSource === 'CustomMessage_SignUp' ||
    event.triggerSource === 'CustomMessage_ResendCode'
  ) {
    event.response.emailSubject = 'Welcome to NovaSupport — Verify Your Email';
    event.response.emailMessage = buildVerificationEmail(event.request.codeParameter);

    // Auto-verify the user's email in SES so we can send them emails later (e.g. resolution notifications)
    if (event.triggerSource === 'CustomMessage_SignUp') {
      const userEmail = event.request.userAttributes?.email;
      if (userEmail) {
        try {
          await sesClient.send(new VerifyEmailIdentityCommand({ EmailAddress: userEmail }));
          logger.info('SES verification email sent to new user', { email: userEmail });
        } catch (err) {
          logger.warn('Failed to send SES verification to new user (non-blocking)', {
            email: userEmail,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Forgot password
  if (event.triggerSource === 'CustomMessage_ForgotPassword') {
    event.response.emailSubject = 'NovaSupport — Reset Your Password';
    event.response.emailMessage = buildForgotPasswordEmail(event.request.codeParameter);
  }

  return event;
}

function buildResolutionEmail(subject: string, resolution: string, rootCause: string): string {
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

function buildVerificationEmail(codeParameter: string): string {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f0f1a;border-radius:12px;color:#e0e0f0;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:1.5rem;background:linear-gradient(135deg,#6C5CE7,#a29bfe);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🚀 NovaSupport</h1>
      </div>
      <p style="font-size:1rem;color:#e0e0f0;">Hi there!</p>
      <p style="font-size:0.95rem;color:#a0a0c0;">Welcome to <strong style="color:#a29bfe;">NovaSupport</strong> — your AI-powered support platform. We're glad to have you on board.</p>
      <p style="font-size:0.95rem;color:#a0a0c0;">Use the code below to verify your email and get started:</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="display:inline-block;font-size:2rem;font-weight:700;letter-spacing:6px;color:#6C5CE7;background:#1a1a2e;padding:16px 32px;border-radius:8px;border:1px solid #2d2d4a;">${codeParameter}</span>
      </div>
      <p style="font-size:0.85rem;color:#636e72;text-align:center;">This code expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #2d2d4a;margin:24px 0;" />
      <p style="font-size:0.75rem;color:#636e72;text-align:center;">NovaSupport — AI-Powered Customer Support</p>
    </div>`;
}

function buildForgotPasswordEmail(codeParameter: string): string {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f0f1a;border-radius:12px;color:#e0e0f0;">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="font-size:1.5rem;background:linear-gradient(135deg,#6C5CE7,#a29bfe);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🚀 NovaSupport</h1>
      </div>
      <p style="font-size:1rem;color:#e0e0f0;">Hi there,</p>
      <p style="font-size:0.95rem;color:#a0a0c0;">We received a request to reset your password. Use the code below:</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="display:inline-block;font-size:2rem;font-weight:700;letter-spacing:6px;color:#6C5CE7;background:#1a1a2e;padding:16px 32px;border-radius:8px;border:1px solid #2d2d4a;">${codeParameter}</span>
      </div>
      <p style="font-size:0.85rem;color:#636e72;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #2d2d4a;margin:24px 0;" />
      <p style="font-size:0.75rem;color:#636e72;text-align:center;">NovaSupport — AI-Powered Customer Support</p>
    </div>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}
