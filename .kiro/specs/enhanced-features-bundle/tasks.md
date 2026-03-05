# Implementation Plan: Enhanced Features Bundle

## Overview

This plan implements 8 features across the NovaSupport system: AI-Suggested Solutions, Satisfaction Rating Widget, Ticket Timeline/Activity Log, Canned Responses, Multi-language Support, Real-time WebSocket Notifications, Admin SLA Dashboard, and Ticket Merge. All backend code is TypeScript (Lambda handlers, services). Frontends are vanilla JS/HTML (`frontend/` for admin, `user-portal/` for users). Infrastructure is CDK. DynamoDB single-table design with PK/SK patterns.

## Tasks

- [x] 1. Implement Ticket Timeline/Activity Log (backend)
  - [x] 1.1 Create `src/handlers/ticket-activity.ts` Lambda handler for activity log CRUD
    - Implement GET `/tickets/{ticketId}/activities` to query Activity_Records (PK `TICKET#<ticketId>`, SK begins_with `ACTIVITY#`) sorted by timestamp ascending
    - Support pagination with `limit=50` and `lastKey` query params; return `nextKey` when more entries exist
    - Implement a helper function `createActivityRecord(ticketId, type, actor, details)` that writes an Activity_Record with SK `ACTIVITY#<timestamp>#<uuid>`
    - Activity types: `status_change`, `message`, `assignment`, `resolution`, `escalation`, `merge`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.9_

  - [x] 1.2 Wire activity creation into existing handlers
    - In `src/handlers/update-ticket-status.ts`: after status update, call `createActivityRecord` with type `status_change`, old/new status, and actor
    - In `src/handlers/ticket-messages.ts`: after message creation, call `createActivityRecord` with type `message`, sender, and content preview (first 100 chars)
    - In `src/handlers/resolve-ticket.ts`: after resolution, call `createActivityRecord` with type `resolution` and resolver userId
    - Import and call `createActivityRecord` from `ticket-activity.ts` (export the helper)
    - _Requirements: 3.1, 3.2, 3.4_

  - [ ]* 1.3 Write unit tests for ticket-activity handler
    - Create `test/ticket-activity.test.ts`
    - Test: createActivityRecord writes correct DynamoDB item with proper PK/SK pattern
    - Test: GET returns activities sorted by timestamp ascending
    - Test: pagination returns 50 items per page with nextKey
    - Test: each activity type stores correct detail fields
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.9_

- [x] 2. Implement Satisfaction Rating Widget (backend)
  - [x] 2.1 Create `src/handlers/rate-ticket.ts` Lambda handler
    - Implement PUT `/tickets/{ticketId}/rate` accepting `{ rating: number, feedback?: string }`
    - Validate rating is integer 1–5; validate feedback is max 500 characters
    - Validate ticket status is `resolved` or `closed`; return 400 if not
    - Update Ticket_Record with `satisfactionRating` and `satisfactionFeedback` attributes
    - Write a MetricRecord with type `satisfaction` and the rating value
    - If rating already exists, overwrite with new values (upsert behavior)
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 2.2 Write unit tests for rate-ticket handler
    - Create `test/rate-ticket.test.ts`
    - Test: valid rating (1–5) updates ticket record and writes metric
    - Test: rating on non-resolved ticket returns 400
    - Test: feedback over 500 chars returns 400
    - Test: re-rating overwrites previous values
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 3. Checkpoint - Activity log and rating backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Canned Responses (backend)
  - [x] 4.1 Create `src/handlers/canned-responses.ts` Lambda handler with CRUD operations
    - GET `/admin/canned-responses`: scan Canned_Response_Records (PK begins_with `CANNED_RESPONSE#`), sort by category then title alphabetically
    - POST `/admin/canned-responses`: validate title non-empty, body non-empty, category is valid ticket category; generate unique ID; store Canned_Response_Record with PK `CANNED_RESPONSE#<id>`, SK `METADATA`
    - PUT `/admin/canned-responses/{responseId}`: update existing record's title, body, category
    - DELETE `/admin/canned-responses/{responseId}`: delete the record
    - On POST, check for duplicate title within same category; return 409 if exists
    - Store `createdBy`, `createdAt`, `updatedAt` timestamps
    - _Requirements: 4.1, 4.2, 4.7, 4.8, 4.9_

  - [ ]* 4.2 Write unit tests for canned-responses handler
    - Create `test/canned-responses.test.ts`
    - Test: CRUD operations work correctly
    - Test: duplicate title+category returns 409
    - Test: empty title or body returns 400
    - Test: list returns sorted by category then title
    - _Requirements: 4.1, 4.2, 4.7, 4.8, 4.9_

- [x] 5. Implement Multi-language Support (backend)
  - [x] 5.1 Create `src/services/translation-service.ts` wrapping Amazon Translate
    - Implement `detectAndTranslate(text, targetLang?)` using Amazon Translate `TranslateText` API with auto-detection for source language
    - Return `{ originalText, detectedLanguage, translatedText, targetLanguage }`
    - On Translate failure, return original text with `translationFailed: true`
    - _Requirements: 5.1, 5.6, 5.8_

  - [x] 5.2 Create `src/handlers/translate.ts` Lambda handler
    - Implement POST `/translate` accepting `{ text, targetLanguage }` and returning a Translation_Result
    - Call `detectAndTranslate` from translation-service
    - _Requirements: 5.7, 5.8_

  - [x] 5.3 Wire translation into ticket creation and messaging
    - In `src/handlers/create-ticket.ts`: after ticket creation, call `detectAndTranslate` on subject+description; update Ticket_Record with `detectedLanguage`, `translatedSubject`, `translatedDescription` if non-English
    - In `src/handlers/ticket-messages.ts`: when admin sends message on a ticket with non-English `detectedLanguage`, translate admin message and store `translatedContent` on Message_Record
    - Wrap translation calls in try/catch; set `translationFailed: true` on failure
    - _Requirements: 5.1, 5.2, 5.4, 5.6_

  - [ ]* 5.4 Write unit tests for translation service and handler
    - Create `test/translation-service.test.ts`
    - Test: detectAndTranslate returns correct structure
    - Test: failure sets translationFailed flag
    - Test: translate handler returns Translation_Result
    - _Requirements: 5.1, 5.6, 5.7, 5.8_

- [x] 6. Implement Ticket Merge (backend)
  - [x] 6.1 Create `src/handlers/merge-ticket.ts` Lambda handler
    - Implement POST `/tickets/{ticketId}/merge` accepting `{ primaryTicketId }`
    - Validate: ticketId !== primaryTicketId (return 400 "A ticket cannot be merged into itself")
    - Validate: duplicate ticket has no existing `mergedInto` attribute (return 400 "This ticket has already been merged")
    - Append duplicate's description to primary ticket's description with separator `\n\n--- Merged from ticket #<duplicateTicketId> ---\n\n`
    - Copy all Message_Records from duplicate to primary ticket (re-key PK to primary ticketId, preserve timestamps and userIds)
    - Copy attachment references from duplicate to primary's `attachmentIds` array
    - Set duplicate ticket status to `closed`, add `mergedInto: primaryTicketId`
    - Create Merge_Record: PK `TICKET#<duplicateTicketId>`, SK `MERGE_INFO` with primaryTicketId, mergedAt, mergedBy
    - Create Activity_Records on both tickets with type `merge`
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.11, 8.12_

  - [ ]* 6.2 Write unit tests for merge-ticket handler
    - Create `test/merge-ticket.test.ts`
    - Test: successful merge copies messages, attachments, closes duplicate
    - Test: self-merge returns 400
    - Test: already-merged ticket returns 400
    - Test: activity records created on both tickets
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.11, 8.12_

- [x] 7. Implement SLA Dashboard (backend)
  - [x] 7.1 Create `src/handlers/sla-dashboard.ts` Lambda handler
    - Implement GET `/admin/sla-dashboard` that fetches all open tickets
    - For each ticket, compute SLA status using `getSLAStatus` from sla-tracker service
    - Compute aggregate metrics: total open, breached count, at-risk count (within 30 min of breach), compliance percentage, average response time, average resolution time
    - Compute per-priority breakdown: for each priority level (Critical, High, Medium, Low), return breach count and compliance percentage
    - Return breached tickets list with ticketId, subject, priority, timeSinceBreach, assignedTeam
    - Return at-risk tickets list with ticketId, subject, priority, timeRemaining, assignedTeam
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.7, 7.9_

  - [ ]* 7.2 Write unit tests for sla-dashboard handler
    - Create `test/sla-dashboard.test.ts`
    - Test: computes correct breach/at-risk counts
    - Test: compliance percentage calculation (non-breached / total)
    - Test: per-priority breakdown is correct
    - Test: color-code thresholds (green >90%, yellow 70-90%, red <70%)
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9_

- [x] 8. Checkpoint - All backend handlers complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Real-time WebSocket Notifications (backend)
  - [x] 9.1 Create WebSocket Lambda handlers
    - Create `src/handlers/ws-connect.ts`: on `$connect`, extract userId from query string auth token, store WebSocket_Connection record in DynamoDB with PK `WSCONN#<connectionId>`, SK `METADATA`, userId, connectedAt
    - Create `src/handlers/ws-disconnect.ts`: on `$disconnect`, delete the WebSocket_Connection record
    - Create `src/handlers/ws-default.ts`: on `$default`, handle ping/pong or echo for connection keep-alive
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 9.2 Add WebSocket broadcast to notification service
    - In `src/services/notification-service.ts`, add `broadcastToUser(userId, message)` function
    - Query DynamoDB for all WebSocket_Connection records with matching userId (use GSI or scan with filter on userId)
    - For each connection, use `@aws-sdk/client-apigatewaymanagementapi` `PostToConnectionCommand` to send JSON message
    - Handle stale connections (410 GoneException) by deleting the connection record
    - _Requirements: 6.4, 6.5_

  - [x] 9.3 Wire WebSocket broadcasts into ticket lifecycle
    - In `src/handlers/update-ticket-status.ts`: after status change, call `broadcastToUser` for ticket owner and assigned admin with `{ type: "ticket_update", ticketId, status, timestamp }`
    - In `src/handlers/ticket-messages.ts`: after message creation, call `broadcastToUser` for relevant users with `{ type: "new_message", ticketId, sender, contentPreview }`
    - Wrap broadcast calls in try/catch so failures don't block the main operation
    - _Requirements: 6.4, 6.5_

  - [ ]* 9.4 Write unit tests for WebSocket handlers
    - Create `test/ws-handlers.test.ts`
    - Test: connect stores connection record with correct PK/SK
    - Test: disconnect deletes connection record
    - Test: broadcastToUser sends to all active connections for a user
    - Test: stale connection (410) is cleaned up
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 10. Update CDK infrastructure for all new features
  - [x] 10.1 Update `lib/novasupport-stack.ts` with new Lambda functions and API routes
    - Add Lambda functions: `ticket-activity`, `rate-ticket`, `canned-responses`, `translate`, `merge-ticket`, `sla-dashboard`
    - Add API Gateway REST routes: GET `/tickets/{ticketId}/activities`, PUT `/tickets/{ticketId}/rate`, CRUD `/admin/canned-responses`, POST `/translate`, POST `/tickets/{ticketId}/merge`, GET `/admin/sla-dashboard`
    - Add WebSocket API Gateway with `$connect`, `$disconnect`, `$default` routes backed by `ws-connect`, `ws-disconnect`, `ws-default` Lambda handlers
    - Grant DynamoDB read/write permissions to all new Lambdas
    - Grant Amazon Translate permissions to `translate` and `create-ticket` Lambdas
    - Grant API Gateway Management API permissions to notification service Lambda for WebSocket posting
    - Output the WebSocket API endpoint URL
    - _Requirements: 4.1, 5.7, 6.1, 7.9, 8.12_

- [x] 11. Checkpoint - Backend and infrastructure complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement AI-Suggested Solutions UI (Admin Portal)
  - [x] 12.1 Add suggested solutions API methods to `frontend/api.js`
    - Add `getSuggestedSolutions(ticketId)` calling GET `/tickets/{ticketId}/similar` (uses existing search-similar handler which calls `findMatchingSolutions`)
    - Add `searchKnowledgeFallback(query)` calling POST `/knowledge-base` for fallback article search
    - Add `recordSolutionFeedback(solutionId, wasHelpful)` calling POST `/solutions/{solutionId}/feedback`
    - _Requirements: 1.1, 1.5, 1.6, 1.7_

  - [x] 12.2 Add Suggested Solutions panel to ticket detail view in `frontend/app.js`
    - When ticket detail loads, automatically fetch suggested solutions
    - Display loading indicator while search is in progress
    - Render up to 5 solutions showing: problem summary, resolution text, similarity score %, success rate %
    - Add "Apply Solution" button that populates the resolution text field
    - Add "Helpful" / "Not Helpful" buttons that call `recordSolutionFeedback`
    - If no solutions found (similarity < 0.5), fall back to knowledge base article search
    - If both return empty, show "No suggested solutions found for this ticket."
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 13. Implement Satisfaction Rating Widget UI (User Portal)
  - [x] 13.1 Add rating API method to `user-portal/portal-api.js`
    - Add `rateTicket(ticketId, rating, feedback)` calling PUT `/tickets/{ticketId}/rate`
    - _Requirements: 2.3_

  - [x] 13.2 Add satisfaction rating widget to ticket detail view in `user-portal/portal-app.js`
    - When viewing a resolved/closed ticket, render 5 clickable star icons
    - On star click, highlight all stars up to and including the selected one
    - Show optional text feedback textarea with 500-char limit and character counter
    - Submit button calls `rateTicket` API
    - On revisit, display previously submitted rating (read from ticket data `satisfactionRating`, `satisfactionFeedback`)
    - _Requirements: 2.1, 2.2, 2.3, 2.8, 2.9_

  - [x] 13.3 Add rating widget styles to `user-portal/portal-styles.css`
    - Style star icons with hover/active states, gold fill for selected stars
    - Style feedback textarea and character counter
    - _Requirements: 2.1, 2.2_

- [x] 14. Implement Ticket Timeline UI (both portals)
  - [x] 14.1 Add activity API methods to both portal API modules
    - In `frontend/api.js`: add `getTicketActivities(ticketId, lastKey?)` calling GET `/tickets/{ticketId}/activities`
    - In `user-portal/portal-api.js`: add `getTicketActivities(ticketId, lastKey?)` calling GET `/tickets/{ticketId}/activities`
    - _Requirements: 3.6_

  - [x] 14.2 Add timeline view to Admin Portal ticket detail in `frontend/app.js`
    - Render vertical timeline sorted by timestamp ascending
    - Display distinct icons per type: 🔄 status_change, 💬 message, 👤 assignment, ✅ resolution, 🚨 escalation
    - Show all activity types for admins
    - Add "Load More" button when more than 50 entries (use pagination nextKey)
    - _Requirements: 3.6, 3.7, 3.9_

  - [x] 14.3 Add timeline view to User Portal ticket detail in `user-portal/portal-app.js`
    - Render vertical timeline but filter to only show: `status_change`, `message`, `resolution` types
    - Hide `assignment` and `escalation` activities from users
    - Add "Load More" pagination button
    - _Requirements: 3.6, 3.8, 3.9_

  - [x] 14.4 Add timeline styles to both portals
    - Add timeline CSS to `frontend/styles.css` and `user-portal/portal-styles.css`
    - Vertical line with event nodes, icons, timestamps, and detail text
    - _Requirements: 3.6, 3.7_

- [x] 15. Implement Canned Responses UI (Admin Portal)
  - [x] 15.1 Add canned response API methods to `frontend/api.js`
    - Add `listCannedResponses()` calling GET `/admin/canned-responses`
    - Add `createCannedResponse(data)` calling POST `/admin/canned-responses`
    - Add `updateCannedResponse(id, data)` calling PUT `/admin/canned-responses/{id}`
    - Add `deleteCannedResponse(id)` calling DELETE `/admin/canned-responses/{id}`
    - _Requirements: 4.1_

  - [x] 15.2 Add canned responses dropdown to ticket message area in `frontend/app.js`
    - In the Messages tab of ticket detail, add a "Canned Responses" dropdown above the message input
    - Group responses by category in the dropdown
    - On selection, insert response body into message input field
    - Replace placeholder tokens (`{{ticketId}}`, `{{userName}}`) with actual ticket values
    - Allow admin to edit inserted text before sending
    - _Requirements: 4.3, 4.4, 4.5, 4.6_

  - [x] 15.3 Add canned responses management view to Admin Portal
    - Add a "Canned Responses" section in admin settings or as a sidebar item
    - List all canned responses grouped by category
    - Add create/edit/delete forms with title, body, and category fields
    - _Requirements: 4.1, 4.2, 4.8_

- [x] 16. Implement Multi-language Support UI (both portals)
  - [x] 16.1 Add translation toggle to Admin Portal ticket detail in `frontend/app.js`
    - When ticket has `detectedLanguage` that is not English, show language badge and toggle button
    - Toggle between original text and English translation for subject and description
    - Display translated admin messages alongside originals
    - _Requirements: 5.3_

  - [x] 16.2 Add translated message display to User Portal in `user-portal/portal-app.js`
    - When viewing messages on a non-English ticket, display messages in the ticket's detected language
    - Add "View original" toggle to see the English version of admin messages
    - _Requirements: 5.5_

- [x] 17. Checkpoint - Feature UIs complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Implement Real-time WebSocket Notifications UI (both portals)
  - [x] 18.1 Add WebSocket client to Admin Portal in `frontend/app.js`
    - On page load, establish WebSocket connection to the WebSocket API endpoint (read from CONFIG)
    - Pass auth token as query parameter for userId extraction
    - On `ticket_update` message, update ticket status badge in list and detail views without full refresh
    - On `new_message` message, show toast notification and refresh message list if viewing that ticket
    - Implement reconnection with exponential backoff: start 1s, double up to 30s max
    - Fall back to existing polling when WebSocket is not connected
    - _Requirements: 6.6, 6.7, 6.9, 6.10_

  - [x] 18.2 Add WebSocket client to User Portal in `user-portal/portal-app.js`
    - On page load, establish WebSocket connection
    - Listen for updates on current user's tickets
    - On `ticket_update`, refresh ticket status in list view
    - On `new_message`, show notification and refresh messages if viewing that ticket
    - Implement same reconnection logic with exponential backoff
    - Fall back to polling when disconnected
    - _Requirements: 6.8, 6.9, 6.10_

- [x] 19. Implement Admin SLA Dashboard UI
  - [x] 19.1 Add SLA dashboard API method to `frontend/api.js`
    - Add `getSLADashboard()` calling GET `/admin/sla-dashboard`
    - _Requirements: 7.9_

  - [x] 19.2 Add SLA Dashboard view to Admin Portal in `frontend/app.js`
    - Add "SLA Dashboard" navigation item in the sidebar
    - Display summary metrics: total open tickets, breached count, at-risk count, compliance %, avg response time, avg resolution time
    - Color-code compliance: green >90%, yellow 70–90%, red <70%
    - Display breached tickets table: ticketId, subject, priority, time since breach, assigned team
    - Display at-risk tickets table: ticketId, subject, priority, time remaining, assigned team
    - Display per-priority breakdown: Critical/High/Medium/Low with breach count and compliance %
    - Add "Refresh" button to re-fetch and recompute metrics
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 19.3 Add SLA dashboard styles to `frontend/styles.css`
    - Style metric cards with color-coded backgrounds
    - Style breached/at-risk ticket tables
    - Style priority breakdown section
    - _Requirements: 7.6_

- [x] 20. Implement Ticket Merge UI (Admin Portal and User Portal)
  - [x] 20.1 Add merge API method to `frontend/api.js`
    - Add `mergeTicket(ticketId, primaryTicketId)` calling POST `/tickets/{ticketId}/merge`
    - Add `searchTickets(query)` if not already present, for the merge dialog search
    - _Requirements: 8.12_

  - [x] 20.2 Add merge dialog to Admin Portal ticket detail in `frontend/app.js`
    - Add "Merge Ticket" button in ticket detail view
    - On click, open modal dialog with search field for primary ticket (by ticketId or subject keyword)
    - Display search results with ticketId and subject
    - On confirm, call `mergeTicket` API and refresh the ticket detail
    - Show success/error messages
    - _Requirements: 8.1, 8.2_

  - [x] 20.3 Add merged ticket notice to User Portal in `user-portal/portal-app.js`
    - When viewing a ticket with `mergedInto` attribute, display notice: "This ticket has been merged into ticket #<primaryTicketId>"
    - Make the primary ticket ID a clickable link that navigates to that ticket
    - _Requirements: 8.9_

- [x] 21. Final checkpoint - All features integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Backend handlers are built first (tasks 1–11), then frontend UI (tasks 12–20)
- The existing `solution-knowledge-base.ts` already has `findMatchingSolutions` and `recordSolutionFeedback` — the AI-Suggested Solutions feature wires these into the UI
- The existing `sla-tracker.ts` already has `getSLAStatus` and `calculateSLADeadlines` — the SLA Dashboard computes aggregates from these
- WebSocket infrastructure requires a new API Gateway WebSocket API in CDK alongside the existing REST API
- Translation uses Amazon Translate service, requiring new IAM permissions in CDK
