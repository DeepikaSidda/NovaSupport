/**
 * SQS client utilities for NovaSupport
 */

import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const client = new SQSClient({});

export const TICKET_PROCESSING_QUEUE_URL = process.env.TICKET_PROCESSING_QUEUE_URL || '';
export const MULTIMODAL_PROCESSING_QUEUE_URL = process.env.MULTIMODAL_PROCESSING_QUEUE_URL || '';

/**
 * Send a message to SQS queue
 */
export async function sendMessage(queueUrl: string, messageBody: any): Promise<string> {
  const response = await client.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(messageBody),
  }));
  
  return response.MessageId || '';
}

/**
 * Receive messages from SQS queue
 */
export async function receiveMessages(
  queueUrl: string,
  maxMessages: number = 1,
  waitTimeSeconds: number = 20
): Promise<any[]> {
  const response = await client.send(new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: maxMessages,
    WaitTimeSeconds: waitTimeSeconds,
    VisibilityTimeout: 300,
  }));
  
  return response.Messages || [];
}

/**
 * Delete a message from SQS queue
 */
export async function deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
  await client.send(new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  }));
}

/**
 * Send ticket to processing queue
 */
export async function sendTicketForProcessing(ticketId: string): Promise<string> {
  return await sendMessage(TICKET_PROCESSING_QUEUE_URL, {
    ticketId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send attachment for multimodal processing
 */
export async function sendAttachmentForProcessing(
  ticketId: string,
  attachmentId: string,
  attachmentType: 'image' | 'video' | 'document'
): Promise<string> {
  return await sendMessage(MULTIMODAL_PROCESSING_QUEUE_URL, {
    ticketId,
    attachmentId,
    attachmentType,
    timestamp: new Date().toISOString(),
  });
}
