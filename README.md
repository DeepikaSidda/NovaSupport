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

| Portal | Description | Default Port |
|--------|-------------|-------------|
| **Admin Portal** | Full dashboard for admins — manage tickets, teams, analytics, SLA, canned responses | `3000` |
| **User Portal** | End-user facing — submit tickets, track status, chat with AI assistant, rate resolutions | `3001` |
| **Team Portal** | For support agents — view assigned tickets, reply, resolve, translate messages | `3002` |

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
