/**
 * Authentication and authorization utilities for NovaSupport
 * Implements task 23.2: JWT validation and role-based access control
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

/** User roles in the system */
export type UserRole = 'user' | 'support_agent' | 'admin';

/** Decoded token claims after JWT verification */
export interface AuthClaims {
  sub: string;
  email?: string;
  'cognito:username': string;
  'cognito:groups'?: string[];
  'custom:role'?: UserRole;
  token_use: 'access' | 'id';
  iss: string;
  exp: number;
}

/** Result of authentication attempt */
export interface AuthResult {
  authenticated: boolean;
  claims?: AuthClaims;
  error?: string;
}

/** Role hierarchy: higher index = more privileges */
const ROLE_HIERARCHY: UserRole[] = ['user', 'support_agent', 'admin'];

/**
 * Extract the Bearer token from the Authorization header
 */
export function extractBearerToken(event: APIGatewayProxyEvent): string | null {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}

/**
 * Determine the user's role from JWT claims.
 * Checks custom:role attribute first, then Cognito groups.
 */
export function getUserRole(claims: AuthClaims): UserRole {
  // Check custom:role attribute
  if (claims['custom:role'] && ROLE_HIERARCHY.includes(claims['custom:role'])) {
    return claims['custom:role'];
  }

  // Check Cognito groups — pick the highest-privilege group
  const groups = claims['cognito:groups'] || [];
  let highestRole: UserRole = 'user';
  for (const group of groups) {
    const role = group as UserRole;
    if (ROLE_HIERARCHY.includes(role) && ROLE_HIERARCHY.indexOf(role) > ROLE_HIERARCHY.indexOf(highestRole)) {
      highestRole = role;
    }
  }
  return highestRole;
}

/**
 * Check if a role has at least the required privilege level
 */
export function hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole);
}

/**
 * Create a Cognito JWT verifier instance.
 * Reads config from environment variables.
 */
export function createVerifier() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;

  if (!userPoolId || !clientId) {
    throw new Error('COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID environment variables are required');
  }

  return CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  });
}

/**
 * Verify a JWT token and return the decoded claims
 */
export async function verifyToken(token: string): Promise<AuthResult> {
  try {
    const verifier = createVerifier();
    const payload = await verifier.verify(token);
    return {
      authenticated: true,
      claims: payload as unknown as AuthClaims,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token verification failed';
    return { authenticated: false, error: message };
  }
}

/**
 * Authenticate an API Gateway event by extracting and verifying the JWT token
 */
export async function authenticateRequest(event: APIGatewayProxyEvent): Promise<AuthResult> {
  const token = extractBearerToken(event);
  if (!token) {
    return { authenticated: false, error: 'Missing or invalid Authorization header' };
  }
  return verifyToken(token);
}

/**
 * Build a standard 401 Unauthorized response
 */
export function unauthorizedResponse(message = 'Unauthorized'): APIGatewayProxyResult {
  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: {
        code: 'UNAUTHORIZED',
        message,
        retryable: false,
      },
    }),
  };
}

/**
 * Build a standard 403 Forbidden response
 */
export function forbiddenResponse(message = 'Forbidden: insufficient permissions'): APIGatewayProxyResult {
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: {
        code: 'FORBIDDEN',
        message,
        retryable: false,
      },
    }),
  };
}

/**
 * Middleware-style function that authenticates and authorizes a request.
 * Returns null if authorized, or an error response if not.
 */
export async function requireAuth(
  event: APIGatewayProxyEvent,
  requiredRole?: UserRole,
): Promise<{ response?: APIGatewayProxyResult; claims?: AuthClaims }> {
  const authResult = await authenticateRequest(event);

  if (!authResult.authenticated || !authResult.claims) {
    return { response: unauthorizedResponse(authResult.error) };
  }

  if (requiredRole) {
    const userRole = getUserRole(authResult.claims);
    if (!hasRole(userRole, requiredRole)) {
      return { response: forbiddenResponse(`Role '${requiredRole}' or higher is required`) };
    }
  }

  return { claims: authResult.claims };
}
