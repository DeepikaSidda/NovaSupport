// NovaSupport User Portal Configuration — reuses deployed stack settings
const CONFIG = {
  API_URL: 'https://1htq8dkcn3.execute-api.us-east-1.amazonaws.com/dev',
  COGNITO: {
    REGION: 'us-east-1',
    USER_POOL_ID: 'us-east-1_uBB4ai0k2',
    CLIENT_ID: '7dcvujnamkbknk13pqpbq0rifk',
  },
  WS_URL: '', // Set after cdk deploy — use WebSocketApiEndpoint output value
};
