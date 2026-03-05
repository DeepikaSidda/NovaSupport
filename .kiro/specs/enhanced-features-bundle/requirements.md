# Requirements Document

## Introduction

This document specifies requirements for eight enhanced features in the NovaSupport IT ticket management system: AI-Suggested Solutions, Satisfaction Rating Widget, Ticket Timeline/Activity Log, Canned Responses for Admins, Multi-language Support, Real-time Notifications (WebSocket), Admin SLA Dashboard, and Ticket Merge. These features extend the existing AWS serverless architecture (CDK, Lambda, DynamoDB, API Gateway, SQS, SNS, S3, Cognito) with richer admin tooling, improved user experience, and real-time communication capabilities. The system uses Amazon Nova models for AI features and follows a single-table DynamoDB design with PK/SK patterns.

## Glossary

- **Admin_Portal**: The admin-facing web application (`frontend/`) running on port 3000, authenticated via Cognito pool `us-east-1_Kl64pgBSV`.
- **User_Portal**: The user-facing web application (`user-portal/`) running on port 3001, authenticated via Cognito pool `us-east-1_uBB4ai0k2`.
- **Solution_Knowledge_Base**: The backend service (`src/services/solution-knowledge-base.ts`) that stores and retrieves solutions from resolved tickets using vector similarity search.
- **Knowledge_Base**: The backend service (`src/services/knowledge-base.ts`) that manages knowledge base articles and performs semantic search via embeddings.
- **SLA_Tracker**: The backend service (`src/services/sla-tracker.ts`) that defines SLA targets per priority, calculates deadlines, and tracks breaches.
- **Notification_Service**: The backend service (`src/services/notification-service.ts`) that handles email (SNS) and in-app notifications.
- **Ticket_Record**: A DynamoDB item with PK `TICKET#<ticketId>` and SK `METADATA` containing all ticket attributes including status, priority, SLA deadlines, and assignment info.
- **Message_Record**: A DynamoDB item with PK `TICKET#<ticketId>` and SK `MESSAGE#<messageId>` containing message content, userId, and timestamp.
- **Activity_Record**: A DynamoDB item with PK `TICKET#<ticketId>` and SK `ACTIVITY#<timestamp>#<activityId>` representing a single timeline event (status change, message, assignment, etc.).
- **Canned_Response_Record**: A DynamoDB item with PK `CANNED_RESPONSE#<responseId>` and SK `METADATA` containing the template title, body, category, and shortcut key.
- **Rating_Record**: A satisfaction rating (1–5 stars) stored on the Ticket_Record as `satisfactionRating` and `satisfactionFeedback` attributes.
- **Merge_Record**: A DynamoDB item with PK `TICKET#<duplicateTicketId>` and SK `MERGE_INFO` linking a closed duplicate to its primary ticket.
- **WebSocket_Connection**: A DynamoDB item with PK `WSCONN#<connectionId>` and SK `METADATA` tracking an active WebSocket connection, its associated userId, and connected timestamp.
- **Translation_Result**: An object containing the original text, detected source language, translated text, and target language, produced by Amazon Translate.
- **SLA_Dashboard**: A dedicated view in the Admin_Portal displaying SLA compliance metrics, breached tickets, at-risk tickets, and response/resolution time averages.

## Requirements

### Requirement 1: AI-Suggested Solutions on Ticket Open

**User Story:** As an admin, I want to see AI-suggested solutions from the knowledge base when I open a ticket, so that I can resolve issues faster without manually searching.

#### Acceptance Criteria

1. WHEN an admin opens a ticket detail view in the Admin_Portal, THE Admin_Portal SHALL automatically send the ticket subject and description to the Solution_Knowledge_Base `findMatchingSolutions` function.
2. WHEN matching solutions are found, THE Admin_Portal SHALL display a "Suggested Solutions" panel in the ticket detail view showing up to 5 solutions ranked by success rate and similarity score.
3. WHEN a suggested solution is displayed, THE Admin_Portal SHALL show the solution's problem summary, resolution text, similarity score as a percentage, and success rate as a percentage.
4. WHEN an admin clicks "Apply Solution" on a suggested solution, THE Admin_Portal SHALL populate the resolution text field with the solution's resolution text.
5. WHEN an admin clicks "Not Helpful" on a suggested solution, THE Admin_Portal SHALL call the `recordSolutionFeedback` function with `wasHelpful` set to false.
6. WHEN an admin clicks "Helpful" on a suggested solution, THE Admin_Portal SHALL call the `recordSolutionFeedback` function with `wasHelpful` set to true.
7. IF no matching solutions are found with similarity above 0.5, THEN THE Admin_Portal SHALL also search the Knowledge_Base articles and display any matching articles as fallback suggestions.
8. IF both solution and article searches return no results, THEN THE Admin_Portal SHALL display a message stating "No suggested solutions found for this ticket."
9. WHILE the solution search is in progress, THE Admin_Portal SHALL display a loading indicator in the Suggested Solutions panel.

### Requirement 2: Satisfaction Rating Widget

**User Story:** As a user, I want to rate my support experience after a ticket is resolved, so that the support team can measure and improve service quality.

#### Acceptance Criteria

1. WHEN a user views a resolved ticket in the User_Portal, THE User_Portal SHALL display a satisfaction rating widget with 5 clickable star icons.
2. WHEN the user clicks a star, THE User_Portal SHALL visually highlight all stars up to and including the selected star to indicate the rating value (1–5).
3. WHEN the user submits a rating, THE User_Portal SHALL send a PUT request to the `/tickets/{ticketId}/rate` endpoint with the numeric rating and optional text feedback.
4. WHEN the rating endpoint receives a valid request, THE API Gateway SHALL update the Ticket_Record by setting `satisfactionRating` to the numeric value (1–5) and `satisfactionFeedback` to the text feedback.
5. IF the ticket status is not "resolved" or "closed", THEN THE API Gateway SHALL return a 400 error with message "Rating is only allowed on resolved or closed tickets."
6. IF the user has already submitted a rating for the ticket, THEN THE API Gateway SHALL update the existing rating with the new values.
7. WHEN a rating is stored, THE API Gateway SHALL also record a satisfaction metric in the analytics system by writing a metric record with type "satisfaction" and the rating value.
8. THE User_Portal SHALL display the previously submitted rating when the user revisits a rated ticket.
9. WHEN the user provides optional text feedback, THE User_Portal SHALL accept up to 500 characters and display a character counter.

### Requirement 3: Ticket Timeline/Activity Log

**User Story:** As an admin or user, I want to see a visual timeline of all events on a ticket, so that I can understand the full history of actions taken.

#### Acceptance Criteria

1. WHEN a ticket status changes, THE API Gateway SHALL create an Activity_Record with type "status_change", the old status, the new status, the actor (userId or "system"), and the timestamp.
2. WHEN a message is posted on a ticket, THE API Gateway SHALL create an Activity_Record with type "message", the sender userId, a content preview (first 100 characters), and the timestamp.
3. WHEN a ticket is assigned or reassigned, THE API Gateway SHALL create an Activity_Record with type "assignment", the previous assignee, the new assignee, and the timestamp.
4. WHEN a ticket is resolved, THE API Gateway SHALL create an Activity_Record with type "resolution", the resolver userId, and the timestamp.
5. WHEN a ticket is escalated, THE API Gateway SHALL create an Activity_Record with type "escalation", the escalation reason, the urgency level, and the timestamp.
6. WHEN the ticket detail view loads in the Admin_Portal or User_Portal, THE portal SHALL fetch all Activity_Records for the ticket and render them as a vertical timeline sorted by timestamp ascending.
7. THE Admin_Portal SHALL display all activity types in the timeline with distinct icons for each type: 🔄 for status changes, 💬 for messages, 👤 for assignments, ✅ for resolutions, and 🚨 for escalations.
8. THE User_Portal SHALL display only "status_change", "message", and "resolution" activity types in the timeline, filtering out internal activities such as assignments and escalations.
9. WHEN the timeline contains more than 50 entries, THE portal SHALL paginate the timeline showing 50 entries per page with a "Load More" button.

### Requirement 4: Canned Responses for Admins

**User Story:** As an admin, I want to select from pre-defined response templates when replying to tickets, so that I can respond consistently and quickly to common issues.

#### Acceptance Criteria

1. THE API Gateway SHALL expose CRUD endpoints for canned responses at `/admin/canned-responses` supporting GET (list all), POST (create), PUT (update), and DELETE operations.
2. WHEN creating a canned response, THE API Gateway SHALL validate that the title is non-empty, the body is non-empty, and the category is one of the predefined ticket categories.
3. WHEN the admin opens the Messages tab in the ticket detail view, THE Admin_Portal SHALL display a "Canned Responses" dropdown above the message input field.
4. WHEN the admin selects a canned response from the dropdown, THE Admin_Portal SHALL insert the response body text into the message input field, replacing any placeholder tokens (e.g., `{{ticketId}}`, `{{userName}}`) with actual ticket values.
5. WHEN the admin selects a canned response, THE Admin_Portal SHALL allow the admin to edit the inserted text before sending.
6. THE Admin_Portal SHALL group canned responses in the dropdown by category.
7. WHEN listing canned responses, THE API Gateway SHALL return all Canned_Response_Records sorted by category and then by title alphabetically.
8. WHEN a canned response is created, THE API Gateway SHALL store a Canned_Response_Record in DynamoDB with a unique ID, title, body, category, createdBy, and timestamps.
9. IF a canned response with the same title already exists in the same category, THEN THE API Gateway SHALL return a 409 conflict error.

### Requirement 5: Multi-language Support

**User Story:** As a user, I want to submit tickets in my preferred language, so that I can describe my issue clearly without language barriers.

#### Acceptance Criteria

1. WHEN a ticket is created, THE API Gateway SHALL call Amazon Translate to detect the language of the ticket subject and description and store the detected language code on the Ticket_Record as `detectedLanguage`.
2. WHEN the detected language is not English, THE API Gateway SHALL translate the subject and description to English using Amazon Translate and store the translations as `translatedSubject` and `translatedDescription` on the Ticket_Record.
3. WHEN an admin views a ticket with a non-English detected language in the Admin_Portal, THE Admin_Portal SHALL display both the original text and the English translation, with a toggle to switch between them.
4. WHEN an admin sends a message on a non-English ticket, THE API Gateway SHALL translate the admin's English message to the ticket's detected language and store both versions on the Message_Record as `content` (original) and `translatedContent`.
5. WHEN a user views a translated admin message in the User_Portal, THE User_Portal SHALL display the message in the ticket's detected language with an option to view the original English text.
6. IF Amazon Translate fails or is unavailable, THEN THE API Gateway SHALL store the original text without translation and set a `translationFailed` flag to true on the record.
7. THE API Gateway SHALL expose a POST endpoint at `/translate` that accepts text and a target language code and returns a Translation_Result.
8. WHEN translating text, THE API Gateway SHALL use Amazon Translate's `TranslateText` API with auto-detection for the source language.

### Requirement 6: Real-time Notifications via WebSocket

**User Story:** As an admin or user, I want to receive real-time ticket updates without refreshing the page, so that I can respond to changes immediately.

#### Acceptance Criteria

1. THE CDK stack SHALL provision an API Gateway WebSocket API with `$connect`, `$disconnect`, and `$default` routes, each backed by a Lambda handler.
2. WHEN a client connects to the WebSocket API, THE `$connect` handler SHALL store a WebSocket_Connection record in DynamoDB with the connectionId, userId (from query string auth token), and connectedAt timestamp.
3. WHEN a client disconnects, THE `$disconnect` handler SHALL delete the WebSocket_Connection record from DynamoDB.
4. WHEN a ticket status changes, THE Notification_Service SHALL query all WebSocket_Connection records for the ticket's userId and the assigned admin, and send a JSON message with type "ticket_update", ticketId, new status, and timestamp to each connection.
5. WHEN a new message is posted on a ticket, THE Notification_Service SHALL send a WebSocket message with type "new_message", ticketId, sender, and content preview to all relevant connections.
6. WHEN the Admin_Portal loads, THE Admin_Portal SHALL establish a WebSocket connection to the WebSocket API and listen for incoming messages.
7. WHEN the Admin_Portal receives a "ticket_update" WebSocket message, THE Admin_Portal SHALL update the ticket status badge in the ticket list and detail view without a full page refresh.
8. WHEN the User_Portal loads, THE User_Portal SHALL establish a WebSocket connection and listen for updates on the current user's tickets.
9. IF the WebSocket connection drops, THEN THE portal SHALL attempt to reconnect with exponential backoff starting at 1 second, doubling up to a maximum of 30 seconds.
10. WHILE the WebSocket connection is not established, THE portal SHALL fall back to the existing polling-based auto-refresh mechanism.

### Requirement 7: Admin SLA Dashboard

**User Story:** As a support manager, I want a dedicated SLA dashboard showing compliance metrics, so that I can monitor service level performance and identify at-risk tickets.

#### Acceptance Criteria

1. THE Admin_Portal SHALL provide a dedicated "SLA Dashboard" navigation item and view accessible from the sidebar.
2. WHEN the SLA Dashboard loads, THE Admin_Portal SHALL fetch all open tickets and compute SLA metrics using the SLA_Tracker service functions.
3. WHEN displaying SLA metrics, THE SLA_Dashboard SHALL show: total open tickets, count of SLA-breached tickets, count of at-risk tickets (within 30 minutes of breach), SLA compliance percentage (non-breached / total), average response time, and average resolution time.
4. WHEN displaying breached tickets, THE SLA_Dashboard SHALL list each breached ticket with its ticketId, subject, priority, time since breach, and assigned team.
5. WHEN displaying at-risk tickets, THE SLA_Dashboard SHALL list each at-risk ticket with its ticketId, subject, priority, time remaining until breach, and assigned team.
6. THE SLA_Dashboard SHALL color-code metrics: green for compliance above 90%, yellow for 70–90%, and red for below 70%.
7. THE SLA_Dashboard SHALL display a breakdown of SLA compliance by priority level (Critical, High, Medium, Low) showing breach count and compliance percentage for each.
8. WHEN the admin clicks "Refresh" on the SLA Dashboard, THE Admin_Portal SHALL re-fetch all ticket data and recompute SLA metrics.
9. THE API Gateway SHALL expose a GET endpoint at `/admin/sla-dashboard` that returns computed SLA metrics including breach counts, at-risk counts, compliance percentages, and per-priority breakdowns.

### Requirement 8: Ticket Merge

**User Story:** As an admin, I want to merge duplicate tickets into a single primary ticket, so that all related information is consolidated and duplicate work is avoided.

#### Acceptance Criteria

1. WHEN an admin views a ticket detail in the Admin_Portal, THE Admin_Portal SHALL display a "Merge Ticket" button that opens a merge dialog.
2. WHEN the merge dialog opens, THE Admin_Portal SHALL allow the admin to search for and select a primary ticket by ticketId or subject keyword.
3. WHEN the admin confirms a merge, THE API Gateway SHALL append the duplicate ticket's description to the primary ticket's description with a separator indicating the merged content and source ticket ID.
4. WHEN merging tickets, THE API Gateway SHALL copy all Message_Records from the duplicate ticket to the primary ticket, preserving original timestamps and userIds.
5. WHEN merging tickets, THE API Gateway SHALL copy all attachment references from the duplicate ticket to the primary ticket's attachmentIds list.
6. WHEN the merge completes, THE API Gateway SHALL update the duplicate ticket's status to "closed" and set a `mergedInto` attribute with the primary ticket's ID.
7. WHEN the merge completes, THE API Gateway SHALL create a Merge_Record on the duplicate ticket with PK `TICKET#<duplicateTicketId>` and SK `MERGE_INFO` containing the primary ticketId, merge timestamp, and the admin who performed the merge.
8. WHEN the merge completes, THE API Gateway SHALL create an Activity_Record on both the primary and duplicate tickets recording the merge event with type "merge".
9. WHEN a user views a merged (closed) ticket in the User_Portal, THE User_Portal SHALL display a notice stating "This ticket has been merged into ticket #<primaryTicketId>" with a link to the primary ticket.
10. IF the admin attempts to merge a ticket into itself, THEN THE API Gateway SHALL return a 400 error with message "A ticket cannot be merged into itself."
11. IF the admin attempts to merge a ticket that has already been merged, THEN THE API Gateway SHALL return a 400 error with message "This ticket has already been merged."
12. THE API Gateway SHALL expose a POST endpoint at `/tickets/{ticketId}/merge` that accepts a `primaryTicketId` in the request body and performs the merge operation.
