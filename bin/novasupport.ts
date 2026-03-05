#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NovaSupportStack } from '../lib/novasupport-stack';

const app = new cdk.App();

new NovaSupportStack(app, 'NovaSupportStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'NovaSupport - Agentic AI Support Ticket System',
});

app.synth();
