import { writeConfig } from '../cli/config-store.js';
import { requireRenewalSetting, signInHint } from '../config.js';
import { request, extractSafeDetail } from '../client.js';
import { LoginError, NetworkError, TimeoutError } from '../errors.js';

export class TokenRefreshService {
  private refreshToken: string;
  private accessToken: string = '';
  private expiresAt: number = 0;

  /** `persist: false` proves a token works without saving it. */
  constructor(refreshToken: string, initialAccessToken?: string, private readonly opts: { persist?: boolean } = {}) {
    this.refreshToken = refreshToken;
    if (initialAccessToken) {
      this.accessToken = initialAccessToken;
      // Parse JWT to get expiration
      try {
        const payload = JSON.parse(
          Buffer.from(initialAccessToken.split('.')[1], 'base64').toString()
        );
        this.expiresAt = payload.exp * 1000; // Convert to milliseconds
      } catch (e) {
        // If parsing fails, token will be refreshed on first use
        this.expiresAt = 0;
      }
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   * Returns current token if still valid (with 5 min buffer), otherwise refreshes
   */
  async getValidToken(): Promise<string> {
    // Check if current token is still valid (with 5 min buffer)
    if (this.accessToken && Date.now() < this.expiresAt - 300000) {
      return this.accessToken;
    }

    // Refresh token
    return await this.refreshAccessToken();
  }

  /**
   * Force refresh the access token
   */
  private async refreshAccessToken(): Promise<string> {
    const apiKey = requireRenewalSetting();
    const base = process.env.GLUE_TOKEN_URL || 'https://securetoken.googleapis.com/v1/token';
    const tokenUrl = `${base}?key=${encodeURIComponent(apiKey)}`;
    const relogin = signInHint();

    let response: Response;
    try {
      response = await request(
        tokenUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken }).toString(),
        },
        { operation: 'Token refresh', retry: 'safe' },
      );
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof NetworkError) throw error;
      throw new LoginError('Could not refresh the sign-in.', relogin);
    }

    const body = await response.text();
    if (!response.ok) {
      throw new LoginError(`Could not refresh the sign-in: ${extractSafeDetail(body)}`, relogin);
    }

    const data = JSON.parse(body);
    this.accessToken = data.id_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    // Update refresh token if it changed
    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      this.refreshToken = data.refresh_token;
    }

    // Persist refreshed tokens
    if (this.opts.persist !== false) {
      writeConfig({ accessToken: data.id_token, refreshToken: this.refreshToken });
    }

    return this.accessToken;
  }

  /**
   * Check if the current token is expired
   */
  isTokenExpired(): boolean {
    return Date.now() >= this.expiresAt;
  }

  /**
   * Get time until token expires (in milliseconds)
   */
  getTimeUntilExpiration(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  /**
   * Get time until token expires (human readable)
   */
  getTimeUntilExpirationFormatted(): string {
    const ms = this.getTimeUntilExpiration();
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  }
}
