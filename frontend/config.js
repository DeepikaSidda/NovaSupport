// NovaSupport Configuration — wired to deployed stack
const CONFIG = {
  API_URL: 'https://1htq8dkcn3.execute-api.us-east-1.amazonaws.com/dev',
  COGNITO: {
    REGION: 'us-east-1',
    USER_POOL_ID: 'us-east-1_Kl64pgBSV',
    CLIENT_ID: '13n0c7acq366joisvccgec5rk6',
  },
  CLOUDWATCH_DASHBOARD: 'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=NovaSupport-Metrics',
  WS_URL: '', // Set after cdk deploy — use WebSocketApiEndpoint output value
};
