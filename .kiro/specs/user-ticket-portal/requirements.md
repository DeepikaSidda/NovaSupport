# Requirements Document

## Introduction

This document defines the requirements for a separate, user-facing web portal that allows end users (customers) to submit and track support tickets in the NovaSupport system. The portal is distinct from the existing internal admin/agent dashboard and provides a streamlined, customer-friendly experience for ticket submission with multi-modal input (text, file attachments, screenshots). It integrates with the existing backend APIs (create-ticket, upload-attachment, get-ticket, list-tickets) and Cognito authentication.

## Glossary

- **User_Portal**: The separate customer-facing web interface for submitting and tracking support tickets
- **User**: An authenticated end user (customer) who submits and tracks support tickets
- **Ticket**: A support request containing a subject, description, priority, and optional attachments
- **Attachment**: A file (image, document, video, or audio) uploaded alongside a ticket
- **Ticket_List**: The view displaying all tickets submitted by the currently authenticated user
- **Submission_Form**: The form component used to create a new support ticket
- **Ticket_Detail_View**: The view displaying full details and status of a single ticket
- **Status_Badge**: A visual indicator showing the current status of a ticket
- **File_Drop_Zone**: The drag-and-drop area for uploading file attachments
- **Backend_API**: The existing NovaSupport API Gateway endpoints for ticket operations

## Requirements

### Requirement 1: User Authentication

**User Story:** As a user, I want to sign in to the portal with my credentials, so that I can securely access my support tickets.

#### Acceptance Criteria

1. WHEN a user visits the User_Portal without an active session, THE User_Portal SHALL display a sign-in form requesting email and password
2. WHEN a user submits valid credentials, THE User_Portal SHALL authenticate the user via Cognito and store session tokens in local storage
3. WHEN a user submits invalid credentials, THE User_Portal SHALL display a descriptive error message and allow retry
4. WHEN a user clicks the sign-out button, THE User_Portal SHALL clear all session tokens and redirect to the sign-in form
5. WHEN a user does not have an account, THE User_Portal SHALL provide a registration flow with email verification
6. IF a session token expires, THEN THE User_Portal SHALL redirect the user to the sign-in form

### Requirement 2: Ticket Submission

**User Story:** As a user, I want to submit a support ticket with a description of my issue, so that I can get help from the support team.

#### Acceptance Criteria

1. WHEN a user navigates to the ticket submission page, THE Submission_Form SHALL display fields for subject, description, and priority selection
2. WHEN a user submits a ticket with a valid subject and description, THE User_Portal SHALL send a create-ticket request to the Backend_API and display a confirmation with the new ticket ID
3. WHEN a user submits a ticket with an empty subject or empty description, THE Submission_Form SHALL prevent submission and display a validation error for each missing field
4. WHEN a user does not select a priority, THE Submission_Form SHALL default the priority to Medium
5. WHEN a ticket is successfully created, THE User_Portal SHALL navigate the user to the Ticket_Detail_View for the newly created ticket

### Requirement 3: File Attachment Upload

**User Story:** As a user, I want to attach files to my support ticket, so that I can provide screenshots, documents, or other evidence of my issue.

#### Acceptance Criteria

1. WHEN a user drags files onto the File_Drop_Zone, THE Submission_Form SHALL display the selected files with name, size, and a remove button
2. WHEN a user clicks the browse link in the File_Drop_Zone, THE Submission_Form SHALL open a native file picker dialog
3. WHEN a user selects a file with an unsupported type, THE Submission_Form SHALL reject the file and display an error indicating the allowed file types
4. WHEN a user selects a file exceeding the size limit for its type, THE Submission_Form SHALL reject the file and display an error indicating the maximum allowed size
5. WHEN a ticket with attachments is submitted, THE User_Portal SHALL upload each attachment using the Backend_API presigned URL flow and associate the attachments with the created ticket
6. IF an attachment upload fails, THEN THE User_Portal SHALL display an error for the failed attachment and allow the user to retry the upload

### Requirement 4: Ticket List and Tracking

**User Story:** As a user, I want to view all my submitted tickets and their current status, so that I can track the progress of my support requests.

#### Acceptance Criteria

1. WHEN a user navigates to the Ticket_List page, THE User_Portal SHALL fetch and display all tickets belonging to the authenticated user, sorted by creation date descending
2. WHEN displaying a ticket in the Ticket_List, THE User_Portal SHALL show the ticket subject, status as a Status_Badge, priority, and creation date
3. WHEN a user clicks on a ticket in the Ticket_List, THE User_Portal SHALL navigate to the Ticket_Detail_View for that ticket
4. WHEN the Ticket_List is empty, THE User_Portal SHALL display a message indicating no tickets have been submitted and provide a link to create a new ticket
5. WHEN a user filters tickets by status, THE User_Portal SHALL display only tickets matching the selected status

### Requirement 5: Ticket Detail View

**User Story:** As a user, I want to view the full details of a submitted ticket, so that I can see its current status, assigned team, and any updates.

#### Acceptance Criteria

1. WHEN a user opens the Ticket_Detail_View, THE User_Portal SHALL display the ticket subject, description, status, priority, creation date, last updated date, assigned team, and tags
2. WHEN a ticket has attachments, THE Ticket_Detail_View SHALL display the list of attachment file names and types
3. WHEN a ticket status changes, THE Status_Badge SHALL reflect the current status with a distinct color for each status value
4. IF the requested ticket does not exist or does not belong to the user, THEN THE User_Portal SHALL display a not-found message and provide navigation back to the Ticket_List

### Requirement 6: Responsive Layout and Navigation

**User Story:** As a user, I want the portal to work well on both desktop and mobile devices, so that I can submit and track tickets from any device.

#### Acceptance Criteria

1. THE User_Portal SHALL provide a navigation bar with links to the Ticket_List, Submission_Form, and sign-out action
2. WHILE the viewport width is 768 pixels or less, THE User_Portal SHALL adapt the layout to a single-column mobile-friendly view
3. WHEN a user navigates between views, THE User_Portal SHALL update the URL and support browser back/forward navigation
4. THE User_Portal SHALL use the existing NovaSupport design system (color scheme, typography, border radius, and component styles)

### Requirement 7: Input Validation and Error Handling

**User Story:** As a user, I want clear feedback when something goes wrong, so that I can correct my input or understand the issue.

#### Acceptance Criteria

1. WHEN the Backend_API returns a validation error, THE User_Portal SHALL display the specific error details to the user
2. WHEN the Backend_API is unreachable or returns a server error, THE User_Portal SHALL display a user-friendly error message indicating the service is temporarily unavailable
3. WHEN a form field fails client-side validation, THE Submission_Form SHALL highlight the field and display an inline error message
4. WHEN a network request is in progress, THE User_Portal SHALL display a loading indicator and disable the submit button to prevent duplicate submissions
