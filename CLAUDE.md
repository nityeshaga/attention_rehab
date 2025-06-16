# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Attention Rehab is a Chrome browser extension that helps users maintain focus by blocking distracting websites with a timed "access pass" system. The extension allows temporary controlled access to blocked sites rather than complete blocking.

## Architecture

### Core Components

- **background.js**: Service worker handling blocking logic, pass management, and analytics data storage
- **popup.html/js**: Extension popup interface for managing blocked sites and toggling work mode
- **blocked.html/js**: Interstitial page shown when accessing blocked sites, offers timed access passes
- **content.js**: Content script for site-specific interactions and communication with background script
- **timer.js**: Countdown timer display system for active passes
- **motivational-messages.js**: Motivational content shown to users

### Data Architecture

The extension uses a sophisticated date-based storage system in Chrome's local storage:
- Date-keyed objects (YYYY-MM-DD format) with hour-keyed nested objects
- Pass usage tracked by specific date and hour for analytics
- Supports 24-hour and 7-day usage visualization

### Pass System

Three types of timed access passes:
- 1-minute "Look something up real quick" pass
- 5-minute "Do a little research" pass  
- 15-minute "I'm on a break" pass

## Development

### Loading the Extension

Since this is a Chrome extension (Manifest V3), load it in Chrome via:
1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

### Key Files for Development

- **manifest.json**: Extension configuration and permissions
- **background.js**: Core blocking and data management logic
- **blocked.js**: Analytics visualization and pass selection UI
- Storage system uses `chrome.storage.local` for pass data and `chrome.storage.sync` for settings

### Testing

Test the extension by:
1. Adding sites to the block list via the popup
2. Enabling work mode
3. Navigating to blocked sites to test the blocking/pass system
4. Verifying analytics data collection and visualization