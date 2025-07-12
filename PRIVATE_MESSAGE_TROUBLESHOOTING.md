# Private Message Troubleshooting Guide

## Overview
The NakenChat Client now supports private messaging with dedicated tabs for each conversation. This guide helps you troubleshoot any issues you might encounter.

## How Private Messages Work

### Sending Private Messages
1. Use the command `.p <user_number> <message>` to send a private message
2. Example: `.p 1 hello there`
3. A new tab will be created automatically for the conversation

### Receiving Private Messages
1. When someone sends you a private message, a new tab will be created
2. The tab will flash to notify you of the new message
3. Click on the tab to view the conversation

## Visual Indicators

### Private Tabs
- Private tabs have an orange left border
- They appear with the format `#<number> <username>`
- Active private tabs have an orange gradient background
- Flashing tabs indicate new messages

### Private Messages
- Private messages have an orange left border in the chat
- Username pills are orange for private messages

## Troubleshooting Steps

### 1. Check Browser Console
Open your browser's developer tools (F12) and check the console for debug messages. Look for:
- `Checking for private message patterns in: "..."`
- `Matched Pattern X (description): ...`
- `Handling outgoing/incoming private message...`
- `Created private tab: pm_X for user #X username`

### 2. Verify Server Connection
Make sure you're connected to the server:
- Check the connection status in the top-right corner
- Ensure you can see the user list in the sidebar
- Try sending a regular message to the main chat

### 3. Test Private Message Patterns
Run the test script to verify pattern matching:
```bash
node test-private-messages.js
```

### 4. Common Issues and Solutions

#### Issue: Private tabs not being created
**Symptoms:** You send `.p 1 hello` but no tab appears
**Possible causes:**
- Server is using a different message format
- Message pattern detection failed
- JavaScript error in tab creation

**Solutions:**
1. Check browser console for error messages
2. Try connecting to a different server to test
3. Verify the server response format in console logs

#### Issue: Messages not appearing in private tabs
**Symptoms:** Tab is created but messages don't show up
**Possible causes:**
- Tab switching logic failed
- Message routing to wrong tab
- Chat history not being saved

**Solutions:**
1. Check if the tab is active (highlighted)
2. Look for console errors about message display
3. Try switching to the main tab and back

#### Issue: Private tabs disappear on reconnect
**Symptoms:** Private tabs are lost when you disconnect and reconnect
**Expected behavior:** This is normal - private tabs are cleared on disconnect for security

#### Issue: Can't close private tabs
**Symptoms:** Clicking the X button doesn't close the tab
**Solutions:**
1. Make sure you're clicking the X button, not the download button
2. Try switching to the main tab first
3. Check for JavaScript errors in console

### 5. Server Version Compatibility

The client supports multiple server message formats:

#### Local Server (Version 2.22)
- Outgoing: `>> Message sent to [1]bob: <0>Derrick (private): hi`
- Incoming: `<1>bob (private): hello`

#### Online Server (Different versions)
- Outgoing: `>> Message sent to [1]bob.`
- Incoming: `<1>bob: hello (private)` or `[1]bob (private): hello`

### 6. Debug Mode

To enable additional debugging, you can temporarily add this to the browser console:
```javascript
// Enable verbose logging
localStorage.setItem('debugPrivateMessages', 'true');
```

### 7. Manual Testing

To test private message functionality:

1. **Connect to a server** with at least one other user
2. **Send a private message:** `.p <user_number> test message`
3. **Check for tab creation** - a new tab should appear
4. **Verify message appears** in the private tab
5. **Test incoming messages** by having the other user respond

### 8. Reporting Issues

If you encounter issues, please provide:
1. Browser console logs (F12 → Console)
2. Server version/type (local vs online)
3. Steps to reproduce the issue
4. Expected vs actual behavior

## Technical Details

### Message Pattern Detection
The client uses 5 different regex patterns to detect private messages:

1. **Outgoing with echo:** `>> Message sent to [1]bob: <0>Derrick (private): hi`
2. **Incoming standard:** `<1>bob (private): hello`
3. **Short confirmation:** `>> Message sent to [1]bob.`
4. **Alternative incoming:** `<1>bob: hello (private)`
5. **Alternative format 2:** `[1]bob (private): hello`

### Tab Management
- Private tabs use the format `pm_<user_number>`
- Chat histories are stored in localStorage
- Tabs are cleared on disconnect for security
- Each tab maintains its own message history

### Error Handling
- All private message functions have try-catch blocks
- Console logging helps identify issues
- Graceful fallbacks prevent crashes 