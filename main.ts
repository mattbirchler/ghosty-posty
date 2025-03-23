import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';

interface GhostyPostySettings {
    ghostUrl: string;
    apiKey: string;
}

const DEFAULT_SETTINGS: GhostyPostySettings = {
    ghostUrl: '',
    apiKey: ''
}

export default class GhostyPostyPlugin extends Plugin {
    settings: GhostyPostySettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new GhostyPostySettingTab(this.app, this));

        // Add a command to publish the current note as a draft
        this.addCommand({
            id: 'publish-note-as-draft',
            name: 'Publish current note as a draft',
            checkCallback: (checking: boolean) => {
                // Check if we're in a markdown file
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!activeView) {
                    return false;
                }
                
                // If we're checking, just return true if settings are configured
                if (checking) {
                    return !!this.settings.ghostUrl && !!this.settings.apiKey;
                }
                
                // Execute the command - publish the current note
                this.publishCurrentNote(activeView);
                return true;
            }
        });

        console.log('Loaded Ghosty Posty plugin');
    }
    
    async publishCurrentNote(view: MarkdownView) {
        try {
            // Get the current note content and metadata
            const editor = view.editor;
            const content = editor.getValue();
            const fileName = view.file?.basename || 'Untitled Note';
            
            // Create a placeholder notice while we publish
            const statusNotice = new Notice('Publishing to Ghost as draft...', 0);
            
            // Call the publish function
            const result = await this.publishToGhost(fileName, content);
            
            // Remove the placeholder notice
            statusNotice.hide();
            
            // Show success or error message
            if (result.success) {
                new Notice(`Successfully published "${fileName}" as a draft`);
            } else {
                new Notice(`Failed to publish: ${result.error}`);
            }
        } catch (error) {
            console.error('Error publishing note:', error);
            new Notice(`Error publishing note: ${error}`);
        }
    }
    
    // Helper function to generate a proper Ghost Admin API token
    generateGhostAdminToken(id: string, secret: string): string {
        try {
            // @ts-ignore - We need to use the crypto library
            const crypto = window.require ? window.require('crypto') : null;
            
            if (!crypto) {
                console.error('Crypto library not available');
                // Fall back to the basic token format when crypto isn't available
                return `Ghost ${id}:${secret}`;
            }
            
            // Create a JWT token as per Ghost API docs
            // Reference: https://ghost.org/docs/admin-api/#authentication
            
            const now = Math.floor(Date.now() / 1000);
            const fiveMinutesFromNow = now + 5 * 60;
            
            // Create JWT header (algorithm & token type)
            const header = {
                alg: 'HS256',
                typ: 'JWT',
                kid: id // Key ID
            };
            
            // Create JWT payload with claims
            const payload = {
                iat: now,                  // Issued at time
                exp: fiveMinutesFromNow,   // Expiration time
                aud: '/v5/admin/'          // Audience
            };
            
            // Base64 encode the header and payload
            const encodeBase64 = (obj: any) => {
                const str = JSON.stringify(obj);
                return crypto.createHash('sha256')
                    .update(str)
                    .digest('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/g, '');
            };
            
            const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
            
            const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
            
            // Create the signature
            const signatureInput = `${headerBase64}.${payloadBase64}`;
            const signature = crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
                .update(signatureInput)
                .digest('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/g, '');
            
            // Create the complete JWT token
            const token = `${headerBase64}.${payloadBase64}.${signature}`;
            console.log('Generated JWT token (masked): JWT...');
            
            return `Ghost ${token}`;
        } catch (error) {
            console.error('Error generating token:', error);
            // Fall back to simple format in case of error
            return `Ghost ${id}:${secret}`;
        }
    }
    
    async publishToGhost(title: string, markdownContent: string): Promise<{ success: boolean, error?: string, postUrl?: string }> {
        try {
            const { ghostUrl, apiKey } = this.settings;
            
            if (!ghostUrl || !apiKey) {
                return { 
                    success: false, 
                    error: 'Ghost URL and API Key are required' 
                };
            }
            
            // Clean up the URL
            const baseUrl = ghostUrl.trim().replace(/\/$/, '');
            
            // Extract API credentials
            const [id, secret] = apiKey.split(':');
            if (!id || !secret) {
                return { 
                    success: false, 
                    error: 'Invalid API key format' 
                };
            }
            
            // Log API key format for debugging (masking the secret)
            console.log('API Key ID:', id);
            console.log('API Key Secret (first 6 chars):', secret.substring(0, 6) + '...');
            
            // Construct the API URL for creating posts
            const apiUrl = `${baseUrl}/ghost/api/admin/posts/`;
            console.log('Publishing to:', apiUrl);
            
            // Clean up the markdown content
            const cleanMarkdown = markdownContent.trim();
            console.log('Markdown length:', cleanMarkdown.length);
            
            // Prepare the post data
            const postData = {
                posts: [{
                    title: title,
                    markdown: markdownContent,
                    // Add mobiledoc format for Ghost v4+
                    mobiledoc: JSON.stringify({
                        version: "0.3.1",
                        markups: [],
                        atoms: [],
                        cards: [
                            ["markdown", {
                                markdown: markdownContent
                            }]
                        ],
                        sections: [[10, 0]]
                    }),
                    status: 'draft' // Publish as draft
                }]
            };
            
            console.log('Post data sample:', JSON.stringify({
                posts: [{
                    title: title,
                    markdown: cleanMarkdown.substring(0, 100) + '...',
                    status: 'draft'
                }]
            }));
            
            // Try to publish the post using Obsidian's requestUrl
            try {
                // Generate proper JWT token for Ghost Admin API
                const authToken = this.generateGhostAdminToken(id, secret);
                console.log('Using JWT token format for authentication');
                
                const response = await requestUrl({
                    url: apiUrl,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authToken
                    },
                    body: JSON.stringify(postData),
                    throw: false
                });
                
                console.log('Publish response status:', response.status);
                console.log('Response headers:', response.headers);
                
                if (response.status >= 200 && response.status < 300) {
                    const jsonData = response.json;
                    console.log('Publish successful:', jsonData);
                    
                    // Extract the post URL if available
                    let postUrl = '';
                    try {
                        postUrl = jsonData?.posts?.[0]?.url || '';
                    } catch (e) {
                        console.log('Could not extract post URL from response');
                    }
                    
                    return { 
                        success: true,
                        postUrl: postUrl
                    };
                } else {
                    const errorResponse = response.text;
                    console.error('API Error when publishing:', response.status);
                    console.error('Error response body:', errorResponse);
                    
                    // Try alternate method if we got a token error
                    if (errorResponse.includes('INVALID_JWT') || errorResponse.includes('Invalid token')) {
                        console.log('Token error detected, trying Node.js method with proper JWT...');
                        return await this.publishWithNode(apiUrl, id, secret, postData);
                    }
                    
                    return { 
                        success: false, 
                        error: `API Error (${response.status}): ${errorResponse}` 
                    };
                }
            } catch (error) {
                console.error('Obsidian request failed when publishing, trying Node.js:', error);
                
                // Try with Node.js as fallback
                return await this.publishWithNode(apiUrl, id, secret, postData);
            }
        } catch (error) {
            console.error('Publish error:', error);
            return { 
                success: false, 
                error: `Error during publishing: ${error}` 
            };
        }
    }
    
    async publishWithNode(url: string, id: string, secret: string, postData: any): Promise<{ success: boolean, error?: string, postUrl?: string }> {
        return new Promise((resolve) => {
            try {
                // Try to access Node.js modules in Electron context
                // @ts-ignore - Accessing global window object
                const nodeRequire = window.require;
                
                if (!nodeRequire) {
                    console.log('Node require not available for publishing');
                    return resolve({ 
                        success: false, 
                        error: 'Could not access Node.js modules for publishing' 
                    });
                }
                
                const https = nodeRequire('https');
                const crypto = nodeRequire('crypto');
                const urlObj = new URL(url);
                
                console.log('Publishing via Node.js to bypass CORS');
                
                const postContent = JSON.stringify(postData);
                
                // Generate proper JWT token using Node.js crypto
                const now = Math.floor(Date.now() / 1000);
                const fiveMinutesFromNow = now + 5 * 60;
                
                // Create JWT header and payload
                const header = {
                    alg: 'HS256',
                    typ: 'JWT',
                    kid: id // Key ID
                };
                
                const payload = {
                    iat: now,                  // Issued at time
                    exp: fiveMinutesFromNow,   // Expiration time
                    aud: '/v5/admin/'          // Audience
                };
                
                // Base64 encode the header and payload
                const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/g, '');
                
                const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/g, '');
                
                // Create the signature
                const signatureInput = `${headerBase64}.${payloadBase64}`;
                const signature = crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
                    .update(signatureInput)
                    .digest('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/g, '');
                
                // Create the complete JWT token
                const token = `${headerBase64}.${payloadBase64}.${signature}`;
                console.log('Generated Node.js JWT token (masked): JWT...');
                
                // Auth header with JWT token
                const authToken = `Ghost ${token}`;
                
                const options = {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': postContent.length,
                        'Authorization': authToken
                    }
                };
                
                console.log('Request options:', {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': postContent.length,
                        'Authorization': 'Ghost JWT... (masked)'
                    }
                });
                
                const req = https.request(options, (res: any) => {
                    let data = '';
                    
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        console.log(`Node.js publish response status: ${res.statusCode}`);
                        console.log('Response headers:', res.headers);
                        
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const jsonData = JSON.parse(data);
                                console.log('Node.js publish successful:', jsonData);
                                
                                // Extract the post URL if available
                                let postUrl = '';
                                try {
                                    postUrl = jsonData?.posts?.[0]?.url || '';
                                } catch (e) {
                                    console.log('Could not extract post URL from response');
                                }
                                
                                resolve({ 
                                    success: true,
                                    postUrl: postUrl
                                });
                            } catch (e) {
                                console.error('Error parsing JSON from publish response:', e);
                                resolve({ 
                                    success: true, // Still consider it a success if status code is good
                                    error: `Could not parse response data: ${e}` 
                                });
                            }
                        } else {
                            console.error('API Error from Node.js publish:', res.statusCode);
                            console.error('Error response body:', data);
                            resolve({ 
                                success: false, 
                                error: `API Error (${res.statusCode}): ${data}` 
                            });
                        }
                    });
                });
                
                req.on('error', (error: Error) => {
                    console.error('Node.js publish error:', error);
                    resolve({ 
                        success: false, 
                        error: `Network error during publishing: ${error.message}` 
                    });
                });
                
                // Write post data and end request
                req.write(postContent);
                req.end();
                
            } catch (error) {
                console.error('Error in Node.js publishing:', error);
                resolve({ 
                    success: false, 
                    error: `Error during publishing: ${error}` 
                });
            }
        });
    }

    onunload() {
        console.log('Unloaded Ghosty Posty plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class GhostyPostySettingTab extends PluginSettingTab {
    plugin: GhostyPostyPlugin;

    constructor(app: App, plugin: GhostyPostyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Ghosty Posty Settings' });

        new Setting(containerEl)
            .setName('Ghost Blog URL')
            .setDesc('URL of your Ghost blog (e.g., https://yourblog.ghost.io)')
            .addText(text => text
                .setPlaceholder('https://yourblog.ghost.io')
                .setValue(this.plugin.settings.ghostUrl)
                .onChange(async (value) => {
                    this.plugin.settings.ghostUrl = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Admin API Key')
            .setDesc('Your Ghost Admin API key')
            .addText(text => text
                .setPlaceholder('00000000000000000000:00000000000000000000000000000000000000000000')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Test Connection')
            .setDesc('Verify your Ghost credentials')
            .addButton(button => button
                .setButtonText('Test Connection')
                .setCta()
                .onClick(async () => {
                    button.setDisabled(true);
                    button.setButtonText('Testing...');
                    
                    try {
                        const result = await this.testGhostConnection();
                        if (result.success) {
                            new Notice('Connection successful!');
                        } else {
                            new Notice(`Connection failed: ${result.error}`);
                        }
                    } finally {
                        button.setDisabled(false);
                        button.setButtonText('Test Connection');
                    }
                }));
    }

    async testGhostConnection(): Promise<{ success: boolean, error?: string }> {
        try {
            console.log('Testing connection to Ghost API...');
            
            const { ghostUrl, apiKey } = this.plugin.settings;
            
            if (!ghostUrl || !apiKey) {
                return { 
                    success: false, 
                    error: 'Please enter both Ghost URL and API Key' 
                };
            }
            
            // Clean up the URL
            const baseUrl = ghostUrl.trim().replace(/\/$/, '');
            console.log(`Using base URL: ${baseUrl}`);
            
            // Make sure URL has correct format
            try {
                new URL(baseUrl);
            } catch (e) {
                console.error('Invalid URL format:', e);
                return { 
                    success: false, 
                    error: 'Invalid URL format' 
                };
            }
            
            // Extract API credentials
            const [id, secret] = apiKey.split(':');
            if (!id || !secret) {
                console.error('Invalid API key format');
                return { 
                    success: false, 
                    error: 'Invalid API key format. Should be ID:SECRET' 
                };
            }
            
            // Construct the API URLs for the v5 Ghost API
            // Try multiple well-known endpoints until one works
            const possibleEndpoints = [
                // Posts endpoint is very likely to exist and should work for testing auth
                `/ghost/api/admin/posts/`,
                // Settings endpoint also commonly works
                `/ghost/api/admin/settings/`,
                // Users endpoint for current user
                `/ghost/api/admin/users/me/`,
                // Site endpoint (previously tried)
                `/ghost/api/admin/site/`
            ];
            
            for (const endpoint of possibleEndpoints) {
                try {
                    const testUrl = `${baseUrl}${endpoint}`;
                    console.log(`Testing endpoint: ${testUrl}`);
                    
                    const response = await requestUrl({
                        url: testUrl,
                        method: 'GET',
                        headers: {
                            'Authorization': `Ghost ${id}:${secret}`
                        },
                        throw: false
                    });
                    
                    if (response.status >= 200 && response.status < 300) {
                        console.log('Connection successful!');
                        return { success: true };
                    }
                } catch (e) {
                    console.log(`Endpoint ${endpoint} failed:`, e);
                }
            }
            
            return { 
                success: false, 
                error: 'Connection failed. Please check your Ghost URL and API Key' 
            };
        } catch (error) {
            console.error('Error testing connection:', error);
            return { 
                success: false, 
                error: `Error during connection test: ${error}` 
            };
        }
    }
}