/**
 * Backfill script: seeds existing resolved tickets into AgentCore Memory so
 * semantic recall has a real corpus immediately (instead of waiting for new
 * resolutions).
 *
 * Usage:
 *   AGENTCORE_MEMORY_ID=<id> TICKETS_TABLE_NAME=<table> node scripts/seed-agentcore-memory.js
 *
 * Optional env:
 *   SEED_MAX        Max tickets to seed (default 300, to control extraction cost)
 *   SEED_DELAY_MS   Delay between writes in ms (default 150)
 *
 * COST NOTE: each CreateEvent triggers background semantic extraction, which
 * incurs AWS charges. The SEED_MAX cap keeps this bounded.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const {
  BedrockAgentCoreClient,
  CreateEventCommand,
  Role,
} = require('@aws-sdk/client-bedrock-agentcore');

const REGION = process.env.AWS_REGION || 'us-east-1';
const MEMORY_ID = process.env.AGENTCORE_MEMORY_ID || 'NovaSupportAgentMemory-rFist4BOEd';
const TABLE = process.env.TICKETS_TABLE_NAME || 'NovaSupportStack-TicketsTableB76A19AF-YI6Y347YGV92';
const MAX = parseInt(process.env.SEED_MAX || '300', 10);
const DELAY_MS = parseInt(process.env.SEED_DELAY_MS || '150', 10);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const memory = new BedrockAgentCoreClient({ region: REGION });

function toActorId(value) {
  const cleaned = (value || 'novasupport').replace(/[^a-zA-Z0-9\-_/]/g, '-');
  return /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : `team-${cleaned}`;
}
function toSessionId(value) {
  const cleaned = String(value).replace(/[^a-zA-Z0-9\-_]/g, '-');
  return /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : `tkt-${cleaned}`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function* resolvedTickets() {
  let lastKey;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': 'STATUS#resolved' },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items || []) yield item;
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
}

async function main() {
  console.log(`Seeding AgentCore Memory ${MEMORY_ID} from resolved tickets in ${TABLE} (max ${MAX})`);
  let seeded = 0;
  let skipped = 0;

  for await (const t of resolvedTickets()) {
    if (seeded >= MAX) break;
    const resolution = (t.resolution || '').toString().trim();
    if (!resolution) {
      skipped++;
      continue;
    }
    const subject = (t.subject || '').toString();
    const description = (t.description || '').toString();
    const resolutionText = t.rootCause
      ? `${resolution}\n\nRoot cause: ${String(t.rootCause).trim()}`
      : resolution;

    try {
      await memory.send(
        new CreateEventCommand({
          memoryId: MEMORY_ID,
          actorId: toActorId(t.assignedTeam),
          sessionId: toSessionId(t.ticketId || t.PK),
          eventTimestamp: new Date(),
          payload: [
            { conversational: { role: Role.USER, content: { text: `${subject}\n\n${description}`.slice(0, 4000) } } },
            { conversational: { role: Role.ASSISTANT, content: { text: resolutionText.slice(0, 4000) } } },
          ],
        })
      );
      seeded++;
      if (seeded % 25 === 0) console.log(`  seeded ${seeded}...`);
      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  failed for ${t.ticketId}: ${e.name} ${e.message}`);
    }
  }

  console.log(`\nDone. Seeded ${seeded} resolved tickets (skipped ${skipped} without a resolution).`);
  console.log('Note: semantic extraction runs asynchronously; recall results populate over the next few minutes.');
}

main().catch(e => {
  console.error('Seed error:', e.name, e.message);
  process.exit(1);
});
