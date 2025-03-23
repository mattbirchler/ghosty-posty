# Ghosty Posty

An Obsidian plugin for publishing notes to Ghost blogs.

## Features

- Connect to your Ghost blog via the Admin API
- Validate your Ghost credentials
- Publish Obsidian notes to your Ghost blog as drafts

## Installation

1. Download the latest release from the Releases section
2. Extract the zip file in your `.obsidian/plugins/` directory
3. Enable the plugin in Obsidian settings

## Setup

1. Go to the Ghosty Posty settings in Obsidian
2. Enter your Ghost blog URL (e.g., `https://yourblog.ghost.io`)
3. Enter your Ghost Admin API key
   - You can find this in your Ghost Admin settings under "Integrations"
   - Create a custom integration if you don't have one already
   - The API key format should be: `{id}:{secret}`
4. Click "Test Connection" to verify your credentials

## Usage

1. Open the note you want to publish
2. Open the Command Palette (Ctrl+P or Cmd+P)
3. Search for "Publish current note as a draft"
4. The note will be published to your Ghost blog as a draft

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
git clone https://github.com/yourusername/ghosty-posty

# Install dependencies
npm install

# Build the plugin
npm run build

# Development with hot-reload
npm run dev
``` 