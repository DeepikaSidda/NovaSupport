# Implementation Plan: AI Live Chat Assistant

## Overview

Implement the AI-powered live chat assistant for the NovaSupport user portal. The implementation follows an incremental approach: types and utilities first, then the core handler logic, then the frontend widget, and finally CDK infrastructure wiring.

## Tasks

- [x] 1. Define chat types and utility functions
  - [x] 1.1 Create chat types in `src/types/chat.ts`
    - Define `ChatMessage`, `ChatRequest`, `ChatResponse`, `IssueCategory`, `ChatMessageRecord`, `ChatSessionRecord` interfaces
    - Define `CATEGORY_TEAM_MAP` constant mapping categories to team IDs
    - _Requirements: 1.2, 2.1, 2.2, 3.2_
  - [x] 1.2 Add chat helper functions to `src/utils/helpers.ts`
    - Add `generateSessionId()` returning `CHAT-{uuid}`
    - Add `generateChatMessageSK(timestamp)` returning `MESSAGE#{timestamp}`
    - _Requirements: 2.1, 2.3_

- [x] 2. Implement chat assistant handler core logic
  - [x] 2.1 Create `src/handlers/chat-assistant.ts` with request validation and routing
    - Implement `handler(event)` Lambda entry point with CORS headers
    - Implement `validateChatRequest(body)` that checks for required fields (message, sessionId, userId)
    - Route to `processMessage` or `handleEscalation` based on `action` field
    - Return 400 for invalid requests, 500 for internal errors
    - _Requirements: 5.1, 5.4_
  - [x] 2.2 Implement `classifyIssue(message, history)` in the handler
    - Build classification prompt using Nova AI
    - Parse response and validate it's one of the four valid categories
    - Default to "general" if classification fails or returns unexpected value
    - _Requirements: 1.2_
  - [x] 2.3 Implement `calculateChatConfidence(kbResults, similarTickets)` in the handler
    - Compute confidence from KB relevance scores and similar ticket similarity scores
    - Clamp result to [0, 1]
    - _Requirements: 1.4_
  - [x] 2.4 Implement `processMessage(request)` orchestration
    - Store user message in DynamoDB with `CHAT#{sessionId}` / `MESSAGE#{timestamp}`
    - Call `classifyIssue` to get category
    - Search knowledge base and similar tickets for context
    - Call Nova AI to generate response using classification, KB results, and similar tickets
    - Calculate confidence score
    - Store assistant message in DynamoDB
    - Return response with confidence, category, suggested actions, and referenced articles
    - Handle Nova unavailability with fallback response
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 2.1, 5.3_
  - [x] 2.5 Implement `handleEscalation(request)` 
    - Retrieve full chat history from DynamoDB for the session
    - Build ticket description from chat transcript (all messages)
    - Build ticket subject including conversation summary and issue category
    - Create ticket using existing `putItem` and `sendTicketForProcessing` pattern
    - Map category to team using `CATEGORY_TEAM_MAP`
    - Update chat session metadata with escalated ticket ID
    - Return ticket ID and assigned team
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Checkpoint
  - Ensure all handler code compiles, ask the user if questions arise.

- [x] 4. Write unit tests for chat assistant handler
  - [x] 4.1 Create `test/chat-assistant.test.ts`
    - Test `validateChatRequest` with valid and invalid inputs (missing message, sessionId, userId)
    - Test `classifyIssue` returns valid category for billing/technical/account/general messages (mock Nova)
    - Test `classifyIssue` defaults to "general" on unexpected Nova output
    - Test `calculateChatConfidence` returns value in [0, 1] for various inputs (empty arrays, high scores, mixed)
    - Test `processMessage` orchestration calls KB and similar ticket services (mock all dependencies)
    - Test `processMessage` returns fallback when Nova is unavailable
    - Test `handleEscalation` creates ticket with full transcript and correct team mapping
    - Test `handleEscalation` includes category in ticket subject
    - Test chat message record has correct PK/SK format
    - Test category-to-team mapping for all four categories
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.4, 5.3, 5.4_

- [x] 5. Implement chat widget frontend
  - [x] 5.1 Create `user-portal/portal-chat.js`
    - Implement `PortalChat` IIFE module following existing portal patterns
    - `init()`: create floating chat button (bottom-right), chat window container, message area, input bar
    - `toggle()`: open/close chat window, show greeting on first open
    - `sendMessage()`: send user message via `PortalAPI.sendChatMessage()`, show typing indicator
    - `handleResponse(data)`: display AI response, remove typing indicator, show escalation button and feedback icons
    - `escalate()`: show confirmation dialog, call `PortalAPI.sendChatMessage()` with `action: 'escalate'`, display ticket ID and team
    - `renderMessages()`: render full message history with user/assistant styling
    - `showTyping()` / `hideTyping()`: animated typing indicator (three dots)
    - `sendFeedback(type)`: handle thumbs up/down (log to console for now)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 5.2 Add `sendChatMessage` method to `user-portal/portal-api.js`
    - Add `sendChatMessage(payload)` that calls `POST /chat` with the chat request body
    - _Requirements: 5.1_
  - [x] 5.3 Add chat widget CSS to `user-portal/portal-styles.css`
    - Floating button styles (fixed position, bottom-right, circular, accent color)
    - Chat window styles (380px wide, 500px tall, dark theme matching portal)
    - Message bubble styles (user right-aligned accent, assistant left-aligned surface)
    - Typing indicator animation (three bouncing dots)
    - Escalation button and feedback icon styles
    - Responsive styles for mobile
    - _Requirements: 4.1, 4.2, 4.5, 4.8_
  - [x] 5.4 Wire chat widget into `user-portal/index.html` and `user-portal/portal-app.js`
    - Add `<script src="portal-chat.js"></script>` to index.html before portal-app.js
    - Call `PortalChat.init()` in `PortalApp.init()` after auth check
    - _Requirements: 4.1_

- [x] 6. Checkpoint
  - Ensure all tests pass and the frontend code is complete, ask the user if questions arise.

- [x] 7. CDK infrastructure updates
  - [x] 7.1 Add chat Lambda and API route to `lib/novasupport-stack.ts`
    - Add `ChatAssistantFunction` Lambda with handler `src/handlers/chat-assistant.handler`, timeout 30s, memory 1024 MB
    - Add `/chat` resource to API Gateway
    - Add POST method with Cognito authorizer
    - Use same `lambdaRole`, `lambdaEnvironment`, and `lambda.Code.fromAsset('dist')` as other handlers
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 8. Final checkpoint
  - Ensure all tests pass and code compiles, ask the user if questions arise.
