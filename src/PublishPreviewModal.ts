import { App, Modal, Setting, MarkdownRenderer, Component, DropdownComponent } from 'obsidian';
import './styles.css';

export interface PublishOptions {
    status: 'draft' | 'published' | 'scheduled';
    tags: string[];
    featured: boolean;
    visibility: 'public' | 'members' | 'paid';
    scheduledTime: Date | null;
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
        this.currentOptions = { 
            ...initialOptions,
            scheduledTime: initialOptions.scheduledTime || new Date()
        };
        this.previewComponent = new Component();
    }

    onOpen() {
        const { contentEl } = this;

        // Create container with max height and scrolling
        contentEl.createEl('h2', { text: 'Preview & Publish' });

        // Add publishing options
        // Title input
        new Setting(contentEl)
            .setName('Title')
            .addText(text => text
                .setValue(this.title)
                .onChange(value => {
                    this.title = value;
                }));

        let statusDropdown: DropdownComponent;
        const statusSetting = new Setting(contentEl)
            .setName('Status')
            .addDropdown(dropdown => {
                statusDropdown = dropdown;
                return dropdown
                    .addOption('draft', 'Draft')
                    .addOption('published', 'Published')
                    .addOption('scheduled', 'Schedule for Later')
                    .setValue(this.currentOptions.status)
                    .onChange(value => {
                        const newStatus = value as 'draft' | 'published' | 'scheduled';
                        this.currentOptions.status = newStatus;
                        
                        // Update scheduledTime based on status
                        if (newStatus === 'scheduled') {
                            scheduleSetting.settingEl.style.display = 'flex';
                            if (!this.currentOptions.scheduledTime || this.currentOptions.scheduledTime <= new Date()) {
                                // Set default scheduled time to tomorrow at the same time
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                this.currentOptions.scheduledTime = tomorrow;
                                dateInput.value = this.formatDateForInput(tomorrow);
                            }
                        } else {
                            scheduleSetting.settingEl.style.display = 'none';
                            this.currentOptions.scheduledTime = new Date();
                        }
                    });
            });

        // Schedule post setting
        const scheduleSetting = new Setting(contentEl)
            .setName('Schedule Post')
            .setDesc('Set when this post should be published (in your local time zone)');

        const dateInput = scheduleSetting.controlEl.createEl('input', {
            type: 'datetime-local',
            value: this.formatDateForInput(this.currentOptions.scheduledTime)
        });
        
        dateInput.type = 'datetime-local';
        dateInput.value = this.formatDateForInput(this.currentOptions.scheduledTime);
        dateInput.className = 'publish-preview-datetime-input';
        
        dateInput.addEventListener('input', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.value) {
                // Create date from local input value
                const scheduledDate = new Date(target.value);
                this.currentOptions.scheduledTime = scheduledDate;
            } else {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                this.currentOptions.scheduledTime = tomorrow;
                dateInput.value = this.formatDateForInput(tomorrow);
            }
        });

        // Initially hide/show schedule setting based on current status
        scheduleSetting.settingEl.style.display = 
            this.currentOptions.status === 'scheduled' ? 'flex' : 'none';

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

        // Preview section
        const previewHeader = contentEl.createEl('div', { cls: 'publish-preview-header' });
        const expandButton = previewHeader.createEl('button', { 
            cls: 'clickable-icon publish-preview-toggle',
            text: 'Show preview'
        });

        // Create preview container with max height and scrolling
        const previewContainer = contentEl.createDiv({ cls: 'publish-preview-container' });
        previewContainer.style.display = 'none'; // Hidden by default

        // Add preview element
        this.previewEl = previewContainer.createDiv();
        
        // Render markdown preview
        MarkdownRenderer.renderMarkdown(
            this.markdownContent,
            this.previewEl,
            '',
            this.previewComponent
        ).then(() => {
            // Add preview-image class to all images
            const images = this.previewEl.querySelectorAll('img');
            images.forEach(img => {
                if (img instanceof HTMLElement) {
                    img.addClasses(['preview-image']);
                }
            });
        });

        // Add click handler for expand/collapse
        expandButton.addEventListener('click', () => {
            const isHidden = previewContainer.style.display === 'none';
            previewContainer.style.display = isHidden ? 'block' : 'none';
            expandButton.setText(isHidden ? 'Hide preview' : 'Show preview');
        });

        // Add buttons at the bottom
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container publish-preview-buttons' });

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel',
            cls: 'modal-button'
        });
        cancelButton.addEventListener('click', () => this.close());

        const publishButton = buttonContainer.createEl('button', { 
            text: 'Publish',
            cls: 'modal-button mod-cta'
        });
        publishButton.addEventListener('click', () => {
            this.onSubmit(this.currentOptions);
            this.close();
        });
    }

    private formatDateForInput(date: Date | null): string {
        const inputDate = date || new Date();
        // Get local ISO string (YYYY-MM-DDTHH:mm) by adjusting for timezone
        const year = inputDate.getFullYear();
        const month = String(inputDate.getMonth() + 1).padStart(2, '0');
        const day = String(inputDate.getDate()).padStart(2, '0');
        const hours = String(inputDate.getHours()).padStart(2, '0');
        const minutes = String(inputDate.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.previewComponent.unload();
    }
} 