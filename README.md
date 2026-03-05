# 🚀 NovaSupport — Agentic AI Support Ticket System

An intelligent, fully serverless support ticket system built on AWS that leverages **Amazon Nova** AI models to automate ticket routing, analysis, response generation, and escalation — with minimal human intervention.



---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [AWS Services Used](#aws-services-used)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Build & Deploy](#build--deploy)
- [Running the Frontends](#running-the-frontends)
- [Frontend Configuration](#frontend-configuration)
- [API Endpoints](#api-endpoints)
- [AI Agents](#ai-agents)
- [Services](#services)
- [Testing](#testing)
- [Monitoring & Observability](#monitoring--observability)

---

## Overview

NovaSupport is a three-portal support system:

| Portal | Description |
|--------|-------------|
| **Admin Portal** | Full dashboard for admins — manage tickets, teams, analytics, SLA, canned responses | 
| **User Portal** | End-user facing — submit tickets, track status, chat with AI assistant, rate resolutions | 
| **Team Portal** | For support agents — view assigned tickets, reply, resolve, translate messages |

All three portals share a single REST API backend deployed on AWS Lambda + API Gateway, with DynamoDB as the data store.

---

## Key Features

**AI-Powered Automation**
- Automatic ticket routing to the correct team using Amazon Nova
- Round-robin assignment to team members within the assigned team
- AI-generated response suggestions for agents
- Intelligent escalation detection (security/legal keywords, low AI confidence, max retries)
- Multimodal attachment analysis (images, documents, videos) via Nova
- AI solution generation from knowledge base
- Semantic similar-ticket search using Nova Embeddings

**Ticket Management**
- Create, edit, delete, merge tickets
- File attachments with S3 presigned URLs
- Ticket activity/audit log
- Status workflow: open → in-progress → escalated → resolved
- Satisfaction ratings on resolved tickets
- Canned responses for common issues

**Communication**
- Real-time messaging between agents and users
- AI live chat assistant for end users
- Multi-language translation (Amazon Translate + Comprehend auto-detection)
- Translate dropdown on replies, messages, and resolutions
- Voice input (transcription via Amazon Transcribe) and text-to-speech (Amazon Polly)
- Resolution email notifications via Amazon SES
- Real-time WebSocket notifications

**Operations**
- SLA tracking and dashboard
- Analytics engine with trend detection
- CloudWatch dashboard with alarms
- Automated follow-up scheduling (EventBridge every 15 min)
- Knowledge base search

---

## Architecture

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Admin Portal   │  │  User Portal    │  │  Team Portal    │
│                    │  │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   API Gateway     │◄──── Cognito Authorizer
                    │   (REST + WS)     │      (2 User Pools)
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐ ┌─────▼─────┐ ┌───────▼───────┐
     │  Lambda Fns   │ │  SQS      │ │  EventBridge  │
     │  (30+ fns)    │ │  Queues   │ │  (Scheduled)  │
     └───────┬───────┘ └─────┬─────┘ └───────────────┘
             │               │
    ┌────────┼────────┬──────┼──────┬───────────┐
    │        │        │      │      │           │
┌───▼──┐ ┌──▼───┐ ┌──▼──┐ ┌▼────┐ ┌▼────────┐ ┌▼──────────┐
│Dynamo│ │  S3  │ │Nova │ │SES  │ │Translate│ │Polly/     │
│  DB  │ │      │ │(AI) │ │     │ │Comprehnd│ │Transcribe │
└──────┘ └──────┘ └─────┘ └─────┘ └─────────┘ └───────────┘
```

---

## AWS Services Used

| Service | Purpose |
|---------|---------|
| **Amazon DynamoDB** | Single-table design for tickets, teams, messages, activities, knowledge base |
| **Amazon S3** | Attachment storage with presigned URLs, 90-day lifecycle |
| **AWS Lambda** | 30+ serverless functions (Node.js 20.x) |
| **Amazon API Gateway** | REST API (with Cognito auth) + WebSocket API |
| **Amazon SQS** | Async ticket processing queue + multimodal processing queue (with DLQs) |
| **Amazon Cognito** | Two user pools — Admin/Agent pool and Portal (end-user) pool |
| **Amazon Bedrock (Nova)** | Nova Lite for AI reasoning, Nova Embeddings for semantic search |
| **Amazon Translate** | Multi-language ticket/message translation |
| **Amazon Comprehend** | Auto-detect source language |
| **Amazon Polly** | Text-to-speech for voice responses |
| **Amazon Transcribe** | Voice-to-text transcription |
| **Amazon SES** | Resolution email notifications |
| **Amazon CloudWatch** | Dashboard, alarms, logs, X-Ray tracing |
| **Amazon EventBridge** | Scheduled follow-up processing (every 15 min) |
| **AWS CDK** | Infrastructure as Code (TypeScript) |

---



---

## Prerequisites

- **Node.js** 20.x or later
- **AWS CLI** configured with credentials (`aws configure`)
- **AWS CDK CLI** (`npm install -g aws-cdk`)
- **AWS Account** with access to Bedrock (Amazon Nova models enabled in us-east-1)

---

## Installation

```bash
npm install
```

---

## Build & Deploy

```bash
# Compile TypeScript
npx tsc

# Deploy infrastructure to AWS (first time may take ~5 min)
npx cdk deploy --require-approval never
```

If this is your first CDK deployment in the account/region:

```bash
npx cdk bootstrap
```

After deployment, CDK outputs the API Gateway URL, Cognito User Pool IDs, WebSocket endpoint, and other resource identifiers. Update the `config.js` in each portal with these values.

---

## Running the Frontends

The three portals are static HTML/JS/CSS apps. Serve them locally with any static file server:

```bash
# Admin Portal
npx http-server frontend -p 3000

# User Portal
npx http-server user-portal -p 3001

# Team Member Portal
npx http-server team-portal -p 3002
```

Then open in your browser:
- Admin: `http://localhost:3000`
- User: `http://localhost:3001`
- Team: `http://localhost:3002`

---



## AI Agents

| Agent | File | Purpose |
|-------|------|---------|
| **Routing Agent** | `src/agents/routing-agent.ts` | Analyzes ticket content with Nova and assigns to the correct team (e.g., billing, auth, general) |
| **Assignment Agent** | `src/agents/assignment-agent.ts` | Round-robin assignment of tickets to eligible team members |
| **Escalation Agent** | `src/agents/escalation-agent.ts` | Flags tickets for human review based on: security/legal/compliance keywords, low AI confidence (<0.7), max retry attempts, complex multi-issue tickets |
| **Response Agent** | `src/agents/response-agent.ts` | Generates contextual AI response suggestions using ticket history and knoup Scheduler | `follow-up-scheduler.ts` | Schedules and processes follow-up messages |
| Knowledge Base | `knowledge-base.ts` | CRUD + semantic search for support articles |
| Notification Service | `notification-service.ts` | Push notifications via WebSocket |
| Semantic Search | `semantic-search.ts` | Embedding-based vector search using Nova Embeddings |
| Similar Ticket Search | `similar-ticket-search.ts` | Finds related tickets by semantic similarity |
| SLA Tracker | `sla-tracker.ts` | Monitors response/resolution SLA compliance |
| Solution Knowledge Base | `solution-knowledge-base.ts` | Stores and retrieves proven solutions |
| Ticket Prioritization | `ticket-prioritization.ts` | Scores ticket priority based on content analysis |
| Translation Service | `translation-service.ts` | Wraps Amazon Translate with auto language detection |
| Voice Processor | `voice-processor.ts` | Handles voice transcription and TTS |
| Workflow Orchestrator | `workflow-orchestrator.ts` | End-to-end ticket processing pipeline |

---


## Monitoring & Observability

- **CloudWatch Dashboard**: `NovaSupport-Metrics` — API request volume, latency, errors, queue depth, DynamoDB capacity
- **Alarms**: High 5xx error rate, high API latency, DLQ messages, Lambda errors
- **X-Ray Tracing**: Enabled on API Gateway and key Lambda functions
- **Logs**: All Lambda functions log to `/aws/novasupport` CloudWatch log group

---


