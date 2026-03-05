# Implementation Plan: Ticket Edit & Messaging

## Overview

Implement ticket editing (for unassigned tickets) and messaging (for assigned tickets) across the backend Lambda handlers, CDK infrastructure, user portal, and admin portal. Tasks are ordered so each step builds on the previous, with property tests close to the code they validate.

## Tasks

- [x] 1. Add message type and helper utilities
  - [x] 1.1 Add `MessageRecord` interface to `src/types/dynamodb-schemas.ts` with PK, SK, messageId, ticketId, userId, content, createdAt fields
    - _Requirements: 6.3_
  - [x] 1.2 Add `generateMessageId()` function to `src/utils/helpers.ts` that returns `MSG-<uuid>`
    - _Requirements: 3.1_

- [x] 2. Implement edit ticket handler
  - [x] 2.1 Create `src/handlers/edit-ticket.ts` with PUT handler that validates input, checks ticket status is editable ("new" or "analyzing"), updates subject/description/priority/updatedAt/GSI2SK in DynamoDB, and returns 200 with updated ticket; returns 409 for assigned tickets, 400 for invalid input, 404 for missing ticket
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 2.2 Write property tests in `test/edit-ticket.property.test.ts`
    - **Property 3: Successful edit returns updated fields**
    - **Property 4: Edit rejected for assigned tickets**
    - **Property 5: Invalid edit inputs rejected**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
  - [ ]* 2.3 Write unit tests in `test/edit-ticket.test.ts` for edge cases: ticket not found (404), missing body, invalid JSON, successful edit with all fields
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 3. Implement ticket messages handler
  - [x] 3.1 Create `src/handlers/ticket-messages.ts` with POST handler (create message with validation) and GET handler (query messages by PK with SK begins_with "MESSAGE#", sort by createdAt ascending)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 6.3, 6.4_
  - [ ]* 3.2 Write property tests in `test/ticket-messages.property.test.ts`
    - **Property 6: Message creation returns complete record**
    - **Property 7: Empty message rejected**
    - **Property 8: Messages returned in ascending chronological order**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  - [ ]* 3.3 Write unit tests in `test/ticket-messages.test.ts` for edge cases: ticket not found, empty messages list, missing body
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 4. Checkpoint - Backend handlers
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add CDK infrastructure for new endpoints
  - [x] 5.1 Add EditTicketFunction and TicketMessagesFunction Lambda definitions in `lib/novasupport-stack.ts`, add PUT method on `{ticketId}` resource, add `/tickets/{ticketId}/messages` resource with GET and POST methods, all with Cognito authorizer
    - _Requirements: 6.1, 6.2_

- [x] 6. Update user portal API and validation
  - [x] 6.1 Add `editTicket(ticketId, payload)`, `addMessage(ticketId, payload)`, and `getMessages(ticketId)` methods to `user-portal/portal-api.js`
    - _Requirements: 2.1, 3.1, 3.4_
  - [x] 6.2 Add `validateEditForm(subject, description, priority)` and `validateMessage(content)` functions to `user-portal/portal-validation.js`
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ]* 6.3 Write property tests in `test/portal-edit-messaging-validation.property.test.ts`
    - **Property 10: Client-side edit validation rejects empty fields**
    - **Property 11: Client-side message validation rejects empty content**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 7. Update user portal views and app controller
  - [x] 7.1 Add `isEditableStatus(status)`, `renderEditableTicketDetail(ticket)`, `renderAssignedTicketDetail(ticket, messages)`, and `renderMessageList(messages)` functions to `user-portal/portal-views.js`
    - _Requirements: 1.1, 1.2, 1.3, 3.4_
  - [x] 7.2 Update `user-portal/portal-app.js` to use `isEditableStatus` in `loadTicketDetail` to render the appropriate view, bind edit form submission and message form submission, and load messages for assigned tickets
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 3.1_
  - [x] 7.3 Add CSS styles for edit form, message form, and message list to `user-portal/portal-styles.css`
    - _Requirements: 1.1, 1.2_
  - [ ]* 7.4 Write property tests in `test/portal-edit-messaging-views.property.test.ts`
    - **Property 1: Editable status renders edit form**
    - **Property 2: Assigned status renders message form without edit controls**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 8. Checkpoint - User portal complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update admin portal to display messages
  - [x] 9.1 Add `getTicketMessages(ticketId)` method to `frontend/api.js`
    - _Requirements: 4.1_
  - [x] 9.2 Update `openTicketDetail()` in `frontend/app.js` to add a "Messages" tab that fetches and renders messages with content, sender, and timestamp; show empty state when no messages exist
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ]* 9.3 Write property tests in `test/portal-edit-messaging-views.property.test.ts` (append)
    - **Property 9: Admin message rendering includes required fields**
    - **Validates: Requirements 4.1, 4.2**

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check library with minimum 100 iterations
- Backend handlers follow existing patterns (CORS headers, error format, DynamoDB client usage)
- After TypeScript changes, run `npm run build`, create dist/package.json with uuid + aws-jwt-verify, run `npm install --production` in dist/, then `npx cdk deploy --require-approval never`
