import { App, Modal, Setting, MarkdownRenderer, Component } from 'obsidian';

export interface PublishOptions {
    status: 'draft' | 'published';
    tags: string[];
    featured: boolean;
    visibility: 'public' | 'members' | 'paid';
}

export class PublishPreviewModal extends Modal {
    private markdownContent: string;
    private title: string;
    private initialOptions: PublishOptions;
    private onSubmit: (options: PublishOptions) => void;
    private previewEl: HTMLElement;
    private currentOptions: PublishOptions;
    private previewComponent: Component;

    constructor(
        app: App,
        title: string,
        markdownContent: string,
        initialOptions: PublishOptions,
        onSubmit: (options: PublishOptions) => void
    ) {
        super(app);
        this.title = title;
        this.markdownContent = markdownContent;
        this.initialOptions = initialOptions;
        this.onSubmit = onSubmit;
        this.currentOptions = { ...initialOptions };
        this.previewComponent = new Component();
    }

    onOpen() {
        const { contentEl } = this;

        // Create container with max height and scrolling
        contentEl.createEl('h2', { text: 'Preview & Publish' });

        // Add publishing options
        new Setting(contentEl)
            .setName('Status')
            .addDropdown(dropdown => dropdown
                .addOption('draft', 'Draft')
                .addOption('published', 'Published')
                .setValue(this.currentOptions.status)
                .onChange(value => {
                    this.currentOptions.status = value as 'draft' | 'published';
                }));

        // Visibility dropdown
        new Setting(contentEl)
            .setName('Visibility')
            .setDesc('Who can see this post')
            .addDropdown(dropdown => dropdown
                .addOption('public', 'Everyone')
                .addOption('members', 'All Members')
                .addOption('paid', 'Paid Members Only')
                .setValue(this.currentOptions.visibility)
                .onChange(value => {
                    this.currentOptions.visibility = value as 'public' | 'members' | 'paid';
                }));

        // Featured post toggle
        new Setting(contentEl)
            .setName('Featured Post')
            .setDesc('Mark this post as featured')
            .addToggle(toggle => toggle
                .setValue(this.currentOptions.featured)
                .onChange(value => {
                    this.currentOptions.featured = value;
                }));

        // Tags input
        const tagsContainer = contentEl.createDiv();
        new Setting(tagsContainer)
            .setName('Tags')
            .setDesc('Comma-separated list of tags')
            .addText(text => text
                .setValue(this.currentOptions.tags.join(', '))
                .onChange(value => {
                    this.currentOptions.tags = value.split(',')
                        .map(tag => tag.trim())
                        .filter(tag => tag.length > 0);
                }));

        // Title preview
        contentEl.createEl('h3', { text: this.title });

        // Create preview container with max height and scrolling
        const previewContainer = contentEl.createDiv({ cls: 'publish-preview-container' });
        previewContainer.style.maxHeight = '200px';
        previewContainer.style.overflow = 'auto';
        previewContainer.style.padding = '10px';
        previewContainer.style.border = '1px solid var(--background-modifier-border)';
        previewContainer.style.borderRadius = '4px';
        previewContainer.style.marginBottom = '20px';

        // Add style element for preview container
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            .publish-preview-container img {
                max-width: 300px;
                height: auto;
                display: block;
                margin: 10px 0;
                border-radius: 8px;
            }
        `;
        previewContainer.appendChild(styleEl);

        // Create preview element
        this.previewEl = previewContainer.createDiv();
        
        // Render markdown preview
        MarkdownRenderer.renderMarkdown(
            this.markdownContent,
            this.previewEl,
            '',
            this.previewComponent
        );

        // Add buttons
        const buttonContainer = contentEl.createDiv({ cls: 'publish-preview-buttons' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.marginTop = '20px';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.close());

        const publishButton = buttonContainer.createEl('button', { 
            text: 'Publish',
            cls: 'mod-cta'
        });
        publishButton.addEventListener('click', () => {
            this.onSubmit(this.currentOptions);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.previewComponent.unload();
    }
} 