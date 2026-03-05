/**
 * Cognito Auth — SRP-free, uses USER_PASSWORD_AUTH via InitiateAuth / SignUp / ConfirmSignUp
 * Calls Cognito directly via fetch (no SDK needed).
 */
const Auth = (() => {
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
    localStorage.setItem('idToken', tokens.IdToken);
    localStorage.setItem('accessToken', tokens.AccessToken);
    localStorage.setItem('refreshToken', tokens.RefreshToken);
    localStorage.setItem('userEmail', email);
    return tokens;
  }

  function signOut() {
    localStorage.removeItem('idToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userEmail');
  }

  function getIdToken() { return localStorage.getItem('idToken'); }
  function getEmail() { return localStorage.getItem('userEmail'); }
  function isAuthenticated() { return !!getIdToken(); }

  // Refresh tokens using the stored refresh token
  async function refreshSession() {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    const data = await cognitoCall('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CONFIG.COGNITO.CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    const tokens = data.AuthenticationResult;
    localStorage.setItem('idToken', tokens.IdToken);
    localStorage.setItem('accessToken', tokens.AccessToken);
    // RefreshToken is NOT returned on refresh — keep the existing one
    return tokens;
  }

  // Get a valid ID token, auto-refreshing if expired
  async function getValidIdToken() {
    const token = localStorage.getItem('idToken');
    if (!token) return null;
    try {
      // Decode JWT to check expiry (payload is second segment)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp - now < 60) {
        // Token expires within 60 seconds — refresh it
        const tokens = await refreshSession();
        return tokens.IdToken;
      }
    } catch (e) {
      // If decode fails, try refreshing anyway
      try {
        const tokens = await refreshSession();
        return tokens.IdToken;
      } catch { return token; }
    }
    return token;
  }

  return { signUp, confirmSignUp, signIn, signOut, getIdToken, getValidIdToken, getEmail, isAuthenticated };
})();
