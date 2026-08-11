/**
 * File: http-helper.ts
 * Description: Fetch wrapper that refreshes the Keycloak token and surfaces API errors.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { keycloak } from '@/utils/keycloak';
import { logger } from '@/utils/logger';
import { API_BASE_URL } from '@/utils/utils';

const API_URL: string = `${API_BASE_URL}/`;
logger.debug('API URL:', API_URL);

/**
 * Turns a failed response into an error worth showing.
 *
 * The API explains itself — "already assigned this item", "module 2.3 already
 * exists" — in an `errorMessage` field. Throwing on the status code alone threw
 * that away, so a refusal the user could have acted on arrived as
 * "Response status: 400" and looked like a server fault. The status is kept as
 * the fallback for responses that carry no body.
 */
async function toError(response: Response, method: string, endpoint: string): Promise<Error> {
  const detail = await response
    .clone()
    .json()
    .then((body) => body?.errorMessage as string | undefined)
    .catch(() => undefined);

  return new Error(
    detail ??
      `Network error for ${method} request to ${API_URL}${endpoint}. Response status: ${response.status}`,
  );
}

class HttpHelper {
  public static async checkToken(): Promise<string> {
    if (!keycloak.authenticated) {
      await keycloak.login();
    }
    try {
      await keycloak.updateToken(30);
    } catch (error) {
      logger.error('Failed to refresh token', error);
      keycloak.login();
      throw new Error('Session expired, please login again');
    }
    return keycloak.token!;
  }

  public static async get(endpoint: string) {
    try {
      const jwtToken = await this.checkToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
      });
      if (!response.ok) {
        throw await toError(response, 'GET', endpoint);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      logger.error(`Error making GET request to ${API_URL}${endpoint}`, error);
      throw error;
    }
  }

  public static async getPublic(endpoint: string) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'GET',
        // No Authorization header for public endpoints
      });
      if (!response.ok) {
        throw await toError(response, 'GET', endpoint);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      logger.error(`Error making GET request to ${API_URL}${endpoint}`, error);
      throw error;
    }
  }

  public static async post(endpoint: string, data: unknown) {
    try {
      const jwtToken = await this.checkToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw await toError(response, 'POST', endpoint);
      }
      const responseData = await response.json();
      return responseData;
    } catch (error) {
      logger.error(`Error making POST request to ${API_URL}${endpoint}`, error);
      throw error;
    }
  }

  public static async postPublic(endpoint: string, data: unknown) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw await toError(response, 'POST', endpoint);
      }

      return await response.json();
    } catch (error) {
      logger.error(`Error making public POST request to ${API_URL}${endpoint}`, error);
      throw error;
    }
  }

  public static async postFormData(endpoint: string, formData: FormData) {
    try {
      const jwtToken = await this.checkToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw await toError(response, 'POST', endpoint);
      }
      const responseData = await response.json();
      return responseData;
    } catch (error) {
      logger.error(`Error making POST request to ${API_URL}${endpoint}`, error);
      throw error;
    }
  }

  public static async put(endpoint: string, data: unknown) {
    try {
      const jwtToken = await this.checkToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw await toError(response, 'PUT', endpoint);
      }
      return await response.json();
    } catch (error) {
      logger.error(`Error making PUT request to ${API_URL}${endpoint}`);
      throw error;
    }
  }

  public static async putFormDate(
    endpoint: string,
    data: FormData,
    options?: { headers?: Record<string, string> },
  ) {
    try {
      const jwtToken = await this.checkToken();
      const fetchOptions: RequestInit = {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${jwtToken}`,
        },
        body: null,
      };

      if (data instanceof FormData) {
        fetchOptions.body = data;
      } else {
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = data; // Removed JSON.stringify(data);
      }

      if (options && options.headers) {
        fetchOptions.headers = { ...fetchOptions.headers, ...options.headers };
      }

      const response = await fetch(`${API_URL}${endpoint}`, fetchOptions);

      if (!response.ok) {
        throw await toError(response, 'PUT', endpoint);
      }
      return await response.json();
    } catch (error) {
      logger.error(`Error making PUT request to ${API_URL}${endpoint}`);
      throw error;
    }
  }

  public static async delete(endpoint: string) {
    try {
      const jwtToken = await this.checkToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtToken}`,
        },
      });

      if (!response.ok) {
        throw await toError(response, 'DELETE', endpoint);
      }
      return await response.json();
    } catch (error) {
      logger.error(`Error making DELETE request to ${API_URL}${endpoint}`);
      throw error;
    }
  }
}

export default HttpHelper;
