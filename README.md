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

### Usage Analytics
The extension provides detailed analytics of pass usage:
* 24-hour view: Shows pass usage broken down by hour
* 7-day view: Shows daily pass usage trends over the past week
* Interactive charts with hover effects to display detailed usage information

### Daily Pass Tracking
The extension tracks how many passes of each duration are used per day and hour, 
with data organized in a date-based storage system that resets at midnight.

## Technical Implementation

### Background Script (background.js)
Handles the core blocking logic, pass management, and tab monitoring. Implements:
* Smart URL matching to block entire domains or specific paths
* Alarm-based pass expiration system
* Date-based storage system for tracking pass usage

### Popup Interface (popup.html, popup.js)
Provides UI for toggling work mode and managing blocked sites:
* Add/remove sites from block list
* Toggle Work Mode on/off

### Blocking Page (blocked.html, blocked.js)
Shows when a blocked site is accessed, offering:
* Access pass options with usage counters
* Interactive data visualization of pass usage
* Toggle between 24-hour and 7-day analytics views

### Timer System (timer.js)
Displays a countdown timer on sites accessed via a pass:
* Shows remaining time in minutes and seconds
* Automatically expires when time runs out

### Content Script (content.js)
Handles site-specific interactions:
* Detects when a user is on a blocked site
* Communicates with background script for pass management

### Data Storage System
Uses a sophisticated date-based object structure:
* Date-keyed objects (YYYY-MM-DD format) with hour-keyed nested objects
* Stores pass usage data by specific date and hour
* Makes it easy to retrieve historical data for any time period
* Supports advanced analytics features

## User Flow

1. User adds distracting websites to the block list via the popup
2. When Work Mode is enabled and user tries to access a blocked site, they're
   redirected to the blocked.html page
3. User can choose to get temporary access by selecting one of the timed passes
4. The extension displays a countdown timer on the accessed site
5. The extension tracks pass usage and automatically revokes access when the time
   expires
6. User can view their usage patterns through interactive charts to become more
   mindful of their browsing habits

This extension essentially functions as a "distraction rehabilitation center" that
helps users be more mindful of their browsing habits while still allowing controlled
access when needed.
