/**
 * DynamoDB client utilities for NovaSupport
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client);

export const TABLE_NAME = process.env.TICKETS_TABLE_NAME || 'novasupport-tickets';

/**
 * Put an item into DynamoDB
 */
export async function putItem(item: Record<string, any>): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  }));
}

/**
 * Put an item into DynamoDB only if the PK+SK doesn't already exist (conditional write)
 * Returns true if the item was written, false if it already existed.
 */
export async function putItemIfNotExists(item: Record<string, any>): Promise<boolean> {
  try {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    return true;
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw err;
  }
}

/**
 * Get an item from DynamoDB
 */
export async function getItem(pk: string, sk: string): Promise<Record<string, any> | undefined> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
  }));
  return result.Item;
}

/**
 * Query items from DynamoDB
 */
export async function queryItems(
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, any>,
  indexName?: string
): Promise<Record<string, any>[]> {
  const allItems: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const params: any = {
      TableName: TABLE_NAME,
      IndexName: indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    };
    if (lastKey) {
      params.ExclusiveStartKey = lastKey;
    }
    const result = await docClient.send(new QueryCommand(params));
    allItems.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return allItems;
}

/**
 * Update an item in DynamoDB
 */
export async function updateItem(
  pk: string,
  sk: string,
  updateExpression: string,
  expressionAttributeValues: Record<string, any>,
  expressionAttributeNames?: Record<string, string>
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
    UpdateExpression: updateExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    ExpressionAttributeNames: expressionAttributeNames,
  }));
}

/**
 * Atomically increment a counter and return the new value.
 * Uses ADD to ensure concurrent calls each get a unique value.
 */
export async function atomicIncrement(
  pk: string,
  sk: string,
  counterAttribute: string,
  additionalUpdates?: { expression: string; values: Record<string, any> }
): Promise<number> {
  const updateParts = [`ADD ${counterAttribute} :inc`];
  const values: Record<string, any> = { ':inc': 1 };

  if (additionalUpdates) {
    updateParts.push(additionalUpdates.expression);
    Object.assign(values, additionalUpdates.values);
  }

  const result = await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { PK: pk, SK: sk },
    UpdateExpression: updateParts.join(' '),
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));

  return (result.Attributes?.[counterAttribute] as number) ?? 0;
}

/**
 * Scan items from DynamoDB with optional filter
 */
export async function scanItems(
  filterExpression?: string,
  expressionAttributeValues?: Record<string, any>
): Promise<Record<string, any>[]> {
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');

  const params: any = {
    TableName: TABLE_NAME,
  };

  if (filterExpression) {
    params.FilterExpression = filterExpression;
    params.ExpressionAttributeValues = expressionAttributeValues;
  }

  const allItems: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    if (lastKey) {
      params.ExclusiveStartKey = lastKey;
    }
    const result = await docClient.send(new ScanCommand(params));
    allItems.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return allItems;
}

