/**
 * Unit tests for authentication and authorization utilities
 * Implements task 23.2: JWT validation and role-based access control
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  extractBearerToken,
  getUserRole,
  hasRole,
  requireAuth,
  unauthorizedResponse,
  forbiddenResponse,
  AuthClaims,
  UserRole,
} from '../src/utils/auth';

// Mock aws-jwt-verify
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: jest.fn(() => ({
      verify: jest.fn(),
    })),
  },
}));

import { CognitoJwtVerifier } from 'aws-jwt-verify';

const mockVerify = jest.fn();
(CognitoJwtVerifier.create as jest.Mock).mockReturnValue({ verify: mockVerify });

describe('Auth Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
    // Re-mock after clearing
    (CognitoJwtVerifier.create as jest.Mock).mockReturnValue({ verify: mockVerify });
  });

  afterEach(() => {
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });

  const createMockEvent = (authHeader?: string): APIGatewayProxyEvent => ({
    body: null,
    headers: authHeader ? { Authorization: authHeader } : {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/test',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  });

  const baseClaims: AuthClaims = {
    sub: 'user-123',
    email: 'test@example.com',
    'cognito:username': 'testuser',
    'cognito:groups': [],
    token_use: 'access',
    iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_testpool',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  describe('extractBearerToken', () => {
    test('should extract token from valid Bearer header', () => {
      const event = createMockEvent('Bearer abc123token');
      expect(extractBearerToken(event)).toBe('abc123token');
    });

    test('should return null when no Authorization header', () => {
      const event = createMockEvent();
      expect(extractBearerToken(event)).toBeNull();
    });

    test('should return null for non-Bearer scheme', () => {
      const event = createMockEvent('Basic abc123');
      expect(extractBearerToken(event)).toBeNull();
    });

    test('should return null for malformed header (no space)', () => {
      const event = createMockEvent('Bearerabc123');
      expect(extractBearerToken(event)).toBeNull();
    });

    test('should handle lowercase authorization header', () => {
      const event = createMockEvent();
      event.headers = { authorization: 'Bearer lowercase-token' };
      expect(extractBearerToken(event)).toBe('lowercase-token');
    });
  });

  describe('getUserRole', () => {
    test('should return custom:role when set', () => {
      const claims: AuthClaims = { ...baseClaims, 'custom:role': 'admin' };
      expect(getUserRole(claims)).toBe('admin');
    });

    test('should return highest group role when no custom:role', () => {
      const claims: AuthClaims = {
        ...baseClaims,
        'cognito:groups': ['user', 'support_agent'],
      };
      expect(getUserRole(claims)).toBe('support_agent');
    });

    test('should return admin from groups when admin group present', () => {
      const claims: AuthClaims = {
        ...baseClaims,
        'cognito:groups': ['user', 'admin'],
      };
      expect(getUserRole(claims)).toBe('admin');
    });

    test('should default to user when no role info', () => {
      const claims: AuthClaims = { ...baseClaims };
      expect(getUserRole(claims)).toBe('user');
    });

    test('should ignore unknown groups', () => {
      const claims: AuthClaims = {
        ...baseClaims,
        'cognito:groups': ['unknown_group', 'another_group'],
      };
      expect(getUserRole(claims)).toBe('user');
    });
  });

  describe('hasRole', () => {
    test('admin has admin role', () => {
      expect(hasRole('admin', 'admin')).toBe(true);
    });

    test('admin has support_agent role', () => {
      expect(hasRole('admin', 'support_agent')).toBe(true);
    });

    test('admin has user role', () => {
      expect(hasRole('admin', 'user')).toBe(true);
    });

    test('support_agent has support_agent role', () => {
      expect(hasRole('support_agent', 'support_agent')).toBe(true);
    });

    test('support_agent has user role', () => {
      expect(hasRole('support_agent', 'user')).toBe(true);
    });

    test('support_agent does NOT have admin role', () => {
      expect(hasRole('support_agent', 'admin')).toBe(false);
    });

    test('user does NOT have admin role', () => {
      expect(hasRole('user', 'admin')).toBe(false);
    });

    test('user does NOT have support_agent role', () => {
      expect(hasRole('user', 'support_agent')).toBe(false);
    });

    test('user has user role', () => {
      expect(hasRole('user', 'user')).toBe(true);
    });
  });

  describe('requireAuth', () => {
    test('should return 401 when no Authorization header', async () => {
      const event = createMockEvent();
      const result = await requireAuth(event);

      expect(result.response).toBeDefined();
      expect(result.response!.statusCode).toBe(401);
      expect(result.claims).toBeUndefined();
    });

    test('should return claims on valid token', async () => {
      const claims: AuthClaims = { ...baseClaims, 'custom:role': 'user' };
      mockVerify.mockResolvedValue(claims);

      const event = createMockEvent('Bearer valid-token');
      const result = await requireAuth(event);

      expect(result.response).toBeUndefined();
      expect(result.claims).toBeDefined();
      expect(result.claims!.sub).toBe('user-123');
    });

    test('should return 401 on invalid token', async () => {
      mockVerify.mockRejectedValue(new Error('Token expired'));

      const event = createMockEvent('Bearer expired-token');
      const result = await requireAuth(event);

      expect(result.response).toBeDefined();
      expect(result.response!.statusCode).toBe(401);
    });

    test('should return 403 when user lacks required role', async () => {
      const claims: AuthClaims = { ...baseClaims, 'custom:role': 'user' };
      mockVerify.mockResolvedValue(claims);

      const event = createMockEvent('Bearer valid-token');
      const result = await requireAuth(event, 'admin');

      expect(result.response).toBeDefined();
      expect(result.response!.statusCode).toBe(403);
      const body = JSON.parse(result.response!.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    test('should allow admin to access admin-protected endpoint', async () => {
      const claims: AuthClaims = { ...baseClaims, 'custom:role': 'admin' };
      mockVerify.mockResolvedValue(claims);

      const event = createMockEvent('Bearer admin-token');
      const result = await requireAuth(event, 'admin');

      expect(result.response).toBeUndefined();
      expect(result.claims).toBeDefined();
    });

    test('should allow support_agent to access user-level endpoint', async () => {
      const claims: AuthClaims = { ...baseClaims, 'custom:role': 'support_agent' };
      mockVerify.mockResolvedValue(claims);

      const event = createMockEvent('Bearer agent-token');
      const result = await requireAuth(event, 'user');

      expect(result.response).toBeUndefined();
      expect(result.claims).toBeDefined();
    });
  });

  describe('unauthorizedResponse', () => {
    test('should return 401 with default message', () => {
      const response = unauthorizedResponse();
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Unauthorized');
    });

    test('should return 401 with custom message', () => {
      const response = unauthorizedResponse('Token expired');
      const body = JSON.parse(response.body);
      expect(body.error.message).toBe('Token expired');
    });
  });

  describe('forbiddenResponse', () => {
    test('should return 403 with default message', () => {
      const response = forbiddenResponse();
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    test('should return 403 with custom message', () => {
      const response = forbiddenResponse('Admin access required');
      const body = JSON.parse(response.body);
      expect(body.error.message).toBe('Admin access required');
    });
  });
});
