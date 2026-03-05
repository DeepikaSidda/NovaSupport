# Requirements Document

## Introduction

This feature adds ticket editing and messaging capabilities to the NovaSupport user portal. Users can directly edit tickets that have not yet been assigned to a team (status "new" or "analyzing"). For tickets that have been assigned (status "assigned", "in_progress", "pending_user", "escalated", "resolved", "closed"), users can send messages/comments to the assigned team requesting changes. The admin portal displays these messages on the ticket detail view so the team can act on them.

## Glossary

- **User_Portal**: The end-user-facing single-page application in the `user-portal/` directory that allows users to create, view, edit, and comment on their support tickets.
- **Admin_Portal**: The admin-facing single-page application in the `frontend/` directory used by support teams to manage tickets and view user messages.
- **Ticket**: A support request record stored in DynamoDB with a PK of `TICKET#<ticketId>` and SK of `METADATA`.
- **Editable_Status**: A ticket status of "new" or "analyzing", indicating the ticket has not yet been assigned to a team.
- **Assigned_Status**: A ticket status of "assigned", "in_progress", "pending_user", "escalated", "resolved", or "closed", indicating the ticket has been assigned to a team.
- **Message**: A comment or change request submitted by a user on an assigned ticket, stored in DynamoDB with PK `TICKET#<ticketId>` and SK `MESSAGE#<messageId>`.
- **Edit_Ticket_Handler**: The Lambda function that processes PUT requests to update editable ticket fields (subject, description, priority).
- **Message_Handler**: The Lambda function that processes POST requests to add messages to a ticket and GET requests to list messages for a ticket.
- **Ticket_Detail_View**: The UI component in the User_Portal that displays ticket information and provides edit or messaging capabilities based on ticket status.

## Requirements

### Requirement 1: Determine Ticket Editability

**User Story:** As a user, I want to know whether I can edit my ticket directly or need to send a message, so that I understand the available actions for my ticket.

#### Acceptance Criteria

1. WHEN the Ticket_Detail_View loads a ticket with an Editable_Status, THE User_Portal SHALL display an edit form allowing changes to subject, description, and priority.
2. WHEN the Ticket_Detail_View loads a ticket with an Assigned_Status, THE User_Portal SHALL display a message input form instead of an edit form.
3. WHEN the Ticket_Detail_View loads a ticket with an Assigned_Status, THE User_Portal SHALL hide the edit controls for subject, description, and priority.

### Requirement 2: Edit Unassigned Tickets

**User Story:** As a user, I want to edit the subject, description, and priority of my unassigned ticket, so that I can correct or improve my support request before a team picks it up.

#### Acceptance Criteria

1. WHEN a user submits an edit for a ticket with an Editable_Status, THE Edit_Ticket_Handler SHALL update the subject, description, and priority fields in DynamoDB and return the updated ticket.
2. WHEN a user submits an edit for a ticket with an Assigned_Status, THE Edit_Ticket_Handler SHALL reject the request with a 409 Conflict status code and an error message indicating the ticket can no longer be edited.
3. WHEN a user submits an edit with an empty subject or empty description, THE Edit_Ticket_Handler SHALL reject the request with a 400 status code and validation error details.
4. WHEN a user submits an edit with an invalid priority value, THE Edit_Ticket_Handler SHALL reject the request with a 400 status code indicating the allowed priority values.
5. WHEN a successful edit is saved, THE Edit_Ticket_Handler SHALL update the `updatedAt` timestamp on the ticket record.

### Requirement 3: Send Messages on Assigned Tickets

**User Story:** As a user, I want to send a message to the support team on my assigned ticket, so that I can request changes or provide additional information.

#### Acceptance Criteria

1. WHEN a user submits a message on a ticket, THE Message_Handler SHALL create a new Message record in DynamoDB with the message content, userId, ticketId, and a generated messageId.
2. WHEN a user submits a message with empty content, THE Message_Handler SHALL reject the request with a 400 status code and a validation error.
3. WHEN a message is created, THE Message_Handler SHALL store the creation timestamp on the Message record.
4. WHEN a user requests messages for a ticket, THE Message_Handler SHALL return all messages for that ticket sorted by creation time in ascending order.

### Requirement 4: Display Messages in Admin Portal

**User Story:** As a support team member, I want to see user messages on the ticket detail view, so that I can understand what the user is requesting and take appropriate action.

#### Acceptance Criteria

1. WHEN the Admin_Portal opens a ticket detail view, THE Admin_Portal SHALL fetch and display all messages associated with that ticket.
2. WHEN messages are displayed, THE Admin_Portal SHALL show the message content, sender, and timestamp for each message.
3. WHEN a ticket has no messages, THE Admin_Portal SHALL display an indication that no messages exist.

### Requirement 5: Client-Side Validation for Edits and Messages

**User Story:** As a user, I want immediate feedback when my edit or message input is invalid, so that I can correct errors before submitting.

#### Acceptance Criteria

1. WHEN a user attempts to submit an edit with an empty subject field, THE User_Portal SHALL display a validation error on the subject field and prevent submission.
2. WHEN a user attempts to submit an edit with an empty description field, THE User_Portal SHALL display a validation error on the description field and prevent submission.
3. WHEN a user attempts to submit a message with empty content, THE User_Portal SHALL display a validation error and prevent submission.

### Requirement 6: API Endpoints and Infrastructure

**User Story:** As a developer, I want well-defined API endpoints for ticket editing and messaging, so that the frontend can interact with the backend reliably.

#### Acceptance Criteria

1. THE Edit_Ticket_Handler SHALL be accessible via PUT /tickets/{ticketId} with Cognito authorization.
2. THE Message_Handler SHALL be accessible via POST /tickets/{ticketId}/messages for creating messages and GET /tickets/{ticketId}/messages for listing messages, both with Cognito authorization.
3. WHEN the Message_Handler stores a message, THE Message_Handler SHALL use the DynamoDB single-table pattern with PK `TICKET#<ticketId>` and SK `MESSAGE#<messageId>`.
4. WHEN the Message_Handler retrieves messages, THE Message_Handler SHALL query by PK `TICKET#<ticketId>` with SK beginning with `MESSAGE#`.
