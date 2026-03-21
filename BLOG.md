# NovaSupport: Building an Agentic AI Support System with Amazon Nova

NovaSupport is a full-stack, serverless support ticket system built on AWS that uses Amazon Nova AI models as the brain behind every decision. It's not just a ticketing tool with AI sprinkled on top. It's an agentic system where multiple specialized AI agents collaborate to process, analyze, route, and resolve support tickets with minimal human intervention.

## The Architecture: Serverless and AI-Native

NovaSupport runs entirely on AWS serverless infrastructure, eliminating the need to manage servers or handle manual scaling. The system automatically scales based on demand, ensuring that operational costs remain proportional to actual usage.

The backend is built using AWS Lambda functions written in TypeScript, providing a lightweight and scalable compute layer. Amazon DynamoDB serves as the primary database, designed using a single-table architecture for efficient data access and simplified scalability.

For API communication, Amazon API Gateway manages both REST APIs and WebSocket APIs, enabling secure and real-time interactions between services and users. Amazon S3 is used to store file attachments such as documents, images, and other uploaded files. Amazon SQS handles asynchronous processing and background tasks, ensuring reliable message delivery and decoupled service communication.

User authentication and identity management across all three system portals are handled through Amazon Cognito, providing secure access control and user management.

The AI layer is powered by Amazon Nova foundation models accessed through Amazon Bedrock:

- Amazon Nova Lite handles reasoning tasks such as ticket analysis, categorization, response generation, and issue classification.
- Amazon Nova Multimodal Models analyze images, documents, and video attachments.
- Amazon Nova Embedding Models drive semantic search, similarity detection, and knowledge base retrieval.

The infrastructure is defined as code using AWS CDK, making the entire system reproducible and deployable with a single command.

## The AI Agents: A Team of Specialists

At the heart of NovaSupport are five AI agents, each with a specific role. They work together like a well-coordinated support team, passing context between each other and making decisions autonomously.

### 1. Routing Agent

When a new ticket arrives, the Routing Agent is the first component to act. It analyzes the ticket content to determine urgency, identify the required expertise, and assign the ticket to the most appropriate support team.

If multiple teams are capable of resolving the issue, the agent selects the team with the lowest current workload, ensuring balanced distribution of requests. This routing decision is completed within seconds of ticket creation.

The Routing Agent also performs sentiment analysis. If a customer's message indicates frustration or anger, this signal is passed along to influence ticket priority and handling.

### 2. Assignment Agent

After a ticket is routed to a team, the Assignment Agent determines which individual team member should handle it.

The agent evaluates:
- Current workload of each team member
- Individual expertise areas
- Agent availability

It assigns the ticket using a round-robin strategy combined with workload awareness, ensuring that tasks are distributed fairly and that no single agent becomes overloaded while others remain idle.

### 3. Escalation Agent

Not every issue can be resolved through AI automation or by frontline support agents. The Escalation Agent continuously monitors active tickets to determine when human intervention is required.

Escalation is triggered when:
- The AI confidence score falls below a defined threshold (0.7)
- The ticket contains indicators of legal, security, or compliance concerns
- Multiple automated response attempts fail to resolve the issue
- Customer sentiment suggests increasing frustration

When escalation occurs, the agent automatically compiles a summary of actions taken, reasoning behind escalation, and the urgency level. The appropriate human agent is notified within 30 seconds.

### 4. Response Agent

The Response Agent assists support teams by generating context-aware draft responses.

To create accurate replies, the agent:
- Searches the knowledge base for relevant solutions
- Reviews the customer's ticket history
- Performs sentiment analysis to adjust the tone of the response

Each generated response includes a confidence score. High confidence responses can be sent with minimal review, while low confidence responses are flagged for human editing.

The Response Agent also adapts its tone dynamically — using empathetic language for frustrated users and a more technical tone for detailed inquiries.

### 5. Chat Assistant

The Chat Assistant is the user-facing AI agent that powers the live chat widget in the customer portal.

It provides instant assistance by:
- Classifying the user's issue into categories (billing, technical, account, general)
- Searching the knowledge base and solution knowledge base (built from previously resolved tickets)
- Attempting to resolve the issue immediately

Every response includes a confidence score. High confidence responses (above 0.7) provide direct answers along with relevant documentation or referenced articles. Low confidence responses inform the user and offer to escalate the issue.

If escalation is requested, the Chat Assistant automatically:
- Creates a support ticket
- Attaches the full chat transcript
- Classifies the issue category
- Routes the ticket to the appropriate support team

## Three Portals, Three Perspectives

NovaSupport has three separate web portals, each designed for a different user role. All three are static HTML/CSS/JavaScript frontends that connect to the same backend API.

### 1. Admin Portal (The Command Center)

The Admin Portal is where support managers and administrators oversee the entire operation. It's the most feature-rich of the three portals.

#### Dashboard and Ticket Management

The dashboard shows real-time ticket statistics — total count, new tickets, in-progress, resolved, and escalated. Tickets are displayed as cards with status badges, priority indicators, assigned team/agent info, and tags. Admins can click into any ticket to see full details, update status, send messages, or resolve the ticket.

#### AI Analysis on Demand

From any ticket detail view, admins can trigger a full AI analysis powered by Amazon Nova. The AI examines the ticket content, identifies the issue type, suggests a category, estimates complexity, and provides recommended next steps.

#### Similar Ticket Detection

When viewing a ticket, the system automatically searches for similar past tickets using semantic similarity. This helps agents learn from previous resolutions and avoid duplicate work. Results show the similarity score and how the previous ticket was resolved.

#### AI-Suggested Solutions

When a ticket is opened, the system automatically queries the Solution Knowledge Base — a repository of problem-solution pairs captured from every resolved ticket. Up to five matching solutions are displayed, ranked by success rate and similarity score. Agents can apply a solution directly or provide feedback on whether it was helpful, which improves future rankings.

#### Knowledge Base Search

Admins can search the internal knowledge base using natural language queries. The search uses semantic embeddings rather than keyword matching, so it finds relevant articles even when the exact words don't match.

#### Ticket Merge

When duplicate tickets come in, admins can merge them. The merge operation:
- Copies all messages and attachments from the duplicate to the primary ticket
- Closes the duplicate with a reference to the primary
- Records the merge in both tickets' activity timelines

#### Canned Responses

Admins can create, manage, and use pre-defined response templates for common issues. When replying to a ticket, they select a canned response from a categorized dropdown, and the template text is inserted into the message field with placeholder tokens (like `{{ticketId}}`, `{{userName}}`) automatically replaced with actual ticket values.

#### Multi-Language Support

When a ticket is submitted in a non-English language, the system automatically:
- Detects the language using Amazon Translate
- Translates the content to English
- Stores both versions

Admins see both the original and translated text with a toggle to switch between them. When an admin replies in English, the response is automatically translated back to the user's language.

#### Analytics Dashboard

The analytics view provides a comprehensive overview of support operations:
- Ticket distribution by status and priority with bar charts
- AI performance metrics (resolution percentage, average resolution time, first response time, satisfaction scores)
- Detected trends with growth rates and severity
- Per-team performance breakdowns

Admins can filter by daily, weekly, or monthly periods.

#### SLA Dashboard

A dedicated SLA view shows compliance metrics at a glance:
- Total open tickets
- Breached tickets
- At-risk tickets (within 30 minutes of breach)
- Overall compliance percentage

It breaks down SLA performance by priority level and color-codes everything: green for healthy (above 90%), yellow for warning (70-90%), red for critical (below 70%).

#### Team Management

Admins can view and manage support teams, see team members, expertise areas, and workload distribution.

#### Notification Center

In-app notifications alert admins about escalations, SLA breaches, trend alerts, and ticket resolutions by team members. When a team member resolves a ticket, the admin who created it automatically receives a notification with the resolution details.

#### Ticket Bin

Deleted tickets go to a bin first, giving admins a chance to recover them. The bin supports permanent deletion, which removes the ticket and all related records from the database entirely.

#### Real-Time Updates

The portal connects via WebSocket for real-time ticket updates. When a ticket status changes or a new message arrives, the UI updates without requiring a page refresh. If the WebSocket connection drops, it falls back to polling-based auto-refresh with exponential backoff reconnection (starting at 1 second, doubling up to 30 seconds).

### 2. User Portal (The Customer Experience)

The User Portal is streamlined and focused on what customers need: submitting tickets, tracking their status, and getting help.

#### Ticket Submission

Users create tickets with a subject, description, and priority level. The form includes client-side validation and supports file attachments via drag-and-drop or file picker. Supported attachment types include:
- Images (PNG, JPEG, GIF)
- Documents (PDF, TXT, LOG)
- Videos (MP4, WEBM)
- Audio files

#### Multimodal Attachment Analysis

When users attach files, the AI doesn't just store them — it analyzes them:
- Screenshots are processed with OCR to extract error messages and UI elements
- Log files are parsed to identify error patterns and stack traces
- Documents are analyzed for key technical details
- Video recordings are broken down frame-by-frame to detect user actions and system responses

All extracted information is appended to the ticket to give agents richer context.

#### Ticket Tracking

Users see all their submitted tickets in a list sorted by creation date, with status badges and priority indicators. They can filter by status and click into any ticket for full details including assigned team, tags, and timeline.

#### Ticket Editing and Messaging

If a ticket hasn't been assigned yet (status is "new" or "analyzing"), users can directly edit the subject, description, and priority. Once a ticket is assigned to a team, the edit controls are replaced with a messaging interface where users can send comments and additional information to the support team.

#### Activity Timeline

Each ticket has a visual timeline showing status changes, messages, and resolutions in chronological order. Users see a filtered view that excludes internal activities like assignments and escalations. The timeline uses distinct icons:
- 🔄 for status changes
- 💬 for messages
- ✅ for resolutions

#### Satisfaction Rating

After a ticket is resolved, users can rate their experience with a 1–5 star widget and optional text feedback (up to 500 characters). These ratings feed into the analytics engine and help improve solution rankings over time.

#### AI Live Chat

A floating chat widget in the bottom-right corner connects users to the AI Chat Assistant. Users can describe their issue conversationally, and the AI attempts to resolve it using the knowledge base and solution database.

The chat interface includes:
- Typing indicators while waiting for responses
- Full message history for the current session
- Thumbs up/down feedback after each AI response
- "Not helpful? Connect to team" escalation button

If the AI can't help, users can escalate to a human agent with one click — the system creates a ticket with the full chat transcript and routes it to the right team.

#### Voice Input

Users can create tickets by recording a voice message instead of typing. The audio is transcribed using Amazon Nova Sonic, with support for:
- Multiple languages
- Technical vocabulary recognition
- Audio formats: WAV, MP3, OGG, WebM
- Maximum duration: 5 minutes

The transcribed text populates the ticket description field, and detected technical terms are highlighted.

#### Voice Response Playback

For accessibility, users can listen to agent responses as audio. The text-to-speech conversion uses Amazon Nova Sonic with pronunciation corrections for technical terms.

#### Merged Ticket Awareness

If a user's ticket has been merged into another, the portal displays a clear notice with a link to the primary ticket.

### 3. Team Member Portal (The Agent Workspace)

The Team Member Portal gives individual support agents a focused workspace without the overhead of admin-level features.

#### Agent Dashboard

When agents log in, they see their personal ticket queue — tickets assigned directly to them, sorted by priority. A separate section shows unassigned tickets from their team's queue that they can claim. Summary stats show ticket counts by status at a glance.

The dashboard auto-refreshes every 60 seconds to reflect new assignments.

#### Ticket Claiming

Agents can proactively pick up work by claiming unassigned team tickets. Clicking "Claim" assigns the ticket to the agent and moves it to their personal queue. If another agent claims it first, the system handles the race condition gracefully with an error message and queue refresh.

#### Ticket Workspace

Each ticket opens in a detailed workspace showing:
- Full ticket information (subject, description, status, priority, category, tags)
- Creation and last updated dates
- Assigned team and agent
- Message thread in chronological order

Agents can send messages to users, update ticket status, and resolve tickets with a resolution summary and optional root cause.

#### Resolve and Notify

When an agent resolves a ticket:
- The resolution is stored in the Solution Knowledge Base for future reuse
- An activity record is created for the timeline
- The ticket creator (admin) receives an in-app notification with the resolution details

#### Live Chat

The portal has a dedicated chat section where agents can:
- See incoming chat escalations
- Accept chat requests
- Communicate with users in real-time (messages poll every 8 seconds)
- End chats, which resolves the associated ticket

#### Filters and Navigation

The ticket queue supports filtering by status and priority. Hash-based routing enables browser back/forward navigation between views.

#### Agent Profile

Agents can view their profile showing:
- Email address and team name
- Team's expertise areas and description
- Personal performance statistics:
  - Total tickets resolved
  - Current tickets by status
  - Average time from assignment to resolution

## The Solution Knowledge Base: AI That Gets Smarter Over Time

One of the most powerful capabilities in NovaSupport is the Solution Knowledge Base. Every time a ticket is resolved, the system automatically captures both the problem description and the resolution as a structured solution record. Along with this, a vector embedding is generated and stored to enable semantic similarity search.

When a new ticket is created or a user asks a question through the chat interface, NovaSupport searches the knowledge base using cosine similarity against stored embeddings. The system retrieves the most relevant solutions and ranks them based on two factors: similarity score and success rate.

The success rate improves over time as agents and users provide feedback on whether suggested solutions were helpful. Solutions with no feedback are assigned a default success rate of 0.5 for ranking purposes.

When a matching solution has a similarity score above 0.85, the Chat Assistant boosts its response confidence by 0.15 (capped at 1.0) and indicates that the solution has been verified by the support team.

This creates a self-improving cycle: the more the platform is used, the smarter and more effective it becomes at solving future problems.

## Follow-Up Automation

NovaSupport ensures that no support request is forgotten or left unresolved.

When a ticket enters a "Pending User Response" status, the system automatically schedules a follow-up reminder after 48 hours. Similarly, once a ticket is marked as resolved, a customer satisfaction survey is scheduled to be sent 24 hours later.

Each follow-up message is automatically personalized using:
- Ticket ID
- Ticket subject
- Description excerpt (truncated to 120 characters)

If the user replies before the scheduled follow-up occurs, the system immediately cancels all pending reminders for that ticket by setting their status to "cancelled" and recording the cancellation timestamp.

Agents also have the flexibility to customize follow-up timing, frequency, and message content when needed.

A dedicated AWS Lambda function continuously monitors scheduled follow-ups and triggers notifications at the appropriate time. These messages are delivered through the notification service, ensuring users stay informed and engaged.

## Proactive Alerting and Trend Detection

The Analytics Engine in NovaSupport goes beyond simple reporting. Instead of only showing what has already happened, it actively monitors support activity to detect emerging issues and trends.

The system groups similar tickets together and analyzes their frequency, growth rate, and impact. When a specific issue begins affecting more than 10 users, the platform automatically generates an alert.

NovaSupport also performs spike detection. If the number of tickets related to a particular issue exceeds 150% of the seven-day average, the system recognizes it as an abnormal surge.

For incidents involving critical services, alerts are automatically escalated to on-call engineers.

All alerts include:
- Number of affected users
- Issue description
- Suggested next actions

These notifications are delivered through Amazon SNS email alerts as well as in-app notifications, typically within five minutes of detection.

## Intelligent Ticket Prioritization

Every incoming support ticket is automatically assigned a priority score ranging from 1 to 10.

This score is generated through AI-driven content analysis, which evaluates several factors:
- Urgency indicators in the ticket text
- Sentiment analysis to detect customer frustration
- The number of users affected
- The criticality of the impacted service

Tickets containing negative sentiment or frustrated language automatically receive a higher priority score. This ensures that the most urgent and emotionally sensitive issues receive attention faster.

As priorities are assigned, the ticket queue dynamically reorders itself, allowing support teams to focus on the most critical problems first.

## Auto-Tagging and Categorization

NovaSupport automatically classifies and organizes tickets using AI-based tagging and categorization.

Each ticket is analyzed and assigned tags based on a predefined taxonomy that includes:
- Product area
- Issue type
- Severity level

Multiple tags can be applied when necessary, and each tag is assigned a confidence score to indicate the system's certainty.

This automated classification allows managers and support teams to quickly analyze issues across different products, categories, and severity levels without requiring manual sorting.

## Real-Time WebSocket Notifications

NovaSupport uses API Gateway WebSocket API for real-time communication. When a client connects:
- A connection record is stored in DynamoDB with connectionId, userId, and timestamp
- The system tracks all active connections

When events occur (ticket status changes, new messages), the Notification Service:
- Queries all relevant WebSocket connections
- Sends JSON messages with event type, ticketId, and details
- Updates UI instantly without page refresh

If the WebSocket connection drops, portals attempt to reconnect with exponential backoff (1s → 2s → 4s → ... → 30s max) and fall back to polling-based refresh while disconnected.

## Technical Implementation Details

### Single-Table DynamoDB Design

NovaSupport uses a single DynamoDB table with composite keys for efficient data access:

```
PK: TICKET#<ticketId>           SK: METADATA
PK: TICKET#<ticketId>           SK: MESSAGE#<messageId>
PK: TICKET#<ticketId>           SK: ACTIVITY#<timestamp>#<activityId>
PK: TEAM#<teamId>               SK: MEMBER#<memberId>
PK: SOLUTION#<solutionId>       SK: METADATA
PK: SOLUTION_EMBEDDING#<id>     SK: VECTOR
PK: CHAT#<sessionId>            SK: MESSAGE#<timestamp>
PK: CANNED_RESPONSE#<id>        SK: METADATA
PK: WSCONN#<connectionId>       SK: METADATA
```

### Confidence Scoring

Each AI agent returns a confidence score between 0 and 1. The Escalation Agent uses this to decide when to involve humans:

- Confidence < 0.7 → Escalate to human
- Keywords match (legal, security, compliance) → Escalate
- Otherwise → Continue automated processing

### Semantic Search

For finding similar tickets and knowledge base articles, NovaSupport uses vector embeddings with cosine similarity:

```
similarity(A, B) = (A · B) / (||A|| × ||B||)
```

Results are filtered by minimum similarity threshold (default 0.7) and sorted by success rate, then similarity score.

### Round-Robin Assignment

To ensure fair workload distribution:

```
nextAgent = members[index % members.length]
```

The index is persisted in DynamoDB and incremented atomically to handle concurrent assignments.

## Wrapping Up

NovaSupport demonstrates the power of combining agentic AI with a modern serverless architecture.

In this system, AI agents do more than assist — they analyze problems, make decisions, take actions, and learn from outcomes. The platform's three-portal architecture ensures that each user role — customers, support agents, and administrators — has access to tools tailored to their needs.

Meanwhile, the serverless infrastructure enables the entire system to scale automatically without requiring heavy operational management.

The key insight behind NovaSupport is that AI in customer support works best not as a single monolithic model, but as a team of specialized agents working together — each contributing focused expertise to different stages of the support workflow.

In many ways, NovaSupport functions just like a real support team — only faster, smarter, and always learning.

---

Built with ❤️ using Amazon Nova, AWS Lambda, DynamoDB, and the power of agentic AI.
