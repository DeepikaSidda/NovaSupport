/**
 * Agent Authentication — Cognito auth for the Team Member Portal.
 * Uses agent_ prefix for localStorage keys to avoid conflicts with admin/user portals.
 */
const AgentAuth = (() => {
  const endpoint = `https://cognito-idp.${CONFIG.COGNITO.REGION}.amazonaws.com/`;
  const headers = { 'Content-Type': 'application/x-amz-json-1.1' };

  async function cognitoCall(action, payload) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.__type || 'Auth error');
    return data;
  }

  async function signUp(email, password) {
    return cognitoCall('SignUp', {
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    });
  }

  async function confirmSignUp(email, code) {
    return cognitoCall('ConfirmSignUp', {
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    });
  }

  async function signIn(email, password) {
    const data = await cognitoCall('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    const tokens = data.AuthenticationResult;
    localStorage.setItem('agent_idToken', tokens.IdToken);
    localStorage.setItem('agent_accessToken', tokens.AccessToken);
    localStorage.setItem('agent_refreshToken', tokens.RefreshToken);
    localStorage.setItem('agent_userEmail', email);
    return tokens;
  }

  function signOut() {
    localStorage.removeItem('agent_idToken');
    localStorage.removeItem('agent_accessToken');
    localStorage.removeItem('agent_refreshToken');
    localStorage.removeItem('agent_userEmail');
  }

  function getIdToken() { return localStorage.getItem('agent_idToken'); }
  function getEmail() { return localStorage.getItem('agent_userEmail'); }
  function isAuthenticated() { return !!getIdToken(); }

  async function refreshSession() {
    const refreshToken = localStorage.getItem('agent_refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    const data = await cognitoCall('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    const tokens = data.AuthenticationResult;
    localStorage.setItem('agent_idToken', tokens.IdToken);
    localStorage.setItem('agent_accessToken', tokens.AccessToken);
    return tokens;
  }

  async function getValidIdToken() {
    const token = localStorage.getItem('agent_idToken');
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp - now < 60) {
        const tokens = await refreshSession();
        return tokens.IdToken;
      }
    } catch (e) {
      try {
        const tokens = await refreshSession();
        return tokens.IdToken;
      } catch { return token; }
    }
    return token;
  }

  async function forgotPassword(email) {
    return cognitoCall('ForgotPassword', {
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      Username: email,
    });
  }

  async function confirmForgotPassword(email, code, newPassword) {
    return cognitoCall('ConfirmForgotPassword', {
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });
  }

  return { signUp, confirmSignUp, signIn, signOut, getIdToken, getValidIdToken, getEmail, isAuthenticated, forgotPassword, confirmForgotPassword };
})();
