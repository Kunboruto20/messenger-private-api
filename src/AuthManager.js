const axios = require('axios');
const { Endpoints } = require('./constants');

class AuthManager {
    constructor(client) {
        this.client = client;
        this.http = client.http;
    }

    async login(credentials) {
        try {
            const { email, password } = credentials;
            
            // Step 1: Get login page to extract form data
            const loginPageResponse = await this.http.get(Endpoints.LOGIN);
            const loginPageHtml = loginPageResponse.data;
            
            // Extract form data and tokens
            const formData = this.extractFormData(loginPageHtml);
            
            // Step 2: Submit login form
            const loginData = {
                ...formData,
                email: email,
                pass: password,
                login: 'Log In'
            };

            const loginResponse = await this.http.post(Endpoints.LOGIN, loginData, {
                maxRedirects: 0,
                validateStatus: (status) => status < 400
            });

            // Check if login was successful
            if (loginResponse.status === 302 || loginResponse.status === 200) {
                // Extract user ID and access token
                const userInfo = await this.extractUserInfo();
                
                if (userInfo) {
                    return {
                        success: true,
                        userId: userInfo.userId,
                        accessToken: userInfo.accessToken,
                        cookies: this.client.cookies
                    };
                }
            }

            // Check for specific error messages
            if (loginResponse.data && loginResponse.data.includes('checkpoint')) {
                throw new Error('Account checkpoint detected. Please verify your account manually.');
            }

            if (loginResponse.data && loginResponse.data.includes('incorrect')) {
                throw new Error('Invalid email or password.');
            }

            throw new Error('Login failed. Please check your credentials.');

        } catch (error) {
            if (error.response) {
                // Handle specific HTTP errors
                if (error.response.status === 401) {
                    throw new Error('Invalid credentials');
                } else if (error.response.status === 403) {
                    throw new Error('Account temporarily locked');
                }
            }
            throw error;
        }
    }

    extractFormData(html) {
        const formData = {};
        
        // Extract lsd token
        const lsdMatch = html.match(/name="lsd" value="([^"]+)"/);
        if (lsdMatch) {
            formData.lsd = lsdMatch[1];
        }

        // Extract jazoest token
        const jazoestMatch = html.match(/name="jazoest" value="([^"]+)"/);
        if (jazoestMatch) {
            formData.jazoest = jazoestMatch[1];
        }

        // Extract m_ts token
        const mtsMatch = html.match(/name="m_ts" value="([^"]+)"/);
        if (mtsMatch) {
            formData.m_ts = mtsMatch[1];
        }

        // Extract li token
        const liMatch = html.match(/name="li" value="([^"]+)"/);
        if (liMatch) {
            formData.li = liMatch[1];
        }

        // Extract try_number
        const tryNumberMatch = html.match(/name="try_number" value="([^"]+)"/);
        if (tryNumberMatch) {
            formData.try_number = tryNumberMatch[1];
        }

        // Extract unrecognized_tries
        const unrecognizedTriesMatch = html.match(/name="unrecognized_tries" value="([^"]+)"/);
        if (unrecognizedTriesMatch) {
            formData.unrecognized_tries = unrecognizedTriesMatch[1];
        }

        return formData;
    }

    async extractUserInfo() {
        try {
            // Get user info from GraphQL
            const graphqlQuery = {
                query: `
                    query UserInfo {
                        viewer {
                            id
                            name
                            profile_picture {
                                uri
                            }
                        }
                    }
                `
            };

            const response = await this.http.post(Endpoints.GRAPHQL, graphqlQuery, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-FB-Friendly-Name': 'UserInfo'
                }
            });

            if (response.data && response.data.data && response.data.data.viewer) {
                const viewer = response.data.data.viewer;
                return {
                    userId: viewer.id,
                    name: viewer.name,
                    profilePicture: viewer.profile_picture?.uri
                };
            }

            // Fallback: try to extract from page source
            const homeResponse = await this.http.get('https://www.facebook.com/');
            const homeHtml = homeResponse.data;
            
            // Extract user ID from page
            const userIdMatch = homeHtml.match(/"userID":"([^"]+)"/);
            if (userIdMatch) {
                return {
                    userId: userIdMatch[1]
                };
            }

            return null;

        } catch (error) {
            console.error('Error extracting user info:', error.message);
            return null;
        }
    }

    async logout() {
        try {
            await this.http.get('https://www.facebook.com/logout.php');
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async checkAuthStatus() {
        try {
            const response = await this.http.get('https://www.facebook.com/');
            return !response.data.includes('login');
        } catch (error) {
            return false;
        }
    }

    async refreshSession() {
        try {
            // Attempt to refresh the session by visiting key pages
            await this.http.get('https://www.facebook.com/');
            await this.http.get('https://www.facebook.com/messaging/');
            
            return { success: true };
        } catch (error) {
            console.error('Session refresh error:', error.message);
            return { success: false, error: error.message };
        }
    }
}

module.exports = AuthManager;