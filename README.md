# Ghosty Posty

An Obsidian plugin for publishing notes to Ghost blogs.

## Features

- Connect to Ghost Pro or any self-hosted Ghost website
- Post as draft or published
- Schedule posts for later
- Limit visibility to members, paid members, or just show to everyone
- Tags
- Featured posts
- Upload images (including header images)

## Installation

1. Download the latest release from the Releases section
2. Extract the zip file in your `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian settings

Currently tested on macOS, Windows, and iOS.

## Setup

1. Go to the Ghosty Posty settings in Obsidian
2. Enter your Ghost blog URL (e.g., `https://yourblog.ghost.io`)
3. Enter your Ghost Admin API key
   - You can find this in your Ghost Admin settings under "Integrations"
   - Create a "custom integration"
   - The Admin API key format should be: `{id}:{secret}`
4. Click "Test Connection" to verify your credentials

## Usage

1. Open the note you want to publish
2. Open the Command Palette (Ctrl+P or Cmd+P)
3. Search for "Publish current note as a draft" or "Ghosty Posty"
4. Confirm the details on the preview pop up
5. Post to your site

## Properties

Using properties in your notes is completely optional, but you can use them to configure each post before bringing up the preview pop up. Supported properties are:

| Property | Description |
| --- | --- |
| title | The title of your post (uses note title if empty) |
| status | `draft`, `published`, or `scheduled` |
| time | When to publish a scheduled post (ISO 8601 format), only used when status is 'scheduled' |
| tags | Comma-separated list of tags to apply to the post |
| featured | `true` or 'false' |
| visibility | `public`, `members`, or `paid` |

Here's an exmaple that would work.

---
title: My Great Blog post
status: scheduled
time: 2025-09-16T10:00:00Z
tags: tutorial, guide
featured: false
visibility: public
---

I'd recommend using a plugin like [Tempalter](https://github.com/SilentVoid13/Templater) to automatially generate these properties if you're going to use them regularly.

## Good-to-Knows

- If the first item in a post is an image, we assume this is meant to be the "featured image" on the post and will upload it as such to Ghost. All other images will display inline in your post body.
- When you trigger the plugin, any images in the post will be processed and uploaded before the preview pop up appears, so there may be a few seconds delay when posting something with several images.

## Troubleshooting

If you encounter issues with the plugin, you can check the developer console for detailed logs:

1. **On Windows/Linux**: Press `Ctrl+Shift+I` to open the developer console
2. **On macOS**: Press `Cmd+Option+I` to open the developer console
3. Look for any error messages in the Console tab

Common issues:
- **Invalid token errors**: Make sure your API key is correctly formatted and has the proper permissions in Ghost
- **CORS errors**: These can occur when connecting to certain Ghost instances. The plugin tries multiple methods to bypass these restrictions.
- **Connection errors**: Check your Ghost URL and make sure your internet connection is working

## Development

```bash
# Clone this repository
git clone https://github.com/mattbirchler/ghosty-posty

# Install dependencies
npm install

# Build the plugin
npm run build
``` 