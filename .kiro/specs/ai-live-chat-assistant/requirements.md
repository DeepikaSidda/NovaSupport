# Requirements Document

## Introduction

Add an AI-powered live chat assistant to the NovaSupport user portal that provides instant support using Amazon Nova AI. The chat widget appears as a floating button on the user portal. Users can chat with the AI assistant, which classifies issues, searches the knowledge base and past resolved tickets, auto-answers known problems, and escalates to a human team when needed by auto-creating a ticket with full chat context.

## Glossary

- **Chat_Widget**: The floating UI component in the user portal that provides the chat interface, including the chat bubble button, message window, input field, and escalation controls.
- **Chat_Assistant_Handler**: The backend Lambda function (POST /chat) that receives user messages, orchestrates AI processing, and returns responses.
- **Chat_Session**: A conversation between a user and the AI assistant, identified by a unique session ID, with all messages persisted in DynamoDB using the CHAT# prefix.
- **Issue_Classifier**: The component within the Chat_Assistant_Handler that uses Nova AI to classify user messages into categories: billing, technical, account, or general.
- **Confidence_Score**: A numeric value between 0 and 1 indicating how confident the AI is in its response, derived from knowledge base relevance and similar ticket match quality.
- **Escalation**: The process of creating a support ticket with the full chat transcript and routing it to the relevant team when the AI cannot resolve the issue or the user requests human help.
- **Nova_AI**: The Amazon Nova Lite model (amazon.nova-lite-v1:0) accessed via AWS Bedrock, used for message understanding, issue classification, and response generation.
- **Knowledge_Base_Service**: The existing service (src/services/knowledge-base.ts) that performs semantic search over knowledge base articles.
- **Similar_Ticket_Service**: The existing service (src/services/similar-ticket-search.ts) that finds historically similar tickets using vector similarity.

## Requirements

### Requirement 1: Chat Message Processing

**User Story:** As a user, I want to send messages to the AI chat assistant and receive helpful responses, so that I can get instant support without waiting for a human agent.

#### Acceptance Criteria

1. WHEN a user sends a message with a valid session ID and conversation history, THE Chat_Assistant_Handler SHALL return an AI-generated response within 10 seconds.
2. WHEN a user sends a message, THE Issue_Classifier SHALL classify the message into exactly one category: billing, technical, account, or general.
3. WHEN a message is classified, THE Chat_Assistant_Handler SHALL search the Knowledge_Base_Service and Similar_Ticket_Service for relevant context before generating a response.
4. THE Chat_Assistant_Handler SHALL include a Confidence_Score between 0 and 1 with every response.
5. WHEN the Confidence_Score is above 0.7, THE Chat_Assistant_Handler SHALL include the answer directly in the response along with referenced knowledge base articles.
6. WHEN the Confidence_Score is 0.7 or below, THE Chat_Assistant_Handler SHALL indicate low confidence and suggest escalation to a human agent.

### Requirement 2: Chat Session Persistence

**User Story:** As a user, I want my chat history to be saved, so that I can refer back to previous messages and so that escalation includes full context.

#### Acceptance Criteria

1. WHEN a chat message is sent or received, THE Chat_Assistant_Handler SHALL store the message in DynamoDB with partition key CHAT#{sessionId} and sort key MESSAGE#{timestamp}.
2. THE Chat_Session record SHALL include the fields: sessionId, userId, role (user or assistant), content, timestamp, and category.
3. WHEN a new Chat_Session is started, THE Chat_Assistant_Handler SHALL generate a unique session ID and store an initial greeting message.
4. WHEN a Chat_Session is retrieved, THE Chat_Assistant_Handler SHALL return messages ordered by timestamp ascending.

### Requirement 3: Escalation to Human Support

**User Story:** As a user, I want to escalate to a human agent when the AI cannot resolve my issue, so that I can get help from a real person.

#### Acceptance Criteria

1. WHEN a user requests escalation, THE Chat_Assistant_Handler SHALL create a new support ticket with the full chat transcript as the description.
2. WHEN a ticket is created via escalation, THE Chat_Assistant_Handler SHALL route the ticket to the team matching the classified issue category (billing to billing team, technical to technical-support team, account to account-management team, general to general-support team).
3. WHEN escalation completes, THE Chat_Assistant_Handler SHALL return the created ticket ID to the user.
4. WHEN a user requests escalation, THE Chat_Assistant_Handler SHALL include a summary of the conversation and the classified issue category in the ticket subject.

### Requirement 4: Chat Widget UI

**User Story:** As a user, I want a chat widget on the portal that is easy to use and visually consistent, so that I can access AI support without leaving the page.

#### Acceptance Criteria

1. THE Chat_Widget SHALL render a floating button in the bottom-right corner of the user portal.
2. WHEN the user clicks the chat button, THE Chat_Widget SHALL open a chat window with the greeting message "Hi! I'm NovaSupport AI. How can I help you today?".
3. WHEN the user types a message and presses Enter or clicks the send button, THE Chat_Widget SHALL send the message to the Chat_Assistant_Handler and display a typing indicator while waiting for the response.
4. WHEN a response is received, THE Chat_Widget SHALL display the AI response in the chat window and remove the typing indicator.
5. THE Chat_Widget SHALL display an escalation button labeled "Not helpful? Connect to team" below AI responses.
6. WHEN the user clicks the escalation button, THE Chat_Widget SHALL ask for confirmation before proceeding with escalation.
7. WHEN escalation is confirmed and completes, THE Chat_Widget SHALL display the ticket ID and the assigned team name to the user.
8. THE Chat_Widget SHALL display a satisfaction feedback mechanism (thumbs up and thumbs down) after each AI response.
9. WHEN the chat window is open, THE Chat_Widget SHALL display the full message history for the current session.

### Requirement 5: Chat API Integration

**User Story:** As a developer, I want the chat endpoint integrated into the existing API Gateway with Cognito authentication, so that the chat feature is secure and consistent with the rest of the system.

#### Acceptance Criteria

1. THE Chat_Assistant_Handler SHALL be deployed as a Lambda function accessible via POST /chat on the existing API Gateway.
2. THE Chat_Assistant_Handler SHALL require Cognito authentication using the same authorizer as other endpoints.
3. IF the Nova_AI service is unavailable, THEN THE Chat_Assistant_Handler SHALL return a fallback response indicating temporary unavailability and suggesting the user create a ticket manually.
4. IF the request body is missing required fields (message, sessionId, userId), THEN THE Chat_Assistant_Handler SHALL return a 400 error with descriptive validation messages.

### Requirement 6: CDK Infrastructure

**User Story:** As a developer, I want the chat Lambda and API route defined in the CDK stack, so that the infrastructure is managed as code alongside the existing resources.

#### Acceptance Criteria

1. THE NovaSupportStack SHALL define a new Lambda function for the Chat_Assistant_Handler with the same role, environment variables, and code asset as other handlers.
2. THE NovaSupportStack SHALL add a POST /chat route to the existing API Gateway with Cognito authorization.
3. THE Chat_Assistant_Handler Lambda SHALL have a timeout of 30 seconds and 1024 MB memory to accommodate AI processing.
