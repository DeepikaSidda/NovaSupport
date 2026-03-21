import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';

import { Construct } from 'constructs';

export class NovaSupportStack extends cdk.Stack {
  public readonly ticketsTable: dynamodb.Table;
  public readonly attachmentsBucket: s3.Bucket;
  public readonly ticketProcessingQueue: sqs.Queue;
  public readonly multimodalProcessingQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table for Tickets with GSI indexes
    this.ticketsTable = new dynamodb.Table(this, 'TicketsTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For hackathon - change for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI1: Query tickets by user
    this.ticketsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Query tickets by status and priority
    this.ticketsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Query tickets by team
    this.ticketsTable.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // S3 Bucket for attachments
    this.attachmentsBucket = new s3.Bucket(this, 'AttachmentsBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For hackathon - change for production
      autoDeleteObjects: true, // For hackathon - change for production
      lifecycleRules: [
        {
          id: 'DeleteOldAttachments',
          expiration: cdk.Duration.days(90),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ['*'], // Restrict in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // Dead Letter Queue for failed messages
    const deadLetterQueue = new sqs.Queue(this, 'TicketProcessingDLQ', {
      queueName: 'novasupport-ticket-processing-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS Queue for ticket processing
    this.ticketProcessingQueue = new sqs.Queue(this, 'TicketProcessingQueue', {
      queueName: 'novasupport-ticket-processing',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3,
      },
    });

    // Dead Letter Queue for multimodal processing
    const multimodalDLQ = new sqs.Queue(this, 'MultimodalProcessingDLQ', {
      queueName: 'novasupport-multimodal-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS Queue for async multimodal processing (videos, large documents)
    this.multimodalProcessingQueue = new sqs.Queue(this, 'MultimodalProcessingQueue', {
      queueName: 'novasupport-multimodal-processing',
      visibilityTimeout: cdk.Duration.seconds(900), // 15 minutes for video processing
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: multimodalDLQ,
        maxReceiveCount: 2,
      },
    });

    // CloudWatch Log Group for application logs
    const logGroup = new logs.LogGroup(this, 'NovaSupportLogs', {
      logGroupName: '/aws/novasupport',
      retention: logs.RetentionDays.ONE_WEEK, // For hackathon - increase for production
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda execution role with necessary permissions
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant permissions to Lambda role
    this.ticketsTable.grantReadWriteData(lambdaRole);
    this.attachmentsBucket.grantReadWrite(lambdaRole);
    this.ticketProcessingQueue.grantSendMessages(lambdaRole);
    this.ticketProcessingQueue.grantConsumeMessages(lambdaRole);
    this.multimodalProcessingQueue.grantSendMessages(lambdaRole);
    this.multimodalProcessingQueue.grantConsumeMessages(lambdaRole);

    // Grant permissions to invoke Nova models
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:InvokeModelWithBidirectionalStream',
      ],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-*`,
      ],
    }));

    // Grant Transcribe Streaming and Polly permissions for voice processing
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'transcribe:StartStreamTranscription',
      ],
      resources: ['*'],
    }));

    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // Grant SES permissions for sending resolution emails and verifying new user emails
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ses:SendEmail', 'ses:SendRawEmail', 'ses:VerifyEmailIdentity'],
      resources: ['*'],
    }));

    // Grant Cognito permissions for resolution email flow
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
      ],
      resources: ['*'],
    }));

    // Grant Amazon Translate permissions for multi-language support
    // comprehend:DetectDominantLanguage is required when using SourceLanguageCode: 'auto'
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['translate:TranslateText', 'translate:DetectDominantLanguage', 'comprehend:DetectDominantLanguage'],
      resources: ['*'],
    }));

    // Shared Lambda environment variables
    const lambdaEnvironment: Record<string, string> = {
      TICKETS_TABLE_NAME: this.ticketsTable.tableName,
      ATTACHMENTS_BUCKET_NAME: this.attachmentsBucket.bucketName,
      TICKET_PROCESSING_QUEUE_URL: this.ticketProcessingQueue.queueUrl,
      MULTIMODAL_PROCESSING_QUEUE_URL: this.multimodalProcessingQueue.queueUrl,
    };

    // Lambda function template (placeholder - will be implemented in later tasks)
    const ticketIngestionFunction = new lambda.Function(this, 'TicketIngestionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Ticket ingestion function - to be implemented');
          return { statusCode: 200, body: 'OK' };
        };
      `),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
      logGroup: logGroup,
    });

    // --- Cognito User Pool for Authentication (Task 23.2) ---

    const userPool = new cognito.UserPool(this, 'NovaSupportUserPool', {
      userPoolName: 'novasupport-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      userVerification: {
        emailSubject: 'Welcome to NovaSupport — Verify Your Email',
        emailBody: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f0f1a;border-radius:12px;color:#e0e0f0;">
            <div style="text-align:center;margin-bottom:24px;">
              <h1 style="font-size:1.5rem;background:linear-gradient(135deg,#6C5CE7,#a29bfe);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🚀 NovaSupport</h1>
            </div>
            <p style="font-size:1rem;color:#e0e0f0;">Hi there,</p>
            <p style="font-size:0.95rem;color:#a0a0c0;">Welcome to <strong style="color:#a29bfe;">NovaSupport</strong> — your AI-powered support platform. We're glad to have you on board.</p>
            <p style="font-size:0.95rem;color:#a0a0c0;">Use the code below to verify your email and get started:</p>
            <div style="text-align:center;margin:24px 0;">
              <span style="display:inline-block;font-size:2rem;font-weight:700;letter-spacing:6px;color:#6C5CE7;background:#1a1a2e;padding:16px 32px;border-radius:8px;border:1px solid #2d2d4a;">{####}</span>
            </div>
            <p style="font-size:0.85rem;color:#636e72;text-align:center;">This code expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #2d2d4a;margin:24px 0;" />
            <p style="font-size:0.75rem;color:#636e72;text-align:center;">NovaSupport — AI-Powered Customer Support</p>
          </div>`,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Cognito groups for role-based access control
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrators with full access',
    });

    new cognito.CfnUserPoolGroup(this, 'SupportAgentGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'support_agent',
      description: 'Support agents with ticket management access',
    });

    new cognito.CfnUserPoolGroup(this, 'UserGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'user',
      description: 'Regular users who submit tickets',
    });

    const userPoolClient = userPool.addClient('NovaSupportAppClient', {
      userPoolClientName: 'novasupport-app',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    // --- Separate Cognito User Pool for End Users (User Portal) ---

    // Custom Message Lambda trigger — intercepts Cognito emails for both
    // verification (styled welcome email) and resolution notifications
    const cognitoCustomMessageFunction = new lambda.Function(this, 'CognitoCustomMessageFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/cognito-custom-message.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: lambdaEnvironment,
    });

    const portalUserPool = new cognito.UserPool(this, 'PortalUserPool', {
      userPoolName: 'novasupport-portal-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userVerification: {
        emailSubject: 'Welcome to NovaSupport — Verify Your Email',
        emailBody: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f0f1a;border-radius:12px;color:#e0e0f0;">
            <div style="text-align:center;margin-bottom:24px;">
              <h1 style="font-size:1.5rem;background:linear-gradient(135deg,#6C5CE7,#a29bfe);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">🚀 NovaSupport</h1>
            </div>
            <p style="font-size:1rem;color:#e0e0f0;">Hi there,</p>
            <p style="font-size:0.95rem;color:#a0a0c0;">Welcome to <strong style="color:#a29bfe;">NovaSupport</strong> — your AI-powered support platform. We're excited to have you.</p>
            <p style="font-size:0.95rem;color:#a0a0c0;">Here's your verification code to get started:</p>
            <div style="text-align:center;margin:24px 0;">
              <span style="display:inline-block;font-size:2rem;font-weight:700;letter-spacing:6px;color:#6C5CE7;background:#1a1a2e;padding:16px 32px;border-radius:8px;border:1px solid #2d2d4a;">{####}</span>
            </div>
            <p style="font-size:0.85rem;color:#636e72;text-align:center;">This code expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #2d2d4a;margin:24px 0;" />
            <p style="font-size:0.75rem;color:#636e72;text-align:center;">NovaSupport — AI-Powered Customer Support</p>
          </div>`,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      lambdaTriggers: {
        customMessage: cognitoCustomMessageFunction,
      },
      customAttributes: {
        last_resolution: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const portalUserPoolClient = portalUserPool.addClient('PortalAppClient', {
      userPoolClientName: 'novasupport-portal-app',
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    // Cognito authorizer accepts tokens from BOTH admin and portal user pools
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'NovaSupportAuthorizer', {
      cognitoUserPools: [userPool, portalUserPool],
      authorizerName: 'NovaSupportCognitoAuthorizer',
    });

    // Add Cognito config to Lambda environment
    lambdaEnvironment['COGNITO_USER_POOL_ID'] = userPool.userPoolId;
    lambdaEnvironment['COGNITO_CLIENT_ID'] = userPoolClient.userPoolClientId;
    lambdaEnvironment['PORTAL_USER_POOL_ID'] = portalUserPool.userPoolId;
    lambdaEnvironment['PORTAL_CLIENT_ID'] = portalUserPoolClient.userPoolClientId;

    // --- API Gateway Lambda Functions ---

    // POST /tickets - Create ticket
    const createTicketFunction = new lambda.Function(this, 'CreateTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/create-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // GET /tickets/{ticketId} - Get ticket details
    const getTicketFunction = new lambda.Function(this, 'GetTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/get-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // GET /tickets - List tickets
    const listTicketsFunction = new lambda.Function(this, 'ListTicketsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/list-tickets.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // PUT /tickets/{ticketId}/status - Update ticket status
    const updateTicketStatusFunction = new lambda.Function(this, 'UpdateTicketStatusFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/update-ticket-status.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // GET /tickets/{ticketId}/attachments - Get attachments with download URLs
    const getAttachmentsFunction = new lambda.Function(this, 'GetAttachmentsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/get-attachments.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // POST /tickets/{ticketId}/attachments - Upload attachment
    const uploadAttachmentFunction = new lambda.Function(this, 'UploadAttachmentFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/upload-attachment.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // GET /tickets/{ticketId}/queue - Get ticket queue by status (reuses list handler)
    const getTicketQueueFunction = new lambda.Function(this, 'GetTicketQueueFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/list-tickets.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // POST /tickets/{ticketId}/analyze - Trigger analysis
    const triggerAnalysisFunction = new lambda.Function(this, 'TriggerAnalysisFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/analyze-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: lambdaEnvironment,
    });

    // SQS Consumer - Auto-processes tickets when they arrive in the queue
    const processTicketQueueFunction = new lambda.Function(this, 'ProcessTicketQueueFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/process-ticket-queue.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: lambdaEnvironment,
    });

    // Wire SQS queue to the consumer Lambda
    processTicketQueueFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(this.ticketProcessingQueue, {
        batchSize: 1,
        maxBatchingWindow: cdk.Duration.seconds(0),
      })
    );

    // --- API Gateway ---

    const api = new apigateway.RestApi(this, 'NovaSupportApi', {
      restApiName: 'NovaSupport API',
      description: 'API for NovaSupport ticket management system',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      deployOptions: {
        stageName: 'dev',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // Gateway Responses with CORS headers for auth errors
    // API Gateway's Cognito authorizer returns 401/403 without CORS headers,
    // which causes browsers to treat it as a CORS failure instead of an auth error.
    api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
      templates: {
        'application/json': '{"message":"Unauthorized","hint":"Token may be expired. Please sign in again."}',
      },
    });

    api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
      templates: {
        'application/json': '{"message":"Access denied"}',
      },
    });

    // Catch-all CORS headers for ANY 4xx/5xx error from API Gateway
    // (authorizer failures, validation errors, throttling, etc.)
    api.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });

    api.addGatewayResponse('Default5xx', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });

    // Request validation model for POST /tickets
    const createTicketModel = api.addModel('CreateTicketModel', {
      contentType: 'application/json',
      modelName: 'CreateTicketRequest',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['userId', 'subject', 'description'],
        properties: {
          userId: { type: apigateway.JsonSchemaType.STRING, minLength: 1 },
          subject: { type: apigateway.JsonSchemaType.STRING, minLength: 1 },
          description: { type: apigateway.JsonSchemaType.STRING, minLength: 1 },
          priority: { type: apigateway.JsonSchemaType.INTEGER, minimum: 1, maximum: 10 },
          metadata: { type: apigateway.JsonSchemaType.OBJECT },
        },
      },
    });

    const requestValidator = api.addRequestValidator('BodyValidator', {
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // --- API Resources and Methods ---

    // /tickets
    const ticketsResource = api.root.addResource('tickets');

    // POST /tickets
    ticketsResource.addMethod('POST', new apigateway.LambdaIntegration(createTicketFunction), {
      requestModels: { 'application/json': createTicketModel },
      requestValidator,
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /tickets
    ticketsResource.addMethod('GET', new apigateway.LambdaIntegration(listTicketsFunction), {
      requestParameters: {
        'method.request.querystring.status': false,
      },
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}
    const ticketResource = ticketsResource.addResource('{ticketId}');

    // GET /tickets/{ticketId}
    ticketResource.addMethod('GET', new apigateway.LambdaIntegration(getTicketFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}/status
    const statusResource = ticketResource.addResource('status');

    // PUT /tickets/{ticketId}/status
    statusResource.addMethod('PUT', new apigateway.LambdaIntegration(updateTicketStatusFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}/attachments
    const attachmentsResource = ticketResource.addResource('attachments');

    // POST /tickets/{ticketId}/attachments
    attachmentsResource.addMethod('POST', new apigateway.LambdaIntegration(uploadAttachmentFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /tickets/{ticketId}/attachments
    attachmentsResource.addMethod('GET', new apigateway.LambdaIntegration(getAttachmentsFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}/queue
    const queueResource = ticketResource.addResource('queue');

    // GET /tickets/{ticketId}/queue
    queueResource.addMethod('GET', new apigateway.LambdaIntegration(getTicketQueueFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}/analyze
    const analyzeResource = ticketResource.addResource('analyze');

    // POST /tickets/{ticketId}/analyze
    analyzeResource.addMethod('POST', new apigateway.LambdaIntegration(triggerAnalysisFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- Admin-only endpoints (analytics, team management) ---

    // Admin analytics Lambda
    const analyticsFunction = new lambda.Function(this, 'AnalyticsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/get-analytics.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Notifications Lambda
    const notificationsFunction = new lambda.Function(this, 'NotificationsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/get-notifications.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Knowledge base search Lambda
    const knowledgeBaseFunction = new lambda.Function(this, 'KnowledgeBaseFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/search-knowledge.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Similar ticket search Lambda
    const similarTicketsFunction = new lambda.Function(this, 'SimilarTicketsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/search-similar.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // /admin
    const adminResource = api.root.addResource('admin');

    // /admin/analytics - GET (admin only)
    const adminAnalyticsResource = adminResource.addResource('analytics');
    adminAnalyticsResource.addMethod('GET', new apigateway.LambdaIntegration(analyticsFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /notifications - GET, PUT
    const notificationsResource = api.root.addResource('notifications');
    notificationsResource.addMethod('GET', new apigateway.LambdaIntegration(notificationsFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    notificationsResource.addMethod('PUT', new apigateway.LambdaIntegration(notificationsFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /knowledge-base - GET, POST
    const knowledgeBaseResource = api.root.addResource('knowledge-base');
    knowledgeBaseResource.addMethod('GET', new apigateway.LambdaIntegration(knowledgeBaseFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    knowledgeBaseResource.addMethod('POST', new apigateway.LambdaIntegration(knowledgeBaseFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}/similar - GET
    const similarResource = ticketResource.addResource('similar');
    similarResource.addMethod('GET', new apigateway.LambdaIntegration(similarTicketsFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // List teams Lambda
    const listTeamsFunction = new lambda.Function(this, 'ListTeamsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/list-teams.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // /admin/teams - GET
    const adminTeamsResource = adminResource.addResource('teams');
    adminTeamsResource.addMethod('GET', new apigateway.LambdaIntegration(listTeamsFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Team Members Lambda
    const teamMembersFunction = new lambda.Function(this, 'TeamMembersFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/team-members.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // /admin/teams/{teamId}/members - GET, POST, DELETE
    const teamIdResource = adminTeamsResource.addResource('{teamId}');
    const teamMembersResource = teamIdResource.addResource('members');
    const teamMembersIntegration = new apigateway.LambdaIntegration(teamMembersFunction);
    teamMembersResource.addMethod('GET', teamMembersIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    teamMembersResource.addMethod('POST', teamMembersIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    teamMembersResource.addMethod('DELETE', teamMembersIntegration, {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- Edit Ticket & Messaging Lambdas ---

    // PUT /tickets/{ticketId} - Edit ticket
    const editTicketFunction = new lambda.Function(this, 'EditTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/edit-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // GET/POST /tickets/{ticketId}/messages - Ticket messages
    const ticketMessagesFunction = new lambda.Function(this, 'TicketMessagesFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/ticket-messages.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // PUT /tickets/{ticketId}
    ticketResource.addMethod('PUT', new apigateway.LambdaIntegration(editTicketFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // DELETE /tickets/{ticketId} - Permanently delete ticket
    const deleteTicketFunction = new lambda.Function(this, 'DeleteTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/delete-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    ticketResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteTicketFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /tickets/{ticketId}/messages
    const messagesResource = ticketResource.addResource('messages');

    // GET /tickets/{ticketId}/messages
    messagesResource.addMethod('GET', new apigateway.LambdaIntegration(ticketMessagesFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /tickets/{ticketId}/messages
    messagesResource.addMethod('POST', new apigateway.LambdaIntegration(ticketMessagesFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- AI Chat Assistant Lambda ---
    const chatAssistantFunction = new lambda.Function(this, 'ChatAssistantFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/chat-assistant.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(29),
      memorySize: 1024,
      environment: lambdaEnvironment,
    });

    // POST /chat
    const chatResource = api.root.addResource('chat');
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatAssistantFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- Voice & Follow-Up Lambda Functions ---

    // POST /voice/transcribe - Voice transcription
    const voiceTranscribeFunction = new lambda.Function(this, 'VoiceTranscribeFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/voice-transcribe.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: lambdaEnvironment,
    });

    // POST /voice/tts - Text-to-speech
    const voiceTTSFunction = new lambda.Function(this, 'VoiceTTSFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/voice-tts.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: lambdaEnvironment,
    });

    // Scheduled - Process follow-up messages
    const processFollowUpsFunction = new lambda.Function(this, 'ProcessFollowUpsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/process-follow-ups.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // EventBridge rule: invoke process-follow-ups every 15 minutes
    const followUpRule = new events.Rule(this, 'ProcessFollowUpsRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: 'Trigger follow-up processing every 15 minutes',
    });
    followUpRule.addTarget(new targets.LambdaFunction(processFollowUpsFunction));

    // /voice API routes
    const voiceResource = api.root.addResource('voice');

    const voiceTranscribeResource = voiceResource.addResource('transcribe');
    voiceTranscribeResource.addMethod('POST', new apigateway.LambdaIntegration(voiceTranscribeFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const voiceTTSResource = voiceResource.addResource('tts');
    voiceTTSResource.addMethod('POST', new apigateway.LambdaIntegration(voiceTTSFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PUT /tickets/{ticketId}/resolve - Resolve ticket and store solution
    const resolveTicketFunction = new lambda.Function(this, 'ResolveTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/resolve-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // /tickets/{ticketId}/resolve
    const resolveResource = ticketResource.addResource('resolve');
    resolveResource.addMethod('PUT', new apigateway.LambdaIntegration(resolveTicketFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /tickets/{ticketId}/send-resolution-email - Send resolution email via SES
    const sendResolutionEmailFunction = new lambda.Function(this, 'SendResolutionEmailFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/send-resolution-email.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        ...lambdaEnvironment,
        SES_SENDER_EMAIL: 'siddadeepika@gmail.com',
      },
    });

    const sendResolutionEmailResource = ticketResource.addResource('send-resolution-email');
    sendResolutionEmailResource.addMethod('POST', new apigateway.LambdaIntegration(sendResolutionEmailFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- Enhanced Features: New Lambda Functions & API Routes ---

    // Ticket Activity Log Lambda
    const ticketActivityFunction = new lambda.Function(this, 'TicketActivityFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/ticket-activity.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Satisfaction Rating Lambda
    const rateTicketFunction = new lambda.Function(this, 'RateTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/rate-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Canned Responses Lambda
    const cannedResponsesFunction = new lambda.Function(this, 'CannedResponsesFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/canned-responses.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Translate Lambda
    const translateFunction = new lambda.Function(this, 'TranslateFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/translate.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Merge Ticket Lambda
    const mergeTicketFunction = new lambda.Function(this, 'MergeTicketFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/merge-ticket.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // AI Solution Lambda
    const aiSolutionFunction = new lambda.Function(this, 'AISolutionFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/ai-solution.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // SLA Dashboard Lambda
    const slaDashboardFunction = new lambda.Function(this, 'SLADashboardFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/sla-dashboard.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // --- Enhanced Features: API Routes ---

    // GET /tickets/{ticketId}/activities
    const activitiesResource = ticketResource.addResource('activities');
    activitiesResource.addMethod('GET', new apigateway.LambdaIntegration(ticketActivityFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PUT /tickets/{ticketId}/rate
    const rateResource = ticketResource.addResource('rate');
    rateResource.addMethod('PUT', new apigateway.LambdaIntegration(rateTicketFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /tickets/{ticketId}/merge
    const mergeResource = ticketResource.addResource('merge');
    mergeResource.addMethod('POST', new apigateway.LambdaIntegration(mergeTicketFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /tickets/{ticketId}/ai-solution
    const aiSolutionResource = ticketResource.addResource('ai-solution');
    aiSolutionResource.addMethod('POST', new apigateway.LambdaIntegration(aiSolutionFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /admin/canned-responses - GET, POST
    const cannedResponsesResource = adminResource.addResource('canned-responses');
    cannedResponsesResource.addMethod('GET', new apigateway.LambdaIntegration(cannedResponsesFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    cannedResponsesResource.addMethod('POST', new apigateway.LambdaIntegration(cannedResponsesFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /admin/canned-responses/{responseId} - PUT, DELETE
    const cannedResponseResource = cannedResponsesResource.addResource('{responseId}');
    cannedResponseResource.addMethod('PUT', new apigateway.LambdaIntegration(cannedResponsesFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    cannedResponseResource.addMethod('DELETE', new apigateway.LambdaIntegration(cannedResponsesFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /translate
    const translateResource = api.root.addResource('translate');
    translateResource.addMethod('POST', new apigateway.LambdaIntegration(translateFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/sla-dashboard
    const slaDashboardResource = adminResource.addResource('sla-dashboard');
    slaDashboardResource.addMethod('GET', new apigateway.LambdaIntegration(slaDashboardFunction), {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // --- WebSocket API Gateway for Real-time Notifications ---

    // WebSocket Lambda handlers
    const wsConnectFunction = new lambda.Function(this, 'WsConnectFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/ws-connect.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    const wsDisconnectFunction = new lambda.Function(this, 'WsDisconnectFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/ws-disconnect.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    const wsDefaultFunction = new lambda.Function(this, 'WsDefaultFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'src/handlers/ws-default.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'NovaSupportWebSocketApi', {
      apiName: 'NovaSupport WebSocket API',
      description: 'WebSocket API for real-time ticket notifications',
      connectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('ConnectIntegration', wsConnectFunction),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('DisconnectIntegration', wsDisconnectFunction),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('DefaultIntegration', wsDefaultFunction),
      },
    });

    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'NovaSupportWebSocketStage', {
      webSocketApi,
      stageName: 'dev',
      autoDeploy: true,
    });

    // Add WebSocket endpoint URL to Lambda environment for broadcasting
    lambdaEnvironment['WEBSOCKET_API_ENDPOINT'] = webSocketStage.callbackUrl;

    // Grant API Gateway Management API permissions for WebSocket message posting
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/*`,
      ],
    }));

    // --- CloudWatch Dashboard & Alarms (Requirement 19.4) ---

    // Real-time metrics dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'NovaSupportDashboard', {
      dashboardName: 'NovaSupport-Metrics',
    });

    // Ticket Processing Queue metrics
    const queueMessagesVisible = this.ticketProcessingQueue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(1),
    });
    const queueMessagesDelayed = this.ticketProcessingQueue.metricApproximateNumberOfMessagesNotVisible({
      period: cdk.Duration.minutes(1),
    });
    const dlqMessages = deadLetterQueue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(1),
    });

    // API Gateway metrics
    const apiLatency = api.metricLatency({ period: cdk.Duration.minutes(1) });
    const api4xxErrors = api.metricClientError({ period: cdk.Duration.minutes(1) });
    const api5xxErrors = api.metricServerError({ period: cdk.Duration.minutes(1) });
    const apiCount = api.metricCount({ period: cdk.Duration.minutes(1) });

    // Lambda error metrics
    const createTicketErrors = createTicketFunction.metricErrors({ period: cdk.Duration.minutes(5) });
    const getTicketErrors = getTicketFunction.metricErrors({ period: cdk.Duration.minutes(5) });
    const uploadAttachmentErrors = uploadAttachmentFunction.metricErrors({ period: cdk.Duration.minutes(5) });

    // Lambda duration metrics
    const createTicketDuration = createTicketFunction.metricDuration({ period: cdk.Duration.minutes(5) });
    const getTicketDuration = getTicketFunction.metricDuration({ period: cdk.Duration.minutes(5) });

    // Row 1: API Gateway overview
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Request Volume',
        left: [apiCount],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Latency (ms)',
        left: [apiLatency],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Errors',
        left: [api4xxErrors, api5xxErrors],
        width: 8,
      }),
    );

    // Row 2: Queue and Lambda metrics
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Ticket Queue Depth',
        left: [queueMessagesVisible, queueMessagesDelayed],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Dead Letter Queue',
        left: [dlqMessages],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        left: [createTicketErrors, getTicketErrors, uploadAttachmentErrors],
        width: 8,
      }),
    );

    // Row 3: Lambda durations and DynamoDB
    const ddbReadCapacity = this.ticketsTable.metricConsumedReadCapacityUnits({
      period: cdk.Duration.minutes(5),
    });
    const ddbWriteCapacity = this.ticketsTable.metricConsumedWriteCapacityUnits({
      period: cdk.Duration.minutes(5),
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (ms)',
        left: [createTicketDuration, getTicketDuration],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Capacity',
        left: [ddbReadCapacity, ddbWriteCapacity],
        width: 12,
      }),
    );

    // --- Alarms ---

    // High API 5xx error rate alarm
    new cloudwatch.Alarm(this, 'HighApiErrorRateAlarm', {
      alarmName: 'NovaSupport-High5xxErrorRate',
      alarmDescription: 'API 5xx error rate exceeds threshold',
      metric: api5xxErrors,
      threshold: 10,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // High API latency alarm
    new cloudwatch.Alarm(this, 'HighApiLatencyAlarm', {
      alarmName: 'NovaSupport-HighApiLatency',
      alarmDescription: 'API p50 latency exceeds 5 seconds',
      metric: apiLatency,
      threshold: 5000,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // DLQ messages alarm (indicates processing failures)
    new cloudwatch.Alarm(this, 'DLQMessagesAlarm', {
      alarmName: 'NovaSupport-DLQMessages',
      alarmDescription: 'Messages appearing in dead letter queue',
      metric: dlqMessages,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Lambda error alarm (aggregate)
    new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'NovaSupport-LambdaErrors',
      alarmDescription: 'CreateTicket Lambda errors exceed threshold',
      metric: createTicketErrors,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Enable X-Ray tracing on API Gateway for distributed tracing
    const cfnStage = api.deploymentStage.node.defaultChild as cdk.CfnResource;
    cfnStage.addPropertyOverride('TracingEnabled', true);

    // Enable X-Ray tracing on Lambda functions
    createTicketFunction.addEnvironment('AWS_XRAY_TRACING_NAME', 'NovaSupport');
    getTicketFunction.addEnvironment('AWS_XRAY_TRACING_NAME', 'NovaSupport');
    uploadAttachmentFunction.addEnvironment('AWS_XRAY_TRACING_NAME', 'NovaSupport');

    const tracingPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'],
    });
    lambdaRole.addToPolicy(tracingPolicy);

    // Outputs
    new cdk.CfnOutput(this, 'TicketsTableName', {
      value: this.ticketsTable.tableName,
      description: 'DynamoDB table name for tickets',
    });

    new cdk.CfnOutput(this, 'AttachmentsBucketName', {
      value: this.attachmentsBucket.bucketName,
      description: 'S3 bucket name for attachments',
    });

    new cdk.CfnOutput(this, 'TicketProcessingQueueUrl', {
      value: this.ticketProcessingQueue.queueUrl,
      description: 'SQS queue URL for ticket processing',
    });

    new cdk.CfnOutput(this, 'MultimodalProcessingQueueUrl', {
      value: this.multimodalProcessingQueue.queueUrl,
      description: 'SQS queue URL for multimodal processing',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch log group name',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=NovaSupport-Metrics`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'PortalUserPoolId', {
      value: portalUserPool.userPoolId,
      description: 'Portal Cognito User Pool ID (for end users)',
    });

    new cdk.CfnOutput(this, 'PortalUserPoolClientId', {
      value: portalUserPoolClient.userPoolClientId,
      description: 'Portal Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'WebSocketApiEndpoint', {
      value: webSocketStage.url,
      description: 'WebSocket API endpoint URL for real-time notifications',
    });
  }
}
