# Implementation Plan: User Ticket Portal

## Overview

Build a standalone customer-facing SPA in `user-portal/` that reuses the existing NovaSupport backend APIs and Cognito auth. The portal uses vanilla HTML, CSS, and JavaScript to match the existing frontend approach. Implementation proceeds from config and auth, through core modules (API client, form validation, file upload), to views and wiring.

## Tasks

- [x] 1. Set up portal project structure and configuration
  - [x] 1.1 Create `user-portal/` directory with `index.html` skeleton, `config.js` (reusing existing Cognito/API config values), and `portal-styles.css` with base styles from the NovaSupport design system
    - Create index.html with auth screen and main app shell (nav bar, view containers for ticket list, new ticket, ticket detail)
    - Create config.js with API_URL and COGNITO settings
    - Create portal-styles.css importing the design system variables and base component styles
    - _Requirements: 6.1, 6.2, 6.4_

- [x] 2. Implement authentication module
  - [x] 2.1 Create `user-portal/portal-auth.js` with Cognito sign-in, sign-up, confirm, sign-out, token management, and session check functions
    - Implement signIn, signUp, confirmSignUp, signOut, getIdToken, getEmail, isAuthenticated
    - Store/clear tokens in localStorage
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 3. Implement API client module
  - [x] 3.1 Create `user-portal/portal-api.js` with authenticated fetch wrapper and methods for createTicket, listMyTickets, getTicket, and requestUploadUrl
    - Attach Cognito JWT token to all requests
    - Handle HTTP error responses and parse error details
    - _Requirements: 2.2, 3.5, 4.1, 5.1, 7.1, 7.2_

- [x] 4. Implement form validation and file upload modules
  - [x] 4.1 Create form validation functions: validateSubject, validateDescription, validateForm — rejecting empty/whitespace-only inputs and returning field-specific errors
    - _Requirements: 2.3, 7.3_
  - [ ]* 4.2 Write property test for form validation (Property 1: Form validation rejects whitespace-only inputs)
    - **Property 1: Form validation rejects whitespace-only inputs**
    - **Validates: Requirements 2.3, 7.3**
  - [x] 4.3 Create file validation functions: validateFileType and validateFileSize matching backend allowed types and size limits
    - _Requirements: 3.3, 3.4_
  - [ ]* 4.4 Write property test for file type validation (Property 2: File type validation rejects unsupported types)
    - **Property 2: File type validation rejects unsupported types**
    - **Validates: Requirements 3.3**
  - [ ]* 4.5 Write property test for file size validation (Property 3: File size validation rejects oversized files)
    - **Property 3: File size validation rejects oversized files**
    - **Validates: Requirements 3.4**
  - [x] 4.6 Create FileUploadHandler with initDropZone, addFile, removeFile, getFiles, uploadAll, and reset methods
    - Wire drag-and-drop events and file input change events
    - Implement presigned URL upload flow (request URL from API, PUT file to S3)
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement ticket list view
  - [x] 6.1 Create renderTicketList function that fetches user tickets, sorts by creation date descending, and renders each ticket with subject, Status_Badge, priority, and creation date
    - Include status filter dropdown
    - Show empty state with link to create ticket when no tickets exist
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 6.2 Write property test for ticket list sorting (Property 4: Ticket list is sorted by creation date descending)
    - **Property 4: Ticket list is sorted by creation date descending**
    - **Validates: Requirements 4.1**
  - [ ]* 6.3 Write property test for ticket list item rendering (Property 5: Ticket list items contain required information)
    - **Property 5: Ticket list items contain required information**
    - **Validates: Requirements 4.2**
  - [ ]* 6.4 Write property test for status filtering (Property 6: Status filter shows only matching tickets)
    - **Property 6: Status filter shows only matching tickets**
    - **Validates: Requirements 4.5**

- [x] 7. Implement ticket detail view
  - [x] 7.1 Create renderTicketDetail function that fetches a ticket by ID and displays all fields (subject, description, status, priority, dates, assigned team, tags, attachments)
    - Show Status_Badge with color mapping
    - Show attachment list if attachments exist
    - Handle 404 with not-found message and back link
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [ ]* 7.2 Write property test for ticket detail completeness (Property 7: Ticket detail view displays all required fields)
    - **Property 7: Ticket detail view displays all required fields**
    - **Validates: Requirements 5.1, 5.2**
  - [ ]* 7.3 Write property test for status badge color mapping (Property 8: Status badge maps each status to a distinct color)
    - **Property 8: Status badge maps each status to a distinct color**
    - **Validates: Requirements 5.3**

- [x] 8. Implement ticket submission view
  - [x] 8.1 Create renderSubmissionForm function with subject, description, priority fields, File_Drop_Zone, and submit handler
    - Wire form validation on submit
    - Wire file upload handler for drag-and-drop and browse
    - On successful creation, navigate to ticket detail view
    - Default priority to Medium
    - Show loading indicator and disable submit during API call
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.6, 7.4_

- [x] 9. Implement routing and application shell
  - [x] 9.1 Create `user-portal/portal-app.js` with hash-based router (routes: #/, #/new, #/tickets/:id), view switching, auth guard, toast notifications, and init function
    - Wire auth screen show/hide based on isAuthenticated
    - Wire nav bar links and active state
    - Wire hashchange event listener
    - Wire sign-out button
    - _Requirements: 6.1, 6.3, 1.1, 1.4, 1.6_
  - [ ]* 9.2 Write property test for route navigation (Property 9: Route navigation updates URL hash)
    - **Property 9: Route navigation updates URL hash**
    - **Validates: Requirements 6.3**

- [x] 10. Implement error display and API error handling
  - [x] 10.1 Create error rendering functions that display API validation error details, server error messages, and network error messages
    - _Requirements: 7.1, 7.2_
  - [ ]* 10.2 Write property test for API error display (Property 10: API validation errors are displayed to user)
    - **Property 10: API validation errors are displayed to user**
    - **Validates: Requirements 7.1**

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- The portal reuses the existing Cognito user pool and API Gateway endpoints — no backend changes needed
