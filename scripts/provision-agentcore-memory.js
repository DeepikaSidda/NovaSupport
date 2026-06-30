/**
 * One-off provisioning script: creates the NovaSupport AgentCore Memory
 * resource and polls until it is ACTIVE, then prints the memory ID.
 *
 * Usage: node scripts/provision-agentcore-memory.js
 * Requires valid AWS credentials in the environment (AWS_REGION optional).
 */
const {
  BedrockAgentCoreControlClient,
  CreateMemoryCommand,
  GetMemoryCommand,
  ListMemoriesCommand,
} = require('@aws-sdk/client-bedrock-agentcore-control');

const REGION = process.env.AWS_REGION || 'us-east-1';
const NAME = 'NovaSupportAgentMemory';

const client = new BedrockAgentCoreControlClient({ region: REGION });

async function findExisting() {
  try {
    const res = await client.send(new ListMemoriesCommand({ maxResults: 100 }));
    const found = (res.memories || []).find(m => (m.id || '').startsWith(NAME) || m.name === NAME);
    return found;
  } catch (_e) {
    return undefined;
  }
}

async function main() {
  const existing = await findExisting();
  let memoryId;

  if (existing) {
    memoryId = existing.id;
    console.log(`Found existing memory: ${memoryId} (status: ${existing.status})`);
  } else {
    const res = await client.send(
      new CreateMemoryCommand({
        name: NAME,
        description:
          'Long-term semantic memory of NovaSupport ticket resolutions. Agents record resolved tickets and recall semantically similar past resolutions.',
        eventExpiryDuration: 90,
        memoryStrategies: [
          {
            semanticMemoryStrategy: {
              name: 'resolution_semantic',
              namespaces: ['support/resolutions/{actorId}'],
            },
          },
        ],
      })
    );
    memoryId = res.memory && res.memory.id;
    console.log(`Created memory: ${memoryId} (status: ${res.memory && res.memory.status})`);
  }

  // Poll until ACTIVE
  for (let i = 0; i < 60; i++) {
    const g = await client.send(new GetMemoryCommand({ memoryId }));
    const status = g.memory && g.memory.status;
    if (status === 'ACTIVE') {
      console.log(`\nMEMORY_READY ${memoryId}`);
      return;
    }
    if (status === 'FAILED') {
      console.error('Memory creation FAILED:', g.memory && g.memory.failureReason);
      process.exit(1);
    }
    process.stdout.write(`  status=${status} (waiting)\n`);
    await new Promise(r => setTimeout(r, 10000));
  }
  console.error('Timed out waiting for memory to become ACTIVE. Current id:', memoryId);
  process.exit(1);
}

main().catch(err => {
  console.error('Provisioning error:', err.name, err.message);
  process.exit(1);
});
