# Requirements Document

## Introduction

This feature captures problem-solution pairs from resolved support tickets into a searchable knowledge base. When support agents resolve a ticket, the resolution text and root cause are stored as a solution record in DynamoDB alongside a vector embedding for similarity search. AI chat agents query this knowledge base to automatically find and present proven solutions to users with similar issues. A feedback loop tracks solution effectiveness to improve ranking over time.

## Glossary

- **Solution_Knowledge_Base_Service**: The service (src/services/solution-knowledge-base.ts) that manages storing, retrieving, and searching solution records using vector similarity.
- **Resolve_Ticket_Handler**: The Lambda function (PUT /tickets/{id}/resolve) that updates a ticket to resolved status and triggers solution storage.
- **SolutionRecord**: A DynamoDB item with PK `SOLUTION#<solutionId>` and SK `METADATA` containing the problem description, resolution text, root cause, feedback counts, and metadata.
- **SolutionEmbeddingRecord**: A DynamoDB item with PK `SOLUTION_EMBEDDING#<solutionId>` and SK `VECTOR` containing the vector embedding of the combined problem and resolution text.
- **SolutionMatch**: A result object returned from similarity search containing the solution details, similarity score, and success rate.
- **Embedding_Client**: The existing utility (src/utils/embedding-client.ts) that generates vector embeddings from text using Amazon Bedrock.
- **Chat_Assistant_Handler**: The existing Lambda function (POST /chat) that processes user messages and generates AI responses.
- **Cosine_Similarity**: A mathematical measure of similarity between two vectors, producing a value between -1 and 1, where 1 indicates identical direction.
- **Success_Rate**: The ratio of successCount to total feedback count (successCount + failureCount) for a solution, used to rank solutions by effectiveness.

## Requirements

### Requirement 1: Ticket Resolution and Solution Capture

**User Story:** As a support agent, I want to resolve a ticket with a resolution description, so that the solution is automatically captured into the knowledge base for future reuse.

#### Acceptance Criteria

1. WHEN a support agent sends a PUT request to /tickets/{id}/resolve with a valid resolution and resolvedBy field, THE Resolve_Ticket_Handler SHALL update the ticket status to "resolved" and store the resolution text on the ticket record.
2. WHEN a ticket is resolved successfully, THE Resolve_Ticket_Handler SHALL call the Solution_Knowledge_Base_Service to store the problem-solution pair as a new SolutionRecord.
3. IF the ticketId in the path does not match an existing ticket, THEN THE Resolve_Ticket_Handler SHALL return a 404 error with the message "Ticket not found".
4. IF the request body is missing the resolution field or the resolution is empty, THEN THE Resolve_Ticket_Handler SHALL return a 400 error with a descriptive validation message.
5. IF the request body is missing the resolvedBy field or the resolvedBy is empty, THEN THE Resolve_Ticket_Handler SHALL return a 400 error with a descriptive validation message.

### Requirement 2: Solution Storage

**User Story:** As the system, I want to store resolved ticket solutions with vector embeddings, so that they can be retrieved via similarity search later.

#### Acceptance Criteria

1. WHEN the Solution_Knowledge_Base_Service stores a solution, THE Solution_Knowledge_Base_Service SHALL generate a unique solutionId with the prefix "SOL-" and create a SolutionRecord in DynamoDB with PK `SOLUTION#<solutionId>` and SK `METADATA`.
2. WHEN the Solution_Knowledge_Base_Service stores a solution, THE Solution_Knowledge_Base_Service SHALL generate a vector embedding from the combined problem and resolution text using the Embedding_Client and store it as a SolutionEmbeddingRecord with PK `SOLUTION_EMBEDDING#<solutionId>` and SK `VECTOR`.
3. WHEN a new SolutionRecord is created, THE Solution_Knowledge_Base_Service SHALL initialize successCount and failureCount to 0.
4. WHEN a new SolutionRecord is created, THE Solution_Knowledge_Base_Service SHALL set createdAt and updatedAt to the current ISO 8601 timestamp.
5. IF the resolution text is fewer than 10 characters, THEN THE Solution_Knowledge_Base_Service SHALL reject the input with a validation error.
6. IF any required field (ticketId, subject, description, resolution, resolvedBy) is empty or missing, THEN THE Solution_Knowledge_Base_Service SHALL reject the input with a validation error identifying the missing field.

### Requirement 3: Solution Similarity Search

**User Story:** As an AI chat agent, I want to search the knowledge base for solutions similar to a user's problem, so that I can suggest proven resolutions automatically.

#### Acceptance Criteria

1. WHEN the Solution_Knowledge_Base_Service receives a search query, THE Solution_Knowledge_Base_Service SHALL generate a vector embedding of the query text and compute Cosine_Similarity against all stored SolutionEmbeddingRecords.
2. THE Solution_Knowledge_Base_Service SHALL return only SolutionMatch results with a similarityScore greater than or equal to the minSimilarity threshold (default 0.7).
3. THE Solution_Knowledge_Base_Service SHALL sort returned SolutionMatch results by Success_Rate descending, then by similarityScore descending.
4. THE Solution_Knowledge_Base_Service SHALL return at most the number of results specified by the limit option (default 5).
5. WHEN no stored solutions meet the similarity threshold, THE Solution_Knowledge_Base_Service SHALL return an empty array.
6. WHEN a solution has no feedback (zero successCount and zero failureCount), THE Solution_Knowledge_Base_Service SHALL assign a default Success_Rate of 0.5 for ranking purposes.
7. IF the search query is empty or whitespace-only, THEN THE Solution_Knowledge_Base_Service SHALL return an empty array without generating an embedding.

### Requirement 4: Solution Feedback

**User Story:** As the system, I want to record whether a suggested solution was helpful, so that solution rankings improve over time based on real outcomes.

#### Acceptance Criteria

1. WHEN feedback is recorded with wasHelpful set to true, THE Solution_Knowledge_Base_Service SHALL increment the successCount of the SolutionRecord by 1.
2. WHEN feedback is recorded with wasHelpful set to false, THE Solution_Knowledge_Base_Service SHALL increment the failureCount of the SolutionRecord by 1.
3. WHEN feedback is recorded, THE Solution_Knowledge_Base_Service SHALL update the updatedAt timestamp to the current ISO 8601 value.
4. WHEN feedback is recorded, THE Solution_Knowledge_Base_Service SHALL not modify any fields other than successCount, failureCount, and updatedAt.

### Requirement 5: Solution Retrieval

**User Story:** As a support agent or system component, I want to retrieve a specific solution by its ID, so that I can view the full solution details.

#### Acceptance Criteria

1. WHEN a valid solutionId is provided, THE Solution_Knowledge_Base_Service SHALL return the corresponding SolutionRecord.
2. WHEN a solutionId does not match any stored solution, THE Solution_Knowledge_Base_Service SHALL return undefined.
3. THE getSolution function SHALL produce no side effects on the stored data.

### Requirement 6: Chat Assistant Integration

**User Story:** As a user chatting with the AI assistant, I want the assistant to automatically suggest proven solutions from the knowledge base, so that I get faster and more reliable answers.

#### Acceptance Criteria

1. WHEN processing a user message, THE Chat_Assistant_Handler SHALL query the Solution_Knowledge_Base_Service for matching solutions with a limit of 3 and minSimilarity of 0.7.
2. WHEN matching solutions are found, THE Chat_Assistant_Handler SHALL include the solution text, similarity score, and Success_Rate in the AI prompt context.
3. WHEN a matching solution has a similarityScore above 0.85, THE Chat_Assistant_Handler SHALL boost the response confidence by 0.15, capped at 1.0.
4. IF the Solution_Knowledge_Base_Service query fails, THEN THE Chat_Assistant_Handler SHALL log a warning and continue processing the message without solution context.
5. WHEN presenting a proven solution to the user, THE Chat_Assistant_Handler SHALL indicate that the solution has been verified by the support team.
