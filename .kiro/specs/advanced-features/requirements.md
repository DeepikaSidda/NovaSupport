# Requirements Document

## Introduction

This document specifies requirements for three advanced features in the NovaSupport agentic AI support ticket system: Follow-up Automation, Voice Integration (Nova 2 Sonic), and Analytics & Insights Dashboard. These features enhance the existing AWS-based system (Lambda, DynamoDB, API Gateway, S3, SQS) by adding automated follow-up scheduling, voice-based ticket creation and response playback, and a comprehensive analytics dashboard with trend visualization and team performance metrics.

## Glossary

- **Follow_Up_Scheduler**: The backend service (`src/services/follow-up-scheduler.ts`) responsible for scheduling, sending, and cancelling follow-up messages and satisfaction surveys on tickets.
- **Voice_Processor**: The backend service (`src/services/voice-processor.ts`) that uses Amazon Nova 2 Sonic for speech-to-text transcription and text-to-speech generation.
- **Analytics_Engine**: The backend service (`src/services/analytics-engine.ts`) that tracks resolution metrics, detects trends, generates alerts, and produces performance reports.
- **Admin_Portal**: The admin-facing web application (`frontend/`) running on port 3000 with Cognito authentication.
- **User_Portal**: The user-facing web application (`user-portal/`) running on port 3001 with Cognito authentication.
- **Follow_Up_Record**: A DynamoDB item representing a scheduled follow-up message or satisfaction survey, including ticketId, type, status, scheduledAt, and message content.
- **Transcription**: A structured object containing transcribed text, detected language, confidence score, and identified technical terms.
- **Performance_Report**: An aggregated analytics object containing resolution times, first response times, satisfaction scores, AI resolution percentages, top issues, and team performance breakdowns.
- **Trend**: A detected pattern of increasing ticket volume in a category, with frequency, growth rate, severity, and affected users.
- **Alert**: A notification generated when a trend exceeds thresholds (e.g., spike detection when current count exceeds 150% of 7-day average).

## Requirements

### Requirement 1: Follow-Up Scheduling Trigger

**User Story:** As a support agent, I want the system to automatically schedule follow-up messages when a ticket enters "pending user response" status, so that users are reminded to respond without manual intervention.

#### Acceptance Criteria

1. WHEN a ticket status changes to "pending_user", THE Follow_Up_Scheduler SHALL schedule a follow-up message with a default delay of 48 hours.
2. WHEN a ticket status changes to "resolved", THE Follow_Up_Scheduler SHALL schedule a satisfaction survey with a default delay of 24 hours.
3. WHEN scheduling a follow-up, THE Follow_Up_Scheduler SHALL persist a Follow_Up_Record to DynamoDB with status "pending", the scheduled timestamp, and the personalized message content.
4. IF the ticket does not exist or has an invalid ID, THEN THE Follow_Up_Scheduler SHALL return an error and not create a Follow_Up_Record.

### Requirement 2: Follow-Up Message Personalization

**User Story:** As a user, I want follow-up messages to reference my specific ticket details, so that I can quickly recall the context of my issue.

#### Acceptance Criteria

1. WHEN generating a follow-up message, THE Follow_Up_Scheduler SHALL include the ticket ID, subject, and a description excerpt (truncated to 120 characters) in the message body.
2. WHEN generating a satisfaction survey message, THE Follow_Up_Scheduler SHALL include the ticket ID and subject in the message body.
3. WHEN an agent provides a custom message, THE Follow_Up_Scheduler SHALL use the custom message instead of the generated one.

### Requirement 3: Follow-Up Cancellation

**User Story:** As a user, I want pending follow-ups to be cancelled when I respond to a ticket, so that I do not receive unnecessary reminders.

#### Acceptance Criteria

1. WHEN a user sends a message on a ticket, THE Follow_Up_Scheduler SHALL cancel all pending follow-ups for that ticket by setting their status to "cancelled" and recording the cancellation timestamp.
2. WHEN there are no pending follow-ups for a ticket, THE Follow_Up_Scheduler SHALL return a count of zero and perform no updates.

### Requirement 4: Follow-Up Processing Lambda

**User Story:** As a system operator, I want a Lambda function that processes due follow-ups, so that follow-up messages are sent at the scheduled time.

#### Acceptance Criteria

1. WHEN the follow-up processor Lambda is invoked, THE Follow_Up_Scheduler SHALL query all Follow_Up_Records with status "pending" and scheduledAt in the past.
2. WHEN a due follow-up is found, THE Follow_Up_Scheduler SHALL send the message via the notification service and update the Follow_Up_Record status to "sent".
3. IF sending a follow-up message fails, THEN THE Follow_Up_Scheduler SHALL log the error and retain the Follow_Up_Record status as "pending" for retry.

### Requirement 5: Voice Ticket Creation

**User Story:** As a user, I want to create support tickets by recording a voice message in the User Portal, so that I can describe my issue verbally instead of typing.

#### Acceptance Criteria

1. WHEN a user clicks the voice record button in the User Portal, THE User_Portal SHALL request microphone access and begin recording audio in WebM format.
2. WHEN the user stops recording, THE User_Portal SHALL upload the audio file to S3 and call the Voice_Processor to transcribe the audio.
3. WHEN transcription completes, THE User_Portal SHALL populate the ticket description field with the transcribed text and display detected technical terms.
4. IF the audio duration exceeds 300 seconds, THEN THE Voice_Processor SHALL reject the input with a descriptive error message.
5. IF the audio format is not one of wav, mp3, ogg, or webm, THEN THE Voice_Processor SHALL reject the input with a descriptive error message.

### Requirement 6: Voice Response Playback

**User Story:** As a user with accessibility needs, I want to listen to agent responses as audio, so that I can consume support responses without reading.

#### Acceptance Criteria

1. WHEN an agent response is available on a ticket, THE User_Portal SHALL display a "Play Response" button next to the response text.
2. WHEN the user clicks "Play Response", THE User_Portal SHALL call the Voice_Processor text-to-speech endpoint and play the resulting audio.
3. WHEN generating speech, THE Voice_Processor SHALL apply pronunciation corrections for technical terms using the built-in pronunciation guide.
4. IF the Voice_Processor text-to-speech service is unavailable, THEN THE User_Portal SHALL display a message indicating audio playback is temporarily unavailable.

### Requirement 7: Voice Integration API Endpoints

**User Story:** As a developer, I want API endpoints for voice transcription and text-to-speech, so that the frontend can integrate voice features.

#### Acceptance Criteria

1. THE API Gateway SHALL expose a POST endpoint at `/voice/transcribe` that accepts audio file references and returns a Transcription object.
2. THE API Gateway SHALL expose a POST endpoint at `/voice/tts` that accepts text input and returns an audio file URL.
3. WHEN the `/voice/transcribe` endpoint receives a request, THE Voice_Processor SHALL validate the audio format, duration, and language before processing.
4. WHEN the `/voice/tts` endpoint receives a request, THE Voice_Processor SHALL validate the text is non-empty, the language is supported, and the speed is between 0.5 and 2.0.

### Requirement 8: Analytics Dashboard Overview

**User Story:** As a support manager, I want to see an overview of ticket statistics on the analytics dashboard, so that I can monitor the health of the support system at a glance.

#### Acceptance Criteria

1. WHEN the analytics view loads in the Admin Portal, THE Admin_Portal SHALL display total ticket count, counts by status (new, analyzing, assigned, in_progress, pending_user, escalated, resolved, closed), and counts by priority.
2. WHEN the analytics view loads, THE Admin_Portal SHALL render bar charts for ticket distribution by status and by priority.
3. THE Admin_Portal SHALL allow the user to select a reporting period of daily, weekly, or monthly, and refresh the analytics data accordingly.

### Requirement 9: AI Performance Metrics

**User Story:** As a support manager, I want to see AI performance metrics, so that I can evaluate how effectively the AI is resolving tickets.

#### Acceptance Criteria

1. WHEN the analytics view loads, THE Admin_Portal SHALL display the AI resolution percentage, average resolution time, average first response time, and average satisfaction score for the selected period.
2. WHEN there are no resolution metrics for the selected period, THE Analytics_Engine SHALL return zero values for all numeric metrics.
3. THE Analytics_Engine SHALL calculate AI resolution percentage as the count of tickets resolved by AI divided by total resolved tickets, multiplied by 100.

### Requirement 10: Trend Detection and Alerts

**User Story:** As a support manager, I want to see detected trends and alerts, so that I can proactively address emerging issues.

#### Acceptance Criteria

1. WHEN the analytics view loads, THE Admin_Portal SHALL display detected trends with issue description, affected user count, frequency, growth rate, and severity.
2. WHEN a trend affects more than 10 users, THE Analytics_Engine SHALL generate an alert with type, description, affected user count, and recommended actions.
3. WHEN a spike is detected (current count exceeds 150% of 7-day average), THE Analytics_Engine SHALL generate a spike alert with the percentage increase.
4. WHEN a spike alert matches a critical service name, THE Analytics_Engine SHALL escalate the alert to on-call engineers.

### Requirement 11: Team Performance Metrics

**User Story:** As a support manager, I want to see per-team performance breakdowns, so that I can identify teams that need additional resources or training.

#### Acceptance Criteria

1. WHEN the analytics view loads, THE Admin_Portal SHALL display a team performance section showing each team's total tickets, average resolution time, average first response time, satisfaction score, and AI resolution percentage.
2. WHEN generating a Performance_Report, THE Analytics_Engine SHALL aggregate metrics by team using the team field from resolution metric records.
3. WHEN a team has no metrics for the selected period, THE Analytics_Engine SHALL return zero values for that team's metrics.

### Requirement 12: Analytics Data Serialization

**User Story:** As a developer, I want analytics data to be consistently serialized between the backend and frontend, so that the dashboard renders correctly.

#### Acceptance Criteria

1. WHEN the `/admin/analytics` endpoint returns data, THE Analytics_Engine SHALL serialize dates as ISO 8601 strings and numeric values as numbers.
2. WHEN the Admin_Portal receives analytics data, THE Admin_Portal SHALL parse and render all numeric metrics with appropriate formatting (percentages with one decimal, times in minutes or seconds).
