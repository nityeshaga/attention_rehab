# Attention Rehab - Browser Extension Overview
This is a Chrome extension designed to help users maintain focus by blocking
distracting websites with a unique "access pass" system. Here's how it works:

## Core Functionality

### Website Blocking
The extension blocks access to potentially distracting websites like social media
platforms (Twitter/X, LinkedIn, YouTube, Instagram, Facebook, TikTok, Twitch).

### Work Mode Toggle
Users can enable/disable "Work Mode" which activates the blocking functionality.

### Access Pass System
Instead of completely blocking sites, the extension allows temporary access through
timed "passes":

* 1-minute "Look something up real quick" pass
* 5-minute "Do a little research" pass
* 15-minute "I'm on a break" pass

### Daily Pass Tracking
The extension tracks how many passes of each duration are used per day, resetting
counts at midnight.

## Technical Implementation

### Background Script (background.js)
Handles the core blocking logic, pass management, and tab monitoring.

### Popup Interface (popup.html, popup.js)
Provides UI for toggling work mode and managing blocked sites.

### Blocking Page (blocked.html)
Shows when a blocked site is accessed, offering access pass options.

### Manifest (manifest.json)
Defines permissions, content scripts, and extension metadata.

## User Flow

1. User adds distracting websites to the block list via the popup
2. When Work Mode is enabled and user tries to access a blocked site, they're
redirected to the blocked.html page
3. User can choose to get temporary access by selecting one of the timed passes
4. The extension tracks pass usage and automatically revokes access when the time
expires

This extension essentially functions as a "distraction rehabilitation center" that
helps users be more mindful of their browsing habits while still allowing controlled
access when needed.
