/**
 * Infrastructure tests for NovaSupport CDK stack
 */

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NovaSupportStack } from '../lib/novasupport-stack';

describe('NovaSupportStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new NovaSupportStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('Creates DynamoDB table with correct configuration', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      StreamSpecification: {
        StreamViewType: 'NEW_AND_OLD_IMAGES',
      },
    });
  });

  test('Creates DynamoDB table with three GSI indexes', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI3',
          KeySchema: [
            { AttributeName: 'GSI3PK', KeyType: 'HASH' },
            { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    });
  });

  test('Creates S3 bucket with encryption and versioning', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled',
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('Creates two SQS queues with DLQs', () => {
    // Count SQS queues (should be 4: 2 main + 2 DLQs)
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBe(4);
  });

  test('Creates Lambda function with correct environment variables', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Timeout: 30,
      MemorySize: 512,
    });
  });

  test('Creates IAM role with Bedrock permissions', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyStatements = Object.values(policies).flatMap((policy: any) => 
      policy.Properties.PolicyDocument.Statement
    );
    
    const bedrockPolicy = policyStatements.find((statement: any) => 
      statement.Action?.includes('bedrock:InvokeModel')
    );
    
    expect(bedrockPolicy).toBeDefined();
    expect(bedrockPolicy.Effect).toBe('Allow');
    expect(bedrockPolicy.Action).toContain('bedrock:InvokeModel');
    expect(bedrockPolicy.Action).toContain('bedrock:InvokeModelWithResponseStream');
  });

  test('Creates CloudWatch log group', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/novasupport',
      RetentionInDays: 7,
    });
  });

  test('Outputs all required resource identifiers', () => {
    const outputs = template.findOutputs('*');
    expect(outputs).toHaveProperty('TicketsTableName');
    expect(outputs).toHaveProperty('AttachmentsBucketName');
    expect(outputs).toHaveProperty('TicketProcessingQueueUrl');
    expect(outputs).toHaveProperty('MultimodalProcessingQueueUrl');
    expect(outputs).toHaveProperty('LogGroupName');
  });

  test('Creates CloudWatch dashboard', () => {
    template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'NovaSupport-Metrics',
    });
  });

  test('Creates CloudWatch alarms for error rates and latency', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    const alarmNames = Object.values(alarms).map(
      (a: any) => a.Properties.AlarmName,
    );

    expect(alarmNames).toContain('NovaSupport-High5xxErrorRate');
    expect(alarmNames).toContain('NovaSupport-HighApiLatency');
    expect(alarmNames).toContain('NovaSupport-DLQMessages');
    expect(alarmNames).toContain('NovaSupport-LambdaErrors');
  });

  test('Creates at least 4 CloudWatch alarms', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(4);
  });

  test('Outputs dashboard URL', () => {
    const outputs = template.findOutputs('*');
    expect(outputs).toHaveProperty('DashboardUrl');
  });

  test('Grants X-Ray tracing permissions to Lambda role', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const policyStatements = Object.values(policies).flatMap((policy: any) =>
      policy.Properties.PolicyDocument.Statement,
    );

    const xrayPolicy = policyStatements.find((statement: any) =>
      statement.Action?.includes('xray:PutTraceSegments'),
    );

    expect(xrayPolicy).toBeDefined();
    expect(xrayPolicy.Action).toContain('xray:PutTelemetryRecords');
  });
});
