# Implementation Plan: Advanced Features

## Overview

This plan implements three feature areas: Follow-up Automation (wiring existing scheduler into ticket lifecycle), Voice Integration (new API endpoints + User Portal UI), and Analytics Dashboard (enhanced Admin Portal rendering + team performance). All code is TypeScript (Lambda handlers, services) and vanilla JS (frontend portals).

## Tasks

- [x] 1. Wire follow-up scheduling into ticket status changes
  - [x] 1.1 Modify `src/handlers/update-ticket-status.ts` to call `scheduleFollowUp` when status changes to `pending_user` and `scheduleSatisfactionSurvey` when status changes to `resolved`
    - Import `scheduleFollowUp`, `scheduleSatisfactionSurvey` from `../services/follow-up-scheduler`
    - After successful status update, reconstruct a minimal Ticket object from the existing DynamoDB record and call the appropriate scheduler function
    - Wrap scheduler calls in try/catch so scheduling failures don't block the status update response
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Modify `src/handlers/ticket-messages.ts` to call `cancelPendingFollowUps` when a user sends a message
    - Import `cancelPendingFollowUps` from `../services/follow-up-scheduler`
    - After successful message creation in `handlePost`, call `cancelPendingFollowUps(ticketId)`
    - Wrap in try/catch so cancellation failures don't block the message response
    - _Requirements: 3.1_

  - [ ]* 1.3 Write property tests for follow-up scheduling and cancellation
    - Extend `test/follow-up-scheduler.property.test.ts` with new properties
    - **Property 1: Follow-up scheduling produces correct records on status change**
    - **Property 2: Message personalization includes ticket context**
    - **Property 3: Custom message overrides generated content**
    - **Property 4: Cancellation sets all pending follow-ups to cancelled**
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1**

- [x] 2. Create follow-up processing Lambda
  - [x] 2.1 Create `src/handlers/process-follow-ups.ts` Lambda handler
    - Implement a scheduled handler (no API Gateway event, uses ScheduledEvent or plain invocation)
    - Scan DynamoDB for Follow_Up_Records with status "pending" and scheduledAt <= now
    - For each due record, call `sendFollowUpNotification` from notification service and update record status to "sent"
    - On failure, log error and leave record as "pending" for retry
    - Return a summary: `{ processed: number, failed: number, errors: Array<{ ticketId: string; error: string }> }`
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 2.2 Write unit tests for process-follow-ups handler
    - Create `test/process-follow-ups.test.ts`
    - Test: processes due follow-ups and updates status to "sent"
    - Test: skips follow-ups with scheduledAt in the future
    - Test: handles notification service failure gracefully (record stays "pending")
    - Test: returns correct processed/failed counts
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Checkpoint - Follow-up automation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create voice API endpoints
  - [x] 4.1 Create `src/handlers/voice-transcribe.ts` Lambda handler
    - Accept POST request with body: `{ s3Key?, audioData?, format, language?, duration }`
    - Validate inputs (format, duration, language) before calling `transcribeSpeech` from voice-processor
    - Return `{ text, language, confidence, detectedTechnicalTerms }`
    - Return 400 for validation errors with descriptive messages
    - _Requirements: 7.1, 7.3, 5.4, 5.5_

  - [x] 4.2 Create `src/handlers/voice-tts.ts` Lambda handler
    - Accept POST request with body: `{ text, language?, voice?, speed? }`
    - Validate inputs (non-empty text, supported language, speed range) before calling `generateSpeech` from voice-processor
    - Return `{ url, duration, format }`
    - Return 400 for validation errors with descriptive messages
    - _Requirements: 7.2, 7.4_

  - [ ]* 4.3 Write property tests for voice input validation
    - Extend `test/voice-processing.property.test.ts`
    - **Property 5: Voice input validation rejects invalid inputs**
    - **Property 6: TTS input validation rejects invalid inputs**
    - **Property 7: Pronunciation guide replaces technical terms**
    - **Validates: Requirements 5.4, 5.5, 6.3, 7.3, 7.4**

  - [ ]* 4.4 Write unit tests for voice handlers
    - Create `test/voice-handlers.test.ts`
    - Test: transcribe handler returns transcription for valid input
    - Test: transcribe handler returns 400 for invalid format/duration
    - Test: TTS handler returns audio URL for valid input
    - Test: TTS handler returns 400 for empty text or invalid speed
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 5. Integrate voice features into User Portal
  - [x] 5.1 Enhance voice recording in `user-portal/portal-app.js` to call transcription API
    - Modify `handleVoiceRecord` (or create new function) to upload recorded audio to S3 via presigned URL, then call `/voice/transcribe`
    - On transcription success, populate the ticket description field with transcribed text
    - Display detected technical terms as tags below the description field
    - Show recording duration and transcription status indicators
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.2 Add TTS playback to User Portal ticket detail and chat
    - Add a "🔊 Listen" button next to agent/assistant messages in ticket detail view and chat bubbles
    - On click, call `/voice/tts` with the message text and play the returned audio URL using HTML5 Audio API
    - Show loading state while TTS is processing, error state if unavailable
    - Add the API methods `transcribeAudio` and `textToSpeech` to `user-portal/portal-api.js`
    - _Requirements: 6.1, 6.2, 6.4_

- [x] 6. Checkpoint - Voice integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Enhance analytics dashboard
  - [x] 7.1 Enhance `src/handlers/get-analytics.ts` to return richer data
    - Add time-series ticket counts (tickets per day for the selected period) to the response
    - Ensure the performance report includes team performance data
    - Add top issues list from the performance report to the response
    - _Requirements: 8.1, 9.1, 11.1_

  - [x] 7.2 Enhance Admin Portal analytics view in `frontend/app.js`
    - Add a team performance table below the existing charts showing: team name, total tickets, avg resolution time, avg first response time, satisfaction score, AI resolved %
    - Add a top issues section showing issue categories ranked by count
    - Enhance trend alerts display with severity color coding (high=red, medium=orange, low=yellow) and recommended action tags
    - Add category distribution bar chart alongside existing status and priority charts
    - _Requirements: 8.1, 8.2, 9.1, 10.1, 11.1_

  - [ ]* 7.3 Write property tests for analytics calculations
    - Extend `test/analytics-engine.property.test.ts`
    - **Property 8: AI resolution percentage calculation**
    - **Property 9: Trend alert generation threshold**
    - **Property 10: Spike detection threshold**
    - **Property 11: Critical service escalation matching**
    - **Property 12: Performance report team aggregation correctness**
    - **Property 13: Time range period calculation**
    - **Validates: Requirements 9.3, 10.2, 10.3, 10.4, 9.1, 11.2, 12.1**

  - [ ]* 7.4 Write unit tests for enhanced analytics handler
    - Create `test/analytics-dashboard.test.ts`
    - Test: handler returns overview with status, priority, and category counts
    - Test: handler returns performance report with team breakdowns
    - Test: handler returns trends and alerts
    - Test: handler handles missing data gracefully (null performance report, null trends)
    - _Requirements: 8.1, 9.1, 10.1, 11.1_

- [x] 8. Add CDK infrastructure for new Lambda handlers and API routes
  - [x] 8.1 Update `lib/novasupport-stack.ts` with new Lambda functions and API Gateway routes
    - Add Lambda function for `voice-transcribe` handler with Bedrock invoke permissions
    - Add Lambda function for `voice-tts` handler with Bedrock invoke and S3 write permissions
    - Add Lambda function for `process-follow-ups` handler with DynamoDB read/write permissions
    - Add EventBridge rule to invoke `process-follow-ups` every 15 minutes
    - Add API Gateway routes: POST `/voice/transcribe`, POST `/voice/tts`
    - Grant appropriate IAM permissions (DynamoDB, S3, Bedrock, SNS)
    - _Requirements: 4.1, 7.1, 7.2_

- [x] 9. Final checkpoint - All features integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The existing services (`follow-up-scheduler.ts`, `voice-processor.ts`, `analytics-engine.ts`) are already implemented; this plan focuses on wiring them into handlers and UI
