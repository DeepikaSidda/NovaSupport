# Requirements Document

## Introduction

This document defines the requirements for a Team Member Portal in the NovaSupport system. The portal provides individual support agents (team members) with a focused workspace to manage their assigned tickets, communicate with users, and track personal performance. It sits between the full admin dashboard and the end-user portal in terms of capabilities — team members can work on tickets assigned to them or their team, but cannot access system-wide admin functions like team management or global analytics. The portal is a static HTML/JS/CSS frontend served locally, using the existing backend API and the admin Cognito user pool for authentication.

## Glossary

- **Team_Member_Portal**: The web interface for individual support agents to manage their assigned tickets and view personal performance
- **Agent**: An authenticated support team member who works on assigned tickets
- **Team**: A named group of agents with shared expertise (e.g., "Authentication & Access", "Billing & Payments")
- **Ticket**: A support request with subject, description, status, priority, and assignment fields (assignedTo, assignedTeam)
- **Agent_Dashboard**: The main landing view showing the agent's ticket queue and summary statistics
- **Ticket_Queue**: The list of tickets assigned to the agent personally or to the agent's team
- **Ticket_Workspace**: The detailed view where an agent works on a single ticket (view details, update status, send messages, resolve)
- **Agent_Profile**: The view displaying the agent's identity, team membership, and personal statistics
- **Status_Badge**: A visual indicator showing the current status of a ticket
- **Backend_API**: The existing NovaSupport API Gateway endpoints at https://1htq8dkcn3.execute-api.us-east-1.amazonaws.com/dev
- **Message_Thread**: The chronological list of messages exchanged on a ticket between agents and users

## Requirements

### Requirement 1: Agent Authentication

**User Story:** As an agent, I want to sign in to the Team Member Portal with my credentials, so that I can securely access my assigned tickets and workspace.

#### Acceptance Criteria

1. WHEN an agent visits the Team_Member_Portal without an active session, THE Team_Member_Portal SHALL display a sign-in form requesting email and password
2. WHEN an agent submits valid credentials, THE Team_Member_Portal SHALL authenticate the agent via the admin Cognito user pool and store session tokens in local storage with a "agent_" prefix to avoid conflicts with other portals
3. WHEN an agent submits invalid credentials, THE Team_Member_Portal SHALL display a descriptive error message and allow retry
4. WHEN an agent clicks the sign-out button, THE Team_Member_Portal SHALL clear all agent session tokens and redirect to the sign-in form
5. IF a session token expires during use, THEN THE Team_Member_Portal SHALL attempt to refresh the token using the stored refresh token before redirecting to sign-in
6. WHEN an agent signs in successfully, THE Team_Member_Portal SHALL navigate to the Agent_Dashboard

### Requirement 2: Agent Dashboard

**User Story:** As an agent, I want to see a summary of my workload when I log in, so that I can quickly understand my current ticket queue and priorities.

#### Acceptance Criteria

1. WHEN an agent navigates to the Agent_Dashboard, THE Team_Member_Portal SHALL display a summary panel showing the count of tickets assigned to the agent grouped by status (assigned, in_progress, pending_user, escalated)
2. WHEN an agent navigates to the Agent_Dashboard, THE Team_Member_Portal SHALL display the Ticket_Queue containing tickets assigned to the agent personally, sorted by priority descending then creation date ascending
3. WHEN the Agent_Dashboard loads, THE Team_Member_Portal SHALL also display a separate section for unassigned team tickets (tickets assigned to the agent's team but not to any individual agent) so the agent can claim work
4. WHEN the Ticket_Queue is empty, THE Agent_Dashboard SHALL display a message indicating no tickets are currently assigned
5. THE Agent_Dashboard SHALL auto-refresh the Ticket_Queue every 60 seconds to reflect new assignments

### Requirement 3: Ticket Queue Filtering and Navigation

**User Story:** As an agent, I want to filter and browse my ticket queue, so that I can focus on the most urgent or relevant tickets.

#### Acceptance Criteria

1. WHEN an agent selects a status filter on the Ticket_Queue, THE Team_Member_Portal SHALL display only tickets matching the selected status
2. WHEN an agent selects a priority filter on the Ticket_Queue, THE Team_Member_Portal SHALL display only tickets matching the selected priority level
3. WHEN displaying a ticket in the Ticket_Queue, THE Team_Member_Portal SHALL show the ticket subject, Status_Badge, priority indicator, category, creation date, and whether the ticket is assigned to the agent personally or to the team
4. WHEN an agent clicks on a ticket in the Ticket_Queue, THE Team_Member_Portal SHALL navigate to the Ticket_Workspace for that ticket
5. WHEN an agent navigates between views, THE Team_Member_Portal SHALL update the URL hash and support browser back/forward navigation

### Requirement 4: Ticket Workspace

**User Story:** As an agent, I want a detailed workspace for each ticket, so that I can review the issue, communicate with the user, and take action to resolve it.

#### Acceptance Criteria

1. WHEN an agent opens the Ticket_Workspace, THE Team_Member_Portal SHALL display the ticket subject, description, status, priority, category, tags, creation date, last updated date, assigned team, and assigned agent
2. WHEN an agent opens the Ticket_Workspace, THE Team_Member_Portal SHALL fetch and display the Message_Thread for that ticket in chronological order
3. WHEN an agent types a message and clicks send, THE Team_Member_Portal SHALL post the message to the Backend_API and append the new message to the Message_Thread
4. WHEN an agent selects a new status from the status dropdown, THE Team_Member_Portal SHALL send a status update request to the Backend_API and update the Status_Badge
5. THE Ticket_Workspace SHALL restrict status transitions to valid values: assigned, in_progress, pending_user, escalated, resolved
6. WHEN an agent clicks the resolve button, THE Team_Member_Portal SHALL display a resolution form requiring a resolution summary and optional root cause, then submit the resolution to the Backend_API
7. IF the Backend_API returns an error during any ticket action, THEN THE Team_Member_Portal SHALL display the error message and preserve the agent's input

### Requirement 5: Claim Unassigned Team Tickets

**User Story:** As an agent, I want to claim unassigned tickets from my team's queue, so that I can pick up new work proactively.

#### Acceptance Criteria

1. WHEN an unassigned team ticket is displayed, THE Team_Member_Portal SHALL show a "Claim" button next to the ticket
2. WHEN an agent clicks the "Claim" button, THE Team_Member_Portal SHALL send a status update to the Backend_API setting the assignedTo field to the agent's email and the status to "in_progress"
3. WHEN a ticket is successfully claimed, THE Team_Member_Portal SHALL move the ticket from the unassigned team section to the agent's personal Ticket_Queue
4. IF claiming a ticket fails (e.g., another agent claimed it first), THEN THE Team_Member_Portal SHALL display an error message and refresh the team ticket list

### Requirement 6: Agent Profile and Team Information

**User Story:** As an agent, I want to see my profile and team information, so that I know which team I belong to and can review my assignment details.

#### Acceptance Criteria

1. WHEN an agent navigates to the Agent_Profile view, THE Team_Member_Portal SHALL display the agent's email address and team name
2. WHEN an agent navigates to the Agent_Profile view, THE Team_Member_Portal SHALL fetch and display the team's expertise areas and description from the Backend_API
3. THE Team_Member_Portal SHALL display the agent's team name in the navigation bar at all times
4. WHEN the Backend_API returns no team information for the agent, THE Agent_Profile SHALL display "Unassigned" as the team name

### Requirement 7: Personal Performance Statistics

**User Story:** As an agent, I want to see my personal performance stats, so that I can track how many tickets I have resolved and monitor my response times.

#### Acceptance Criteria

1. WHEN an agent navigates to the Agent_Profile view, THE Team_Member_Portal SHALL display the total count of tickets resolved by the agent
2. WHEN an agent navigates to the Agent_Profile view, THE Team_Member_Portal SHALL display the count of tickets currently assigned to the agent by status
3. WHEN an agent navigates to the Agent_Profile view, THE Team_Member_Portal SHALL display the average time from assignment to resolution for the agent's resolved tickets
4. THE Team_Member_Portal SHALL compute performance statistics from the ticket data returned by the Backend_API by filtering on the agent's email in the assignedTo field

### Requirement 8: Responsive Layout and Navigation

**User Story:** As an agent, I want the portal to work on both desktop and tablet devices, so that I can manage tickets from different workstations.

#### Acceptance Criteria

1. THE Team_Member_Portal SHALL provide a navigation bar with links to the Agent_Dashboard, Agent_Profile, and sign-out action
2. WHILE the viewport width is 768 pixels or less, THE Team_Member_Portal SHALL adapt the layout to a single-column mobile-friendly view
3. THE Team_Member_Portal SHALL use a consistent color scheme and typography that distinguishes it visually from the admin dashboard and user portal
4. THE Team_Member_Portal SHALL display a loading indicator during all Backend_API requests and disable action buttons to prevent duplicate submissions

### Requirement 9: Error Handling and Connectivity

**User Story:** As an agent, I want clear feedback when something goes wrong, so that I can understand the issue and take corrective action.

#### Acceptance Criteria

1. WHEN the Backend_API returns a validation error, THE Team_Member_Portal SHALL display the specific error details in a toast notification
2. WHEN the Backend_API is unreachable or returns a server error, THE Team_Member_Portal SHALL display a user-friendly message indicating the service is temporarily unavailable
3. WHEN a network request fails, THE Team_Member_Portal SHALL preserve any unsent message content or form data so the agent does not lose work
4. IF the agent's session becomes invalid during an API call, THEN THE Team_Member_Portal SHALL redirect to the sign-in form with a session-expired message
