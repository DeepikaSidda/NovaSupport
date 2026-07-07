# NovaSupport Knowledge Base (sample)

This folder is what the Ops Copilot reads through the filesystem MCP server.
Add exported tickets and knowledge articles here (Markdown/JSON/txt).

---

## Article: Password reset returns 500 error
Symptom: Users click the reset-password link and get a 500 error; no email arrives.
Root cause: Expired SES identity / misconfigured reset token TTL.
Resolution: Re-verify the SES sender identity and set the reset-token TTL to 15 minutes.
Team: auth-team

## Article: Login fails after account migration
Symptom: Existing users cannot log in after a data migration.
Root cause: Cognito user pool mismatch between environments.
Resolution: Re-point the app client to the correct user pool and re-issue tokens.
Team: auth-team

## Article: Billing invoice not generated
Symptom: Monthly invoice is missing for some customers.
Root cause: Scheduled billing job skipped due to a timezone off-by-one.
Resolution: Normalize job scheduling to UTC and re-run the billing batch.
Team: billing-team
