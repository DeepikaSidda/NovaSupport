// Portal Authentication Module — Cognito auth for the user-facing portal
// Uses portal_ prefix for localStorage keys to avoid conflicts with admin dashboard
const PortalAuth = (() => {
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
    localStorage.setItem('portal_idToken', tokens.IdToken);
    localStorage.setItem('portal_accessToken', tokens.AccessToken);
    localStorage.setItem('portal_refreshToken', tokens.RefreshToken);
    localStorage.setItem('portal_userEmail', email);
    return tokens;
  }

  function signOut() {
    localStorage.removeItem('portal_idToken');
    localStorage.removeItem('portal_accessToken');
    localStorage.removeItem('portal_refreshToken');
    localStorage.removeItem('portal_userEmail');
  }

  function getIdToken() { return localStorage.getItem('portal_idToken'); }
  function getEmail() {
    const stored = localStorage.getItem('portal_userEmail');
    if (stored) return stored;
    // Fallback: extract email from JWT token
    try {
      const token = localStorage.getItem('portal_idToken');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const email = payload.email || payload['cognito:username'] || null;
        if (email) localStorage.setItem('portal_userEmail', email);
        return email;
      }
    } catch (e) { /* ignore parse errors */ }
    return null;
  }
  function isAuthenticated() { return !!getIdToken(); }

  // Refresh tokens using the stored refresh token
  async function refreshSession() {
    const refreshToken = localStorage.getItem('portal_refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    const data = await cognitoCall('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    const tokens = data.AuthenticationResult;
    localStorage.setItem('portal_idToken', tokens.IdToken);
    localStorage.setItem('portal_accessToken', tokens.AccessToken);
    return tokens;
  }

  // Get a valid ID token, auto-refreshing if expired
  async function getValidIdToken() {
    const token = localStorage.getItem('portal_idToken');
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

  return { signIn, signUp, confirmSignUp, signOut, getIdToken, getValidIdToken, getEmail, isAuthenticated };
})();
