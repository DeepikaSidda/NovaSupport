#!/bin/bash
# Fix admin user pool - restore auto-verify + custom email template
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_Kl64pgBSV \
  --region us-east-1 \
  --auto-verified-attributes email \
  --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false,"TemporaryPasswordValidityDays":7}}' \
  --verification-message-template '{"DefaultEmailOption":"CONFIRM_WITH_CODE","EmailSubject":"Welcome to NovaSupport - Verify Your Email","EmailMessage":"Hi there!\n\nWelcome to NovaSupport - your AI-powered support platform. We are glad to have you on board.\n\nYour verification code is: {####}\n\nEnter this code in the app to verify your email and get started.\n\nThis code expires in 24 hours. If you did not create this account, you can safely ignore this email.\n\n- The NovaSupport Team"}'

echo "Admin pool updated: $?"

# Fix portal user pool
aws cognito-idp update-user-pool \
  --user-pool-id us-east-1_uBB4ai0k2 \
  --region us-east-1 \
  --auto-verified-attributes email \
  --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false,"TemporaryPasswordValidityDays":7}}' \
  --verification-message-template '{"DefaultEmailOption":"CONFIRM_WITH_CODE","EmailSubject":"Welcome to NovaSupport - Verify Your Email","EmailMessage":"Hi there!\n\nWelcome to NovaSupport - your AI-powered support platform. We are glad to have you on board.\n\nYour verification code is: {####}\n\nEnter this code in the app to verify your email and get started.\n\nThis code expires in 24 hours. If you did not create this account, you can safely ignore this email.\n\n- The NovaSupport Team"}'

echo "Portal pool updated: $?"
