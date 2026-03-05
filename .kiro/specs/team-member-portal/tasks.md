# Implementation Plan: Team Member Portal

## Overview

Build a standalone agent-facing portal in `team-portal/` using vanilla HTML, CSS, and JavaScript (no frameworks, no build tools). The portal reuses the existing NovaSupport backend API and the admin Cognito user pool for authentication. Implementation follows the same IIFE module pattern as `frontend/` and `user-portal/`, with hash-based routing and `agent_` localStorage prefix. Files: `index.html`, `config.js`, `agent-auth.js`, `agent-api.js`, `agent-views.js`, `agent-app.js`, `agent-styles.css`.

## Tasks

- [x] 1. Set up project structure and configuration
  - [x] 1.1 Create `team-portal/config.js` with API_URL and admin Cognito pool settings
    - API_URL: `https://1htq8dkcn3.execute-api.us-east-1.amazonaws.com/dev`
    - COGNITO REGION: `us-east-1`, USER_POOL_ID: `us-east-1_Kl64pgBSV`, CLIENT_ID: `13n0c7acq366joisvccgec5rk6`
    - Follow the same CONFIG object pattern as `frontend/config.js`
    - _Requirements: 1.2_

  - [x] 1.2 Create `team-portal/index.html` with auth screen, app shell, nav bar, and view containers
    - Include script tags for config.js, agent-auth.js, agent-api.js, agent-views.js, agent-app.js (in order)
    - Auth screen with sign-in form (email + password fields, sign-in button, error display)
    - App shell with nav bar (Dashboard link, Profile link, sign-out button, team name display)
    - View containers: dashboard view, ticket workspace view, profile view
    - Loading indicator element for API requests
    - Toast notification container
    - Served on port 8082
    - _Requirements: 1.1, 8.1, 8.3, 8.4_

  - [x] 1.3 Create `team-portal/agent-styles.css` with teal color scheme and responsive layout
    - Teal primary color scheme to distinguish from admin (dark) and user portal (blue)
    - Status badge styles for assigned, in_progress, pending_user, escalated, resolved
    - Priority indicator styles (low, medium, high, critical)
    - Responsive single-column layout at 768px breakpoint
    - Loading indicator and disabled button styles
    - Toast notification styles
    - Nav bar, ticket card, ticket workspace, profile, and form styles
    - _Requirements: 8.2, 8.3, 8.4_

- [x] 2. Implement authentication module
  - [x] 2.1 Create `team-portal/agent-auth.js` as an IIFE `AgentAuth` module with Cognito auth functions
    - Implement `signIn(email, password)` — authenticate via USER_PASSWORD_AUTH, store tokens with `agent_` prefix (agent_idToken, agent_accessToken, agent_refreshToken, agent_userEmail)
    - Implement `signOut()` — clear all agent_ localStorage keys
    - Implement `getIdToken()`, `getEmail()`, `isAuthenticated()`
    - Implement `refreshSession()` — use REFRESH_TOKEN_AUTH flow
    - Implement `getValidIdToken()` — check JWT expiry, auto-refresh if within 60 seconds of expiration
    - Follow the same `cognitoCall` pattern as `frontend/auth.js` and `user-portal/portal-auth.js`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 3. Implement API client module
  - [x] 3.1 Create `team-portal/agent-api.js` as an IIFE `AgentAPI` module with authenticated fetch wrapper
    - Implement `request(method, path, body)` — attach JWT via `AgentAuth.getValidIdToken()`, handle errors
    - On 401 response: clear session, redirect to sign-in with session-expired message
    - On 400 response: parse validation error details, throw with details array
    - On 500+ response: throw user-friendly "service temporarily unavailable" message
    - On network failure: throw connectivity error, preserve unsent data
    - Expose methods:
      - `listTickets(status)` — GET /tickets with optional status filter
      - `getTicket(id)` — GET /tickets/:id
      - `updateTicketStatus(id, status, assignedTo)` — PUT /tickets/:id/status
      - `getTicketMessages(id)` — GET /tickets/:id/messages
      - `sendMessage(id, payload)` — POST /tickets/:id/messages
      - `resolveTicket(id, resolution, rootCause)` — PUT /tickets/:id/resolve
      - `listTeams()` — GET /admin/teams
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.2, 9.1, 9.2, 9.3, 9.4_

- [x] 4. Checkpoint - Ensure auth and API modules work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement views module
  - [x] 5.1 Create `team-portal/agent-views.js` as an IIFE `AgentViews` module with rendering helpers and view functions
    - Implement shared helpers: `esc(str)` for HTML escaping, `statusColor(status)`, `statusLabel(status)`, `priorityName(priority)`, `priorityLabel(priority)`, `formatDate(dateStr)`, `timeAgo(dateStr)`
    - Define STATUS_CONFIG mapping statuses to labels and badge colors (assigned, in_progress, pending_user, escalated, resolved)
    - Define PRIORITY_CONFIG mapping priority numbers (1, 5, 8, 10) to labels
    - _Requirements: 3.3, 4.5_

  - [x] 5.2 Implement dashboard rendering in `AgentViews`
    - `renderDashboardStats(tickets)` — compute and render summary panel with counts grouped by status (assigned, in_progress, pending_user, escalated)
    - `renderMyTickets(tickets, agentEmail)` — render agent's personal ticket queue sorted by priority descending then creation date ascending; show ticket subject, status badge, priority indicator, category, creation date, and "Personal" assignment label
    - `renderTeamTickets(tickets, agentEmail)` — render unassigned team tickets (assignedTo is empty/null but assignedTeam matches agent's team) with "Claim" button on each ticket
    - `renderEmptyQueue()` — render "No tickets currently assigned" message when queue is empty
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.3, 5.1, 5.2_

  - [x] 5.3 Implement ticket workspace rendering in `AgentViews`
    - `renderTicketWorkspace(ticket)` — render full ticket detail: subject, description, status, priority, category, tags, creation date, last updated, assigned team, assigned agent, with status badge
    - `renderMessageThread(messages)` — render message thread in chronological order with sender and timestamp
    - `renderMessageForm()` — render message input textarea and send button
    - `renderStatusDropdown(currentStatus)` — render status change dropdown restricted to valid values: assigned, in_progress, pending_user, escalated, resolved
    - `renderResolveForm()` — render resolution form with required resolution summary textarea and optional root cause input
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 5.4 Implement profile rendering in `AgentViews`
    - `renderAgentProfile(agent, team, stats)` — render agent email, team name (or "Unassigned" if no team), team expertise areas and description
    - `renderPerformanceStats(stats)` — render total resolved count, current tickets by status, and average resolution time
    - _Requirements: 6.1, 6.2, 6.4, 7.1, 7.2, 7.3_

  - [ ]* 5.5 Write property test for dashboard ticket sorting (Property 1)
    - **Property 1: Dashboard ticket sorting — personal tickets sorted by priority descending then creation date ascending**
    - **Validates: Requirements 2.2**

  - [ ]* 5.6 Write property test for status badge mapping (Property 2)
    - **Property 2: Status badge color mapping — each status maps to a distinct badge color**
    - **Validates: Requirements 3.3**

  - [ ]* 5.7 Write property test for status filter (Property 3)
    - **Property 3: Status filter correctness — filtering by status returns only tickets with that status**
    - **Validates: Requirements 3.1**

  - [ ]* 5.8 Write property test for priority filter (Property 4)
    - **Property 4: Priority filter correctness — filtering by priority returns only tickets with that priority level**
    - **Validates: Requirements 3.2**

  - [ ]* 5.9 Write property test for HTML escaping (Property 5)
    - **Property 5: HTML escaping — all user-provided strings are escaped to prevent XSS**
    - **Validates: Requirements 3.3, 4.1**

  - [ ]* 5.10 Write property test for team ticket identification (Property 6)
    - **Property 6: Team ticket identification — unassigned team tickets have matching assignedTeam but empty assignedTo**
    - **Validates: Requirements 2.3, 5.1**

  - [ ]* 5.11 Write property test for valid status transitions (Property 7)
    - **Property 7: Status transition restriction — status dropdown only contains valid values (assigned, in_progress, pending_user, escalated, resolved)**
    - **Validates: Requirements 4.5**

  - [ ]* 5.12 Write property test for performance statistics computation (Property 8)
    - **Property 8: Performance statistics accuracy — resolved count matches tickets with resolved status filtered by agent email**
    - **Validates: Requirements 7.1, 7.4**

- [x] 6. Checkpoint - Ensure views render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement application shell and routing
  - [x] 7.1 Create `team-portal/agent-app.js` as an IIFE `AgentApp` module with hash-based routing and app lifecycle
    - Implement `init()` — bind auth UI, check `AgentAuth.isAuthenticated()`, show auth or app
    - Implement `showAuth()` / `showApp()` — toggle auth screen and app shell visibility
    - Implement sign-in form handler — call `AgentAuth.signIn()`, on success navigate to dashboard, on error display error message
    - Implement sign-out handler — call `AgentAuth.signOut()`, clear auto-refresh, show auth screen
    - _Requirements: 1.1, 1.3, 1.4, 1.6_

  - [x] 7.2 Implement hash-based router in `AgentApp`
    - Routes: `#/` or `#/dashboard` → dashboard view, `#/ticket/:id` → ticket workspace view, `#/profile` → profile view
    - Listen to `hashchange` event, parse route, call appropriate view loader
    - Update nav bar active state based on current route
    - Support browser back/forward navigation
    - _Requirements: 3.4, 3.5, 8.1_

  - [x] 7.3 Implement dashboard controller in `AgentApp`
    - `loadDashboard()` — fetch tickets via `AgentAPI.listTickets()`, separate into personal (assignedTo === agent email) and team (assignedTeam matches, assignedTo empty), render via `AgentViews`
    - Display agent's team name in nav bar
    - Set up 60-second auto-refresh interval for ticket queue
    - Bind "Claim" button click handlers — call `AgentAPI.updateTicketStatus(id, 'in_progress', agentEmail)`, refresh dashboard on success, show error on failure
    - Bind ticket card click handlers — navigate to `#/ticket/:id`
    - Bind status and priority filter dropdowns
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.4, 5.1, 5.2, 5.3, 5.4, 6.3_

  - [x] 7.4 Implement ticket workspace controller in `AgentApp`
    - `loadTicketWorkspace(ticketId)` — fetch ticket via `AgentAPI.getTicket()`, fetch messages via `AgentAPI.getTicketMessages()`, render workspace via `AgentViews`
    - Bind send message handler — validate non-empty, call `AgentAPI.sendMessage()`, append to thread, preserve input on error
    - Bind status change dropdown — call `AgentAPI.updateTicketStatus()`, update badge on success, show error on failure
    - Bind resolve button — show resolution form, validate required resolution summary, call `AgentAPI.resolveTicket()`, show error on failure
    - Show loading indicator during all API calls, disable action buttons to prevent duplicate submissions
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.4, 9.3_

  - [x] 7.5 Implement profile controller in `AgentApp`
    - `loadProfile()` — fetch teams via `AgentAPI.listTeams()`, find agent's team by matching agent email in team members, compute performance stats from ticket data
    - Compute: total resolved count, current tickets by status, average resolution time (assignment to resolution)
    - Render via `AgentViews.renderAgentProfile()` and `AgentViews.renderPerformanceStats()`
    - _Requirements: 6.1, 6.2, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 7.6 Implement toast notifications and error handling in `AgentApp`
    - `toast(message, type)` — show temporary notification (success, error, info) that auto-dismisses
    - Display validation errors from API as toast with specific details
    - Display "service temporarily unavailable" on server errors
    - Preserve unsent message content and form data on network failure
    - Redirect to sign-in with session-expired message on 401 during API calls
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 7.7 Write property test for route parsing (Property 9)
    - **Property 9: Route parsing correctness — hash routes correctly map to view names and extract parameters**
    - **Validates: Requirements 3.5**

  - [ ]* 7.8 Write property test for auto-refresh interval (Property 10)
    - **Property 10: Auto-refresh interval — dashboard refresh timer is set to 60 seconds**
    - **Validates: Requirements 2.5**

  - [ ]* 7.9 Write property test for claim ticket behavior (Property 11)
    - **Property 11: Claim ticket sets correct fields — claiming sets assignedTo to agent email and status to in_progress**
    - **Validates: Requirements 5.2**

  - [ ]* 7.10 Write property test for session token storage prefix (Property 12)
    - **Property 12: Session token prefix — all auth tokens use agent_ localStorage prefix**
    - **Validates: Requirements 1.2**

  - [ ]* 7.11 Write property test for error preservation (Property 13)
    - **Property 13: Error preservation — unsent message content is preserved when API call fails**
    - **Validates: Requirements 9.3**

  - [ ]* 7.12 Write property test for resolution form validation (Property 14)
    - **Property 14: Resolution form validation — resolve action requires non-empty resolution summary**
    - **Validates: Requirements 4.6**

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- The portal reuses the existing admin Cognito user pool and API Gateway endpoints — no backend changes needed
- Follow the same IIFE module pattern as `frontend/` and `user-portal/` for consistency
- Use `agent_` prefix for all localStorage keys to avoid conflicts with other portals
