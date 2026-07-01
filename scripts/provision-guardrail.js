/**
 * One-off provisioning: creates a Bedrock Guardrail for NovaSupport with
 * content filters + PII anonymization, publishes a version, and prints the
 * GUARDRAIL_ID and GUARDRAIL_VERSION to use at deploy time.
 *
 * Usage: node scripts/provision-guardrail.js
 * Requires valid AWS credentials (AWS_REGION optional, defaults us-east-1).
 */
const {
  BedrockClient,
  CreateGuardrailCommand,
  CreateGuardrailVersionCommand,
  ListGuardrailsCommand,
} = require('@aws-sdk/client-bedrock');

const REGION = process.env.AWS_REGION || 'us-east-1';
const NAME = 'NovaSupportGuardrail';
const client = new BedrockClient({ region: REGION });

async function findExisting() {
  try {
    const res = await client.send(new ListGuardrailsCommand({ maxResults: 100 }));
    return (res.guardrails || []).find(g => g.name === NAME);
  } catch {
    return undefined;
  }
}

async function main() {
  let guardrailId;
  const existing = await findExisting();

  if (existing) {
    guardrailId = existing.id;
    console.log(`Found existing guardrail: ${guardrailId}`);
  } else {
    const res = await client.send(
      new CreateGuardrailCommand({
        name: NAME,
        description: 'NovaSupport guardrail: content filtering + PII anonymization for AI responses.',
        blockedInputMessaging: 'This request cannot be processed because it violates our content policy.',
        blockedOutputsMessaging: 'The generated response was blocked because it violated our content policy.',
        contentPolicyConfig: {
          filtersConfig: [
            { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
            { type: 'MISCONDUCT', inputStrength: 'MEDIUM', outputStrength: 'MEDIUM' },
            { type: 'PROMPT_ATTACK', inputStrength: 'HIGH', outputStrength: 'NONE' },
          ],
        },
        sensitiveInformationPolicyConfig: {
          piiEntitiesConfig: [
            { type: 'EMAIL', action: 'ANONYMIZE' },
            { type: 'PHONE', action: 'ANONYMIZE' },
            { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
            { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
            { type: 'AWS_ACCESS_KEY', action: 'BLOCK' },
            { type: 'AWS_SECRET_KEY', action: 'BLOCK' },
            { type: 'PASSWORD', action: 'BLOCK' },
            { type: 'IP_ADDRESS', action: 'ANONYMIZE' },
          ],
        },
      })
    );
    guardrailId = res.guardrailId;
    console.log(`Created guardrail: ${guardrailId}`);
  }

  const ver = await client.send(
    new CreateGuardrailVersionCommand({
      guardrailIdentifier: guardrailId,
      description: 'Initial published version',
    })
  );
  console.log(`Published version: ${ver.version}`);
  console.log(`\nGUARDRAIL_READY id=${guardrailId} version=${ver.version}`);
}

main().catch(err => {
  console.error('Guardrail provisioning error:', err.name, err.message);
  process.exit(1);
});
