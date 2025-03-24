import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, requestUrl, TFile } from 'obsidian';
import { PublishPreviewModal, PublishOptions } from './src/PublishPreviewModal';

interface GhostyPostySettings {
    ghostUrl: string;
    apiKey: string;
    imagesDirectory: string;
    openEditorAfterPublish: boolean;
}

interface FrontMatterData {
    tags?: string[];
    status?: 'draft' | 'published';
    time?: string;
    title?: string;
}

const DEFAULT_SETTINGS: GhostyPostySettings = {
    ghostUrl: '',
    apiKey: '',
    imagesDirectory: 'assets/files',
    openEditorAfterPublish: false
}

export default class GhostyPostyPlugin extends Plugin {
    settings: GhostyPostySettings;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new GhostyPostySettingTab(this.app, this));

        // Add a command to publish the current note as a draft
        this.addCommand({
            id: 'publish-note-as-draft',
            name: 'Publish current note as a draft or post',
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
    
    parseFrontMatter(content: string): { frontMatter: FrontMatterData, markdownContent: string } {
        console.log('Parsing frontmatter from note');
        
        // Default values
        const frontMatter: FrontMatterData = {
            status: 'draft',
            tags: []
        };
        
        // Check if the content has frontmatter (starts with ---)
        if (!content.startsWith('---')) {
            console.log('No frontmatter found, using entire content');
            return { frontMatter, markdownContent: content };
        }
        
        // Find the end of the frontmatter
        const secondDivider = content.indexOf('---', 3);
        if (secondDivider === -1) {
            console.log('No closing frontmatter delimiter found');
            return { frontMatter, markdownContent: content };
        }
        
        // Extract the frontmatter and the remaining content
        const frontMatterText = content.substring(3, secondDivider).trim();
        const markdownContent = content.substring(secondDivider + 3).trim();
        
        console.log('Found frontmatter:', frontMatterText);
        
        // Parse frontmatter content
        const lines = frontMatterText.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines
            if (!line) continue;
            
            // Parse key-value pairs
            if (line.includes(':')) {
                const [key, value] = line.split(':', 2).map(s => s.trim());
                
                switch (key.toLowerCase()) {
                    case 'title':
                        frontMatter.title = value;
                        break;
                    case 'status':
                        frontMatter.status = value === 'post' || value === 'published' ? 'published' : 'draft';
                        break;
                    case 'time':
                        frontMatter.time = value;
                        break;
                    case 'tags':
                        // For tags, we need to handle the list format
                        const tagList: string[] = [];
                        
                        // If inline format: tags: tag1, tag2
                        if (value) {
                            value.split(',').forEach(tag => {
                                const trimmedTag = tag.trim();
                                if (trimmedTag) tagList.push(trimmedTag);
                            });
                        } 
                        // If it's a list format: look for indented lines with "- "
                        else {
                            let j = i + 1;
                            while (j < lines.length && lines[j].trim().startsWith('-')) {
                                const tag = lines[j].trim().substring(1).trim();
                                if (tag) tagList.push(tag);
                                j++;
                            }
                        }
                        
                        frontMatter.tags = tagList;
                        break;
                }
            }
        }
        
        console.log('Parsed frontmatter:', frontMatter);
        console.log('Content length:', markdownContent.length);
        
        return { frontMatter, markdownContent };
    }
    
    convertObsidianImageLinks(content: string): string {
        // Replace Obsidian image links ![[image.png]] with standard markdown ![](image.png)
        return content.replace(/!\[\[(.*?)\]\]/g, '![]($1)');
    }
    
    async processImageLinks(content: string, view: MarkdownView): Promise<string> {
        const imageRegex = /!\[\[(.*?)\]\]/g;
        const imagePaths: string[] = [];
        let match;
        
        // Find all image links in the content
        while ((match = imageRegex.exec(content)) !== null) {
            imagePaths.push(match[1]);
        }
        
        if (imagePaths.length === 0) {
            // No images to process, return original content
            return content;
        }
        
        console.log(`Found ${imagePaths.length} images to upload:`, imagePaths);
        
        // Process each image and get Ghost URLs
        const imageMap = new Map<string, string>();
        
        for (const imagePath of imagePaths) {
            try {
                const ghostUrl = await this.uploadImageToGhost(imagePath, view);
                if (ghostUrl) {
                    imageMap.set(imagePath, ghostUrl);
                }
            } catch (error) {
                console.error(`Error uploading image ${imagePath}:`, error);
                new Notice(`Failed to upload image ${imagePath}: ${error}`);
            }
        }
        
        // Replace image links with Ghost URLs
        let processedContent = content;
        for (const [imagePath, ghostUrl] of imageMap.entries()) {
            const regex = new RegExp(`!\\[\\[${this.escapeRegExp(imagePath)}\\]\\]`, 'g');
            processedContent = processedContent.replace(regex, `![](${ghostUrl})`);
        }
        
        return processedContent;
    }
    
    escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    async uploadImageToGhost(imagePath: string, view: MarkdownView): Promise<string | null> {
        try {
            // Get the file from the vault
            const file = this.app.vault.getAbstractFileByPath(
                // If path is relative, resolve it relative to the current note
                this.resolveImagePath(imagePath, view)
            );
            
            if (!file || !(file instanceof TFile)) {
                console.error(`File not found: ${imagePath}`);
                new Notice(`Image not found: ${imagePath}`);
                return null;
            }
            
            // Read the file as ArrayBuffer
            const fileData = await this.app.vault.readBinary(file);
            
            // Upload to Ghost
            const uploadUrl = await this.uploadFileToGhost(file.name, fileData);
            if (uploadUrl) {
                console.log(`Successfully uploaded ${file.name} to Ghost: ${uploadUrl}`);
                return uploadUrl;
            } else {
                console.error(`Failed to upload ${file.name} to Ghost`);
                return null;
            }
        } catch (error) {
            console.error(`Error uploading image ${imagePath}:`, error);
            return null;
        }
    }
    
    resolveImagePath(imagePath: string, view: MarkdownView): string {
        // First try absolute path
        if (imagePath.startsWith("/")) {
            return imagePath;
        }
        
        // Try relative to current note
        const currentNotePath = view.file?.parent?.path || "";
        const relativeToNote = `${currentNotePath}/${imagePath}`;
        
        // Check if file exists relative to note
        if (this.app.vault.getAbstractFileByPath(relativeToNote)) {
            return relativeToNote;
        }
        
        // If not found, try the configured images directory
        return `${this.settings.imagesDirectory}/${imagePath}`;
    }
    
    async uploadFileToGhost(fileName: string, fileData: ArrayBuffer): Promise<string | null> {
        try {
            const { ghostUrl, apiKey } = this.settings;
            
            if (!ghostUrl || !apiKey) {
                new Notice('Ghost URL and API Key are required');
                return null;
            }
            
            // Clean up the URL
            const baseUrl = ghostUrl.trim().replace(/\/$/, '');
            
            // Extract API credentials
            const [id, secret] = apiKey.split(':');
            if (!id || !secret) {
                new Notice('Invalid API key format');
                return null;
            }
            
            // Construct the API URL for uploading images
            const apiUrl = `${baseUrl}/ghost/api/admin/images/upload/`;
            console.log('Uploading image to:', apiUrl);
            
            // Create FormData with the file
            // Can't use regular FormData in Obsidian, so we need to use a custom boundary
            const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substring(2);
            
            const fileHeader = 
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
                `Content-Type: ${this.getMimeType(fileName)}\r\n\r\n`;
            
            const fileFooter = `\r\n--${boundary}--\r\n`;
            
            // Create buffer with file data
            const headerBuffer = new TextEncoder().encode(fileHeader);
            const footerBuffer = new TextEncoder().encode(fileFooter);
            
            // Combine buffers
            const combinedBuffer = new Uint8Array(
                headerBuffer.byteLength + fileData.byteLength + footerBuffer.byteLength
            );
            combinedBuffer.set(new Uint8Array(headerBuffer), 0);
            combinedBuffer.set(new Uint8Array(fileData), headerBuffer.byteLength);
            combinedBuffer.set(new Uint8Array(footerBuffer), headerBuffer.byteLength + fileData.byteLength);
            
            // Generate JWT token for Ghost Admin API
            const authToken = this.generateGhostAdminToken(id, secret);
            
            try {
                // Using Obsidian's requestUrl for upload
                const response = await requestUrl({
                    url: apiUrl,
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Authorization': authToken
                    },
                    body: combinedBuffer,
                    throw: true
                });
                
                if (response.status >= 200 && response.status < 300) {
                    console.log('Image upload successful:', response.json);
                    return response.json?.images?.[0]?.url || null;
                } else {
                    console.error('API Error during image upload:', response);
                    return null;
                }
            } catch (error) {
                console.error('Image upload failed, trying Node.js:', error);
                
                // Try with Node.js as fallback
                return await this.uploadFileWithNode(apiUrl, id, secret, fileName, fileData);
            }
        } catch (error) {
            console.error('Image upload error:', error);
            return null;
        }
    }
    
    async uploadFileWithNode(url: string, id: string, secret: string, fileName: string, fileData: ArrayBuffer): Promise<string | null> {
        return new Promise((resolve) => {
            try {
                // Try to access Node.js modules in Electron context
                // @ts-ignore - Accessing global window object
                const nodeRequire = window.require;
                
                if (!nodeRequire) {
                    console.log('Node require not available for image upload');
                    return resolve(null);
                }
                
                const https = nodeRequire('https');
                const crypto = nodeRequire('crypto');
                const urlObj = new URL(url);
                
                console.log('Uploading image via Node.js to bypass CORS');
                
                // Create boundary for multipart/form-data
                const boundary = '----NodeJSFormBoundary' + Math.random().toString(16).substring(2);
                
                // Create JWT token using Node.js crypto
                const now = Math.floor(Date.now() / 1000);
                const fiveMinutesFromNow = now + 5 * 60;
                
                // Create JWT header and payload
                const header = {
                    alg: 'HS256',
                    typ: 'JWT',
                    kid: id // Key ID
                };
                
                const payload = {
                    iat: now,
                    exp: fiveMinutesFromNow,
                    aud: '/v5/admin/'
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
                
                // Create multipart form-data
                const fileHeader = 
                    `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
                    `Content-Type: ${this.getMimeType(fileName)}\r\n\r\n`;
                
                const fileFooter = `\r\n--${boundary}--\r\n`;
                
                // Create buffer with file data
                const headerBuffer = Buffer.from(fileHeader);
                const footerBuffer = Buffer.from(fileFooter);
                const fileBuffer = Buffer.from(fileData);
                
                // Combine buffers
                const dataBuffer = Buffer.concat([
                    headerBuffer,
                    fileBuffer,
                    footerBuffer
                ]);
                
                const options = {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': dataBuffer.length,
                        'Authorization': `Ghost ${token}`
                    }
                };
                
                const req = https.request(options, (res: any) => {
                    let data = '';
                    
                    res.on('data', (chunk: string) => {
                        data += chunk;
                    });
                    
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const jsonData = JSON.parse(data);
                                console.log('Node.js image upload successful:', jsonData);
                                resolve(jsonData?.images?.[0]?.url || null);
                            } catch (e) {
                                console.error('Error parsing JSON from image upload response:', e);
                                resolve(null);
                            }
                        } else {
                            console.error('API Error from Node.js image upload:', res.statusCode);
                            console.error('Error response body:', data);
                            resolve(null);
                        }
                    });
                });
                
                req.on('error', (error: Error) => {
                    console.error('Node.js image upload error:', error);
                    resolve(null);
                });
                
                // Write data and end request
                req.write(dataBuffer);
                req.end();
                
            } catch (error) {
                console.error('Error in Node.js image upload:', error);
                resolve(null);
            }
        });
    }
    
    getMimeType(fileName: string): string {
        const extension = fileName.split('.').pop()?.toLowerCase();
        const mimeTypes: {[key: string]: string} = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'tiff': 'image/tiff',
            'tif': 'image/tiff',
            'bmp': 'image/bmp'
        };
        
        return mimeTypes[extension || ''] || 'application/octet-stream';
    }
    
    async publishCurrentNote(view: MarkdownView) {
        try {
            // Get the current note content and metadata
            const editor = view.editor;
            const content = editor.getValue();
            const fileName = view.file?.basename || 'Untitled Note';
            
            // Parse frontmatter
            const { frontMatter, markdownContent } = this.parseFrontMatter(content);
            
            // Create a placeholder notice while we process images
            const statusNotice = new Notice(`Processing images...`, 0);
            
            // Process and upload images
            const processedContent = await this.processImageLinks(markdownContent, view);
            
            // Remove the placeholder notice
            statusNotice.hide();
            
            // Use frontmatter title if available, otherwise use filename
            const title = frontMatter.title || fileName;
            
            // Create initial options from frontmatter or defaults
            const initialOptions: PublishOptions = {
                status: frontMatter.status || 'draft',
                tags: frontMatter.tags || []
            };
            
            // Show the preview modal
            new PublishPreviewModal(
                this.app,
                title,
                processedContent,
                initialOptions,
                async (options: PublishOptions) => {
                    // Create a new notice for publishing
                    const publishNotice = new Notice(`Publishing to Ghost as ${options.status}...`, 0);
                    
                    // Call the publish function with the selected options
                    const result = await this.publishToGhost(
                        title,
                        processedContent,
                        {
                            ...frontMatter,
                            status: options.status,
                            tags: options.tags
                        }
                    );
                    
                    // Remove the publishing notice
                    publishNotice.hide();
                    
                    // Show success or error message
                    if (result.success) {
                        new Notice(`Successfully published "${title}" as ${options.status}`);
                    } else {
                        new Notice(`Failed to publish: ${result.error}`);
                    }
                }
            ).open();
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
    
    parseMarkdownToMobiledoc(content: string): any {
        interface LexicalNode {
            type: string;
            children?: LexicalNode[];
            format?: number;
            style?: string;
            text?: string;
            detail?: number;
            mode?: string;
            direction?: string;
            indent?: number;
            version?: number;
            [key: string]: any;
        }

        // Helper function to create a text node
        const createTextNode = (text: string, format: number = 0): LexicalNode => ({
            type: "extended-text",
            detail: 0,
            format,
            mode: "normal",
            style: "",
            text,
            version: 1
        });

        // Helper function to create a paragraph node
        const createParagraphNode = (children: LexicalNode[]): LexicalNode => ({
            type: "paragraph",
            children,
            direction: "ltr",
            format: 0,
            indent: 0,
            version: 1
        });

        // Helper function to process text with links and formatting
        const processTextWithMarkup = (text: string): LexicalNode[] => {
            const nodes: LexicalNode[] = [];
            let currentText = text;
            let lastIndex = 0;

            // Process links first
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(text)) !== null) {
                const [fullMatch, linkText, url] = linkMatch;
                const matchIndex = linkMatch.index;

                // Add text before the link if any
                if (matchIndex > lastIndex) {
                    nodes.push(createTextNode(text.slice(lastIndex, matchIndex)));
                }

                // Add the link node
                nodes.push({
                    type: "link",
                    url,
                    children: [createTextNode(linkText)],
                    direction: "ltr",
                    format: 0,
                    indent: 0,
                    version: 1
                });

                lastIndex = matchIndex + fullMatch.length;
            }

            // Add remaining text
            if (lastIndex < text.length) {
                const remainingText = text.slice(lastIndex);
                
                // Process bold text first
                const boldRegex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
                let boldMatch;
                let boldLastIndex = 0;
                
                while ((boldMatch = boldRegex.exec(remainingText)) !== null) {
                    const [fullMatch, content] = boldMatch;
                    const matchIndex = boldMatch.index;
                    
                    // Add text before bold
                    if (matchIndex > boldLastIndex) {
                        const beforeText = remainingText.slice(boldLastIndex, matchIndex);
                        // Process italic in text before bold
                        const italicNodes = processItalicText(beforeText);
                        nodes.push(...italicNodes);
                    }
                    
                    // Add bold text (format 1 represents bold)
                    nodes.push(createTextNode(content, 1));
                    
                    boldLastIndex = matchIndex + fullMatch.length;
                }
                
                // Process remaining text for italic
                if (boldLastIndex < remainingText.length) {
                    const italicText = remainingText.slice(boldLastIndex);
                    const italicNodes = processItalicText(italicText);
                    nodes.push(...italicNodes);
                }
            }

            return nodes;
        };

        // Helper function to process italic text
        const processItalicText = (text: string): LexicalNode[] => {
            const nodes: LexicalNode[] = [];
            let lastIndex = 0;
            
            // Match single asterisks for italic, but not if they're part of a word
            const italicRegex = /(?<!\*)\*([^*]+)\*(?!\*)/g;
            let italicMatch;
            
            while ((italicMatch = italicRegex.exec(text)) !== null) {
                const [fullMatch, content] = italicMatch;
                const matchIndex = italicMatch.index;
                
                // Add text before italic
                if (matchIndex > lastIndex) {
                    nodes.push(createTextNode(text.slice(lastIndex, matchIndex)));
                }
                
                // Add italic text (format 2 represents italic)
                nodes.push(createTextNode(content, 2));
                
                lastIndex = matchIndex + fullMatch.length;
            }
            
            // Add any remaining text
            if (lastIndex < text.length) {
                nodes.push(createTextNode(text.slice(lastIndex)));
            }
            
            return nodes.length > 0 ? nodes : [createTextNode(text)];
        };

        // Process the content
        const rootChildren: LexicalNode[] = [];
        const paragraphs = content.split('\n\n').filter(p => p.trim());

        paragraphs.forEach(paragraph => {
            const trimmedParagraph = paragraph.trim();
            
            // Check for headings
            const headingMatch = trimmedParagraph.match(/^(#{1,6})\s+(.+)$/m);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const text = headingMatch[2].trim();
                rootChildren.push({
                    type: "heading",
                    tag: `h${level}`,
                    children: processTextWithMarkup(text),
                    direction: "ltr",
                    format: 0,
                    indent: 0,
                    version: 1
                });
                return;
            }

            // Check for blockquotes
            if (trimmedParagraph.startsWith('>')) {
                const quoteText = trimmedParagraph.substring(1).trim();
                rootChildren.push({
                    type: "quote",
                    children: [createParagraphNode(processTextWithMarkup(quoteText))],
                    direction: "ltr",
                    format: 0,
                    indent: 0,
                    version: 1
                });
                return;
            }

            // Check for images
            const imageMatch = trimmedParagraph.match(/^!\[(.*?)\]\((.*?)\)$/);
            if (imageMatch) {
                const [_, alt, src] = imageMatch;
                rootChildren.push({
                    type: "image",
                    src,
                    altText: alt,
                    width: undefined,
                    height: undefined,
                    maxWidth: "100%",
                    showCaption: false,
                    caption: undefined,
                    direction: "ltr",
                    format: 0,
                    indent: 0,
                    version: 1
                });
                return;
            }

            // Regular paragraph
            rootChildren.push(createParagraphNode(processTextWithMarkup(trimmedParagraph)));
        });

        // Create the root node
        const root: LexicalNode = {
            type: "root",
            children: rootChildren,
            direction: "ltr",
            format: 0,
            indent: 0,
            version: 1
        };

        return JSON.stringify({ root });
    }

    async publishToGhost(title: string, markdownContent: string, frontMatter: FrontMatterData): Promise<{ success: boolean, error?: string, postUrl?: string }> {
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
            
            // Clean up the markdown content
            const cleanMarkdown = markdownContent.trim();
            
            // Check if first line is an image
            const lines = cleanMarkdown.split('\n');
            let featuredImage: string | undefined;
            let contentWithoutFirstImage = cleanMarkdown;
            
            if (lines.length > 0) {
                const firstLine = lines[0].trim();
                const imageMatch = firstLine.match(/^!\[.*?\]\((.*?)\)$/);
                if (imageMatch) {
                    featuredImage = imageMatch[1];
                    // Remove the first image from content
                    contentWithoutFirstImage = lines.slice(1).join('\n').trim();
                }
            }
            
            // Parse markdown into Lexical format
            const lexical = this.parseMarkdownToMobiledoc(contentWithoutFirstImage);
            
            // Log the Lexical content for debugging
            console.log('Generated Lexical content:', lexical);
            
            // Prepare the post data
            const postData: any = {
                posts: [{
                    title: title,
                    lexical: lexical,
                    status: frontMatter.status || 'draft'
                }]
            };
            
            // Add featured image if found
            if (featuredImage) {
                postData.posts[0].feature_image = featuredImage;
            }
            
            // Add tags if present
            if (frontMatter.tags && frontMatter.tags.length > 0) {
                postData.posts[0].tags = frontMatter.tags.map(tag => ({ name: tag }));
                console.log('Adding tags:', postData.posts[0].tags);
            }
            
            // Add scheduled time if present and status is 'published'
            if (frontMatter.time && frontMatter.status === 'published') {
                postData.posts[0].published_at = frontMatter.time;
                console.log('Scheduling post for:', frontMatter.time);
            }
            
            console.log('Post data sample:', JSON.stringify({
                posts: [{
                    title: title,
                    lexical: JSON.stringify(lexical).substring(0, 100) + '...',
                    status: frontMatter.status || 'draft',
                    tags: postData.posts[0].tags || [],
                    published_at: postData.posts[0].published_at || null,
                    feature_image: featuredImage
                }]
            }));
            
            // Try to publish the post using Obsidian's requestUrl
            try {
                // Generate proper JWT token for Ghost Admin API
                const authToken = this.generateGhostAdminToken(id, secret);
                console.log('Using JWT token format for authentication');
                
                const response = await requestUrl({
                    url: `${baseUrl}/ghost/api/admin/posts/`,
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
                    
                    // If enabled, open the editor URL
                    if (this.settings.openEditorAfterPublish && jsonData?.posts?.[0]?.id) {
                        const editorUrl = `${this.settings.ghostUrl}/ghost/#/editor/post/${jsonData.posts[0].id}`;
                        window.open(editorUrl, '_blank');
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
                        return await this.publishWithNode(baseUrl, id, secret, postData);
                    }
                    
                    return { 
                        success: false, 
                        error: `API Error (${response.status}): ${errorResponse}` 
                    };
                }
            } catch (error) {
                console.error('Obsidian request failed when publishing, trying Node.js:', error);
                
                // Try with Node.js as fallback
                return await this.publishWithNode(baseUrl, id, secret, postData);
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
                                
                                // If enabled, open the editor URL
                                if (this.settings.openEditorAfterPublish && jsonData?.posts?.[0]?.id) {
                                    const editorUrl = `${this.settings.ghostUrl}/ghost/#/editor/post/${jsonData.posts[0].id}`;
                                    window.open(editorUrl, '_blank');
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
            .setName('Images Directory')
            .setDesc('Default directory in your vault where images are stored (e.g., assets/files)')
            .addText(text => text
                .setPlaceholder('assets/files')
                .setValue(this.plugin.settings.imagesDirectory)
                .onChange(async (value) => {
                    // Remove leading and trailing slashes for consistency
                    this.plugin.settings.imagesDirectory = value.replace(/^\/+|\/+$/g, '');
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Open Editor After Publish')
            .setDesc('Whether to open the editor after publishing a post')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.openEditorAfterPublish)
                .onChange(async (value) => {
                    this.plugin.settings.openEditorAfterPublish = value;
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