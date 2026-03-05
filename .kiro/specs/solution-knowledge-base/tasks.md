# Implementation Plan: Solution Knowledge Base

## Overview

Implement the solution knowledge base that captures problem-solution pairs from resolved tickets, stores them with vector embeddings in DynamoDB, and enables AI chat agents to auto-solve similar issues using similarity search. The implementation follows an incremental approach: types first, then the core service, then the resolve-ticket handler, then chat assistant integration, and finally CDK infrastructure wiring.

## Tasks

- [ ] 1. Define solution types
  - [ ] 1.1 Create `src/types/solution.ts`
    - Define `SolutionRecord`, `SolutionEmbeddingRecord`, `SolutionMatch`, `StoreSolutionInput`, `FindSolutionsOptions`, and `ResolveTicketRequest` interfaces
    - `SolutionRecord` uses PK `SOLUTION#<solutionId>`, SK `METADATA` with fields: solutionId, ticketId, problem, resolution, rootCause, category, tags, resolvedBy, successCount, failureCount, createdAt, updatedAt
    - `SolutionEmbeddingRecord` uses PK `SOLUTION_EMBEDDING#<solutionId>`, SK `VECTOR` with fields: solutionId, problemText, resolutionText, vector, category, createdAt
    - `SolutionMatch` includes solutionId, ticketId, problem, resolution, similarityScore, successRate, category
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

- [ ] 2. Implement solution knowledge base service
  - [x] 2.1 Create `src/services/solution-knowledge-base.ts` with `storeSolution()`
    - Validate all required fields (ticketId, subject, description, resolution, resolvedBy); throw on empty/missing
    - Validate resolution is at least 10 characters
    - Generate solutionId with `SOL-` prefix using uuid
    - Combine problem + resolution text and generate embedding via `generateEmbeddingWithFallback`
    - Store SolutionRecord (PK `SOLUTION#<id>`, SK `METADATA`) with successCount=0, failureCount=0
    - Store SolutionEmbeddingRecord (PK `SOLUTION_EMBEDDING#<id>`, SK `VECTOR`) with the embedding vector
    - Return the created SolutionRecord
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.2 Implement `findMatchingSolutions()` in the service
    - Return empty array for empty/whitespace-only queries
    - Generate query embedding via `generateEmbeddingWithFallback`
    - Scan all `SOLUTION_EMBEDDING#` items from DynamoDB
    - Compute cosine similarity between query vector and each stored vector
    - Filter results by minSimilarity threshold (default 0.7)
    - Fetch SolutionRecord metadata for each matching embedding
    - Compute successRate (default 0.5 for zero-feedback solutions)
    - Sort by successRate descending, then similarityScore descending
    - Return top N results (default limit 5)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 2.3 Implement `recordSolutionFeedback()` in the service
    - Increment successCount by 1 if wasHelpful is true, failureCount by 1 if false
    - Update updatedAt timestamp
    - No other fields modified
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 2.4 Implement `getSolution()` in the service
    - Fetch SolutionRecord by PK `SOLUTION#<solutionId>`, SK `METADATA`
    - Return the record or undefined if not found
    - No side effects
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 2.5 Write property test: store solution round trip
    - **Property 1: Store solution round trip**
    - Test that for any valid StoreSolutionInput, storing and retrieving produces a matching SolutionRecord with SOL- prefix, counters at 0, and valid timestamps
    - Create `test/solution-knowledge-base-store-roundtrip.property.test.ts`
    - **Validates: Requirements 2.1, 2.3, 2.4, 5.1**

  - [ ]* 2.6 Write property test: invalid input rejection
    - **Property 2: Invalid input rejection**
    - Test that storeSolution rejects inputs with empty/missing required fields or resolution < 10 chars
    - Create `test/solution-knowledge-base-invalid-input.property.test.ts`
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 2.7 Write property test: similarity threshold filtering
    - **Property 3: Similarity threshold filtering**
    - Test that all returned SolutionMatch results have similarityScore >= minSimilarity and count <= limit
    - Create `test/solution-knowledge-base-similarity-threshold.property.test.ts`
    - **Validates: Requirements 3.2, 3.4**

  - [ ]* 2.8 Write property test: search result ordering
    - **Property 4: Search result ordering**
    - Test that results are sorted by successRate desc then similarityScore desc, with default 0.5 for unrated
    - Create `test/solution-knowledge-base-search-ordering.property.test.ts`
    - **Validates: Requirements 3.3, 3.6**

  - [ ]* 2.9 Write property test: empty query returns empty results
    - **Property 5: Empty query returns empty results**
    - Test that whitespace-only and empty strings return an empty array
    - Create `test/solution-knowledge-base-empty-query.property.test.ts`
    - **Validates: Requirement 3.7**

  - [ ]* 2.10 Write property test: feedback increments exactly one counter
    - **Property 6: Feedback increments exactly one counter**
    - Test that recording feedback increments only the correct counter and leaves all other fields unchanged
    - Create `test/solution-knowledge-base-feedback.property.test.ts`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 2.11 Write property test: getSolution is side-effect free
    - **Property 7: getSolution is side-effect free**
    - Test that calling getSolution twice returns identical records with no data changes
    - Create `test/solution-knowledge-base-get-idempotent.property.test.ts`
    - **Validates: Requirements 5.1, 5.3**

- [ ] 3. Checkpoint - Ensure service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement resolve-ticket handler
  - [x] 4.1 Create `src/handlers/resolve-ticket.ts`
    - Implement `handler(event)` Lambda entry point with CORS headers
    - Extract ticketId from path parameters; return 400 if missing
    - Parse and validate request body: require resolution (non-empty) and resolvedBy (non-empty); return 400 with descriptive message on failure
    - Fetch existing ticket from DynamoDB (`TICKET#<ticketId>`, `METADATA`); return 404 if not found
    - Update ticket status to "resolved", set resolvedAt, updatedAt, resolution, rootCause, and GSI2PK
    - Call `storeSolution()` with ticket data and resolution details
    - Return success response with ticketId, status, and resolvedAt
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 4.2 Write unit tests for resolve-ticket handler
    - Create `test/resolve-ticket.test.ts`
    - Test successful resolution stores solution and updates ticket
    - Test 400 for missing resolution, missing resolvedBy, missing ticketId
    - Test 404 for non-existent ticket
    - Mock DynamoDB and solution KB service calls
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 5. Integrate solution KB into chat assistant
  - [x] 5.1 Modify `src/handlers/chat-assistant.ts` to search solution KB
    - Import `findMatchingSolutions` from solution-knowledge-base service
    - In `processMessage()`, call `findMatchingSolutions(message, { limit: 3, minSimilarity: 0.7 })` before building the AI prompt
    - Wrap in try/catch: log warning and continue without solutions on failure
    - _Requirements: 6.1, 6.4_

  - [x] 5.2 Add solution context to AI prompt in `src/handlers/chat-assistant.ts`
    - Build solution context string with resolution text, similarity score %, and success rate % for each match
    - Inject into the Nova AI prompt with instructions to present proven solutions first
    - Include note that solutions have been verified by the support team
    - _Requirements: 6.2, 6.5_

  - [x] 5.3 Implement confidence boosting in `src/handlers/chat-assistant.ts`
    - When top solution match has similarityScore > 0.85, boost confidence by 0.15 capped at 1.0
    - Apply adjusted confidence to the response
    - _Requirements: 6.3_

  - [ ]* 5.4 Write property test: confidence boosting is bounded
    - **Property 8: Confidence boosting is bounded**
    - Test that for any base confidence in [0,1] and similarityScore > 0.85, adjusted = min(1.0, base + 0.15)
    - Create `test/solution-kb-confidence-boost.property.test.ts`
    - **Validates: Requirement 6.3**

  - [ ]* 5.5 Write property test: solution context in prompt
    - **Property 9: Solution context in prompt**
    - Test that for any non-empty SolutionMatch array, the prompt context contains resolution text, similarity %, and success rate % for each match
    - Create `test/solution-kb-prompt-context.property.test.ts`
    - **Validates: Requirement 6.2**

  - [ ]* 5.6 Write unit tests for chat assistant solution KB integration
    - Update `test/chat-assistant.test.ts` or create new test file
    - Test that processMessage calls findMatchingSolutions
    - Test that solution context is included in AI prompt when matches found
    - Test that confidence is boosted when top match > 0.85 similarity
    - Test graceful fallback when solution KB search fails
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 6. Checkpoint - Ensure all handler and integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. CDK infrastructure updates
  - [ ] 7.1 Add resolve-ticket Lambda and API route to `lib/novasupport-stack.ts`
    - Add `ResolveTicketFunction` Lambda with handler `src/handlers/resolve-ticket.handler`, timeout 30s, memory 512 MB
    - Add `/tickets/{id}/resolve` resource to API Gateway
    - Add PUT method with Cognito authorizer
    - Use same `lambdaRole`, `lambdaEnvironment`, and `lambda.Code.fromAsset('dist')` as other handlers
    - _Requirements: 1.1_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 9 correctness properties from the design document
- The service uses the existing DynamoDB single-table design and embedding client patterns
