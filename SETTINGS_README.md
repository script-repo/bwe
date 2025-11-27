# BWE Settings Feature

## Overview

This document describes the new settings functionality added to the Big Wheel of Excitement (BWE) application.

## Features

### 1. Settings Icon
- A settings icon (⚙️) is displayed in the top-right corner of the page
- Clicking the icon opens the settings modal
- The icon has a hover effect with rotation animation

### 2. Settings Modal

The settings modal provides the following customization options:

#### Wheel Text Customization
- **Title**: Edit the main title displayed on the wheel (e.g., "BIG WHEEL")
- **Subtitle**: Edit the subtitle displayed below the title (e.g., "OF EXCITEMENT")

#### Wheel Names Management
- **Add Names**: Click the "➕ Add Name" button to add new names to the wheel
- **Edit Names**: Click on any name input field to edit existing names
- **Remove Names**: Click the trash icon (🗑️) next to a name to remove it

### 3. Settings Persistence

All settings are saved to the browser's localStorage, which means:
- Settings persist across page reloads
- Settings are specific to each browser/device
- No server-side storage is required

### 4. User Interface Features

- **Responsive Design**: The settings interface adapts to mobile and desktop screens
- **Accessibility**: Full keyboard navigation support with proper focus management
- **Visual Feedback**: Success/error notifications for user actions
- **Escape Key**: Press ESC to close the modal
- **Click Outside**: Click outside the modal to close it

## Usage

1. **Open Settings**: Click the ⚙️ icon in the top-right corner
2. **Edit Title/Subtitle**: Type in the input fields for title and subtitle
3. **Manage Names**:
   - Click "Add Name" to add a new name field
   - Type in the name fields to add or edit names
   - Click the trash icon to remove a name
4. **Save Changes**: Click "Save Changes" to apply your settings
5. **Reset**: Click "Reset to Default" to restore original settings

## Technical Details

### Files Added

- `settings.js` - JavaScript module for settings functionality
- `settings.css` - Styles for the settings UI
- `SETTINGS_README.md` - This documentation file

### Files Modified

- `index.html` - Added references to settings.js and settings.css

### Storage Format

Settings are stored in localStorage with the key `bwe_settings` in the following format:

```json
{
  "title": "BIG WHEEL",
  "subtitle": "OF EXCITEMENT",
  "names": ["Name 1", "Name 2", "Name 3"]
}
```

### Browser Compatibility

- Modern browsers with ES6+ support
- localStorage support required
- CSS Grid and Flexbox support

## Notes

- The wheel names are stored in settings but require a page reload to be applied to the React app
- Title and subtitle changes are applied immediately when saved
- Settings are browser-specific and not synced across devices

## Future Enhancements

Potential improvements for future versions:
- Real-time wheel updates without page reload
- Import/export settings functionality
- Theme customization
- Cloud sync for settings across devices
