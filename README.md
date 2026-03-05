# 🚀 NovaSupport — Agentic AI Support Ticket System

An intelligent, fully serverless support ticket system built on AWS that leverages **Amazon Nova** AI models to automate ticket routing, analysis, response generation, and escalation — with minimal human intervention.

Built for the **AWS Nova Hackathon**.

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

## Project Structure

```
novasupport/
├── bin/                        # CDK app entry point
├── lib/
│   └── novasupport-stack.ts    # Full infrastructure definition (CDK)
├── src/
│   ├── agents/                 # AI agent logic
│   │   ├── routing-agent.ts        # Routes tickets to correct team
│   │   ├── assignment-agent.ts     # Round-robin member assignment
│   │   ├── escalation-agent.ts     # Detects when to escalate
│   │   └── response-agent.ts       # Generates AI responses
│   ├── handlers/               # Lambda function handlers
│   │   ├── create-ticket.ts        # POST /tickets
│   │   ├── get-ticket.ts           # GET /tickets/{id}
│   │   ├── list-tickets.ts         # GET /tickets
│   │   ├── edit-ticket.ts          # PUT /tickets/{id}
│   │   ├── delete-ticket.ts        # DELETE /tickets/{id}
│   │   ├── update-ticket-status.ts # PUT /tickets/{id}/status
│   │   ├── analyze-ticket.ts       # POST /tickets/{id}/analyze (multimodal)
│   │   ├── resolve-ticket.ts       # PUT /tickets/{id}/resolve
│   │   ├── upload-attachment.ts    # POST /tickets/{id}/attachments
│   │   ├── get-attachments.ts      # GET /tickets/{id}/attachments
│   │   ├── ticket-messages.ts      # GET/POST /tickets/{id}/messages
│   │   ├── ticket-activity.ts      # GET /tickets/{id}/activities
│   │   ├── merge-ticket.ts         # POST /tickets/{id}/merge
│   │   ├── rate-ticket.ts          # PUT /tickets/{id}/rate
│   │   ├── search-similar.ts       # GET /tickets/{id}/similar
│   │   ├── ai-solution.ts          # POST /tickets/{id}/ai-solution
│   │   ├── chat-assistant.ts       # POST /chat
│   │   ├── translate.ts            # POST /translate
│   │   ├── voice-transcribe.ts     # POST /voice/transcribe
│   │   ├── voice-tts.ts            # POST /voice/tts
│   │   ├── get-analytics.ts        # GET /admin/analytics
│   │   ├── sla-dashboard.ts        # GET /admin/sla-dashboard
│   │   ├── list-teams.ts           # GET /admin/teams
│   │   ├── team-members.ts         # GET/POST/DELETE /admin/teams/{id}/members
│   │   ├── canned-responses.ts     # CRUD /admin/canned-responses
│   │   ├── search-knowledge.ts     # GET/POST /knowledge-base
│   │   ├── get-notifications.ts    # GET/PUT /notifications
│   │   ├── send-resolution-email.ts# POST /tickets/{id}/send-resolution-email
│   │   ├── cognito-custom-message.ts # Cognito trigger for styled emails
│   │   ├── process-ticket-queue.ts # SQS consumer (auto-route + assign)
│   │   ├── process-follow-ups.ts   # EventBridge scheduled follow-ups
│   │   ├── ws-connect.ts           # WebSocket $connect
│   │   ├── ws-disconnect.ts        # WebSocket $disconnect
│   │   └── ws-default.ts           # WebSocket $default
│   ├── services/               # Business logic
│   │   ├── analytics-engine.ts     # Metrics and trend detection
│   │   ├── auto-tagger.ts          # Auto-tag tickets by content
│   │   ├── document-analyzer.ts    # Document attachment analysis
│   │   ├── image-analyzer.ts       # Image attachment analysis
│   │   ├── video-analyzer.ts       # Video attachment analysis
│   │   ├── follow-up-scheduler.ts  # Schedule follow-up messages
│   │   ├── knowledge-base.ts       # Knowledge base CRUD + search
│   │   ├── notification-service.ts # Push notifications
│   │   ├── semantic-search.ts      # Embedding-based search
│   │   ├── similar-ticket-search.ts# Find similar tickets
│   │   ├── sla-tracker.ts          # SLA monitoring
│   │   ├── solution-knowledge-base.ts # Solution storage
│   │   ├── ticket-prioritization.ts# Priority scoring
│   │   ├── translation-service.ts  # Amazon Translate wrapper
│   │   ├── voice-processor.ts      # Voice I/O processing
│   │   └── workflow-orchestrator.ts# End-to-end ticket workflow
│   ├── types/                  # TypeScript type definitions
│   └── utils/                  # Shared utilities (DynamoDB client, Nova client, etc.)
├── frontend/                   # Admin Portal (static HTML/JS/CSS)
│   ├── index.html
│   ├── app.js
│   ├── api.js
│   ├── auth.js
│   ├── config.js
│   └── styles.css
├── user-portal/                # User Portal (static HTML/JS/CSS)
│   ├── index.html
│   ├── portal-app.js
│   ├── portal-api.js
│   ├── portal-auth.js
│   ├── portal-chat.js
│   ├── portal-views.js
│   ├── portal-validation.js
│   ├── portal-file-upload.js
│   ├── config.js
│   └── portal-styles.css
├── team-portal/                # Team Member Portal (static HTML/JS/CSS)
│   ├── index.html
│   ├── agent-app.js
│   ├── agent-api.js
│   ├── agent-auth.js
│   ├── agent-views.js
│   ├── config.js
│   └── agent-styles.css
├── test/                       # Unit tests + property-based tests
├── scripts/                    # Utility scripts (Cognito, DynamoDB seeding, monitoring)
├── cdk.json                    # CDK configuration
├── tsconfig.json               # TypeScript configuration
└── package.json                # Dependencies and scripts
```

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

## Frontend Configuration

Each portal has a `config.js` file that must point to your deployed stack:

**Admin Portal & Team Portal** (`frontend/config.js`, `team-portal/config.js`):
```js
const CONFIG = {
  API_URL: 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com/dev',
  COGNITO: {
    REGION: 'us-east-1',
    USER_POOL_ID: '<admin-user-pool-id>',
    CLIENT_ID: '<admin-client-id>',
  },
  WS_URL: 'wss://<your-ws-api-id>.execute-api.us-east-1.amazonaws.com/dev',
};
```

**User Portal** (`user-portal/config.js`):
```js
const CONFIG = {
  API_URL: 'https://<your-api-id>.execute-api.us-east-1.amazonaws.com/dev',
  COGNITO: {
    REGION: 'us-east-1',
    USER_POOL_ID: '<portal-user-pool-id>',
    CLIENT_ID: '<portal-client-id>',
  },
  WS_URL: 'wss://<your-ws-api-id>.execute-api.us-east-1.amazonaws.com/dev',
};
```

The Admin and Team portals share the same Cognito User Pool (admins + agents). The User Portal has a separate Cognito User Pool for end users.

---

## API Endpoints

All endpoints require a Cognito JWT token in the `Authorization` header.

### Tickets
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tickets` | Create a new ticket |
| `GET` | `/tickets` | List all tickets (supports `?status=` filter) |
| `GET` | `/tickets/{ticketId}` | Get ticket details |
| `PUT` | `/tickets/{ticketId}` | Edit ticket fields |
| `DELETE` | `/tickets/{ticketId}` | Permanently delete a ticket |
| `PUT` | `/tickets/{ticketId}/status` | Update ticket status |
| `PUT` | `/tickets/{ticketId}/resolve` | Resolve ticket with solution |
| `PUT` | `/tickets/{ticketId}/rate` | Submit satisfaction rating |
| `POST` | `/tickets/{ticketId}/merge` | Merge duplicate tickets |
| `POST` | `/tickets/{ticketId}/analyze` | Trigger AI analysis (multimodal) |
| `POST` | `/tickets/{ticketId}/ai-solution` | Generate AI solution |
| `GET` | `/tickets/{ticketId}/similar` | Find similar tickets |
| `GET` | `/tickets/{ticketId}/activities` | Get activity/audit log |
| `POST` | `/tickets/{ticketId}/send-resolution-email` | Email resolution to user |

### Attachments
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tickets/{ticketId}/attachments` | Upload attachment (returns presigned URL) |
| `GET` | `/tickets/{ticketId}/attachments` | List attachments with download URLs |

### Messages
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets/{ticketId}/messages` | Get ticket messages |
| `POST` | `/tickets/{ticketId}/messages` | Send a message |

### AI & Voice
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | AI chat assistant |
| `POST` | `/translate` | Translate text to target language |
| `POST` | `/voice/transcribe` | Voice-to-text |
| `POST` | `/voice/tts` | Text-to-speech |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/analytics` | Dashboard analytics |
| `GET` | `/admin/sla-dashboard` | SLA metrics |
| `GET` | `/admin/teams` | List all teams |
| `GET/POST/DELETE` | `/admin/teams/{teamId}/members` | Manage team members |
| `GET/POST` | `/admin/canned-responses` | Manage canned responses |
| `PUT/DELETE` | `/admin/canned-responses/{responseId}` | Update/delete canned response |

### Other
| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/knowledge-base` | Search or add knowledge base articles |
| `GET/PUT` | `/notifications` | Get or update notifications |

### WebSocket
| Route | Description |
|-------|-------------|
| `$connect` | Client connects (stores connection ID) |
| `$disconnect` | Client disconnects (removes connection) |
| `$default` | Handles incoming WebSocket messages |

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


