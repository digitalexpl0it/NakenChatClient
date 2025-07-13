// At the top of the file, add a helper for debug logging
function debugLog(...args) {
    if (window.NAKENCHAT_DEBUG) console.log(...args);
}

// Merge customEmojis from config.js if available (browser-safe)
let customEmojis = {};
if (typeof window !== 'undefined' && window.config && window.config.customEmojis) {
    customEmojis = window.config.customEmojis;
} else if (typeof require === 'function') {
    try {
        const config = require('./config');
        customEmojis = config.customEmojis || {};
    } catch (e) {
        // ignore if not available
    }
}

class NakenChatClient {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.username = '';
        this.server = '';
        this.port = 6666;
        this.users = new Map();
        this.currentChannel = 'main';
        this.demoMode = false; // Set to true to simulate users for demo/testing only
        
        this.emojiMap = Object.assign({
            ':D': '😀', ':P': '😛', ':)': '🙂', ':(': '😞', ';)': '😉',
            ':O': '😮', ':o': '😮', ':|': '😐', ':/': '😕', ':\\': '😕',
            '8)': '😎', '8-)': '😎', 'B)': '😎', 'B-)': '😎',
            '<3': '❤️', '</3': '💔', ':heart:': '❤️',
            ':smile:': '😊', ':sad:': '😢', ':wink:': '😉',
            ':lol:': '😂', ':rofl:': '🤣', ':cool:': '😎',
            ':thumbsup:': '👍', ':thumbsdown:': '👎',
            ':wave:': '👋', ':clap:': '👏', ':pray:': '🙏'
        }, customEmojis);
        
        this.initializeElements();
        this.bindEvents();
        this.loadSettings();
        this.checkWelcomePreference();
        // Show connection modal on page load if not connected
        if (!this.isConnected) {
            this.showConnectionModal();
        }
        this.collectingHelp = false;
        this.helpBuffer = [];
        this.awaitingHelpBlankLine = false;
        this.helpTimeout = null;
        this.suppressNextLine = false;
        this.collectingUsers = false;
        this.userBuffer = [];
        this.collectingZUsers = false;
        this.zUserBuffer = [];
        // Update auto-refresh interval to 30 seconds
        this.autoRefreshInterval = setInterval(() => {
            if (this.isConnected) this.sendCommand('.w');
        }, 30000); // 30 seconds
        this.welcomeBuffer = [];
        this.collectingWelcome = false;
        this.hasShownWelcome = false;
        this.suppressServerHelp = false;
        this.chatHistories = { main: [] };
        this.activeTab = 'main';
        this.tabUsers = {}; // { tabId: { number, username } }
        this.loadChatHistories();
        this.lastPrivateSent = null; // Track last private message sent
        this.lastPrivateSentTimeout = null; // Track timeout for last private sent message
    }
    
    initializeElements() {
        this.elements = {
            // Modal elements
            connectionModal: document.getElementById('connectionModal'),
            modalServerInput: document.getElementById('modalServerInput'),
            modalPortInput: document.getElementById('modalPortInput'),
            modalUsernameInput: document.getElementById('modalUsernameInput'),
            modalConnectBtn: document.getElementById('modalConnectBtn'),
            modalCancelBtn: document.getElementById('modalCancelBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            // Connection elements
            disconnectBtn: document.getElementById('disconnectBtn'),
            messageInput: document.getElementById('messageInput'),
            sendBtn: document.getElementById('sendBtn'),
            chatMessages: document.getElementById('chatMessages'),
            connectionStatus: document.getElementById('connectionStatus'),
            usersList: document.getElementById('usersList'),
            refreshUsersBtn: document.getElementById('refreshUsersBtn'),
            // Modal elements (created dynamically)
            welcomeModal: null,
            welcomeModalCheckbox: null,
            welcomeModalClose: null,
            chatTabs: document.getElementById('chatTabs'),
            // downloadHistoryBtn: document.getElementById('downloadHistoryBtn'), // removed
        };
    }
    
    bindEvents() {
        // Modal events
        this.elements.modalConnectBtn.addEventListener('click', () => this.connect());
        this.elements.modalCancelBtn.addEventListener('click', () => this.hideConnectionModal());
        this.elements.settingsBtn.addEventListener('click', () => this.showConnectionModal());
        
        // Connection events
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Settings auto-save
        this.elements.modalServerInput.addEventListener('input', () => this.saveSettings());
        this.elements.modalPortInput.addEventListener('input', () => this.saveSettings());
        this.elements.modalUsernameInput.addEventListener('input', () => this.saveSettings());
        
        // Use .w for refresh (was .Z)
        this.elements.refreshUsersBtn.addEventListener('click', () => this.sendCommand('.w'));
        
        this.elements.chatTabs.addEventListener('click', (e) => {
            const downloadIcon = e.target.closest('.tab-download');
            if (downloadIcon) {
                const tab = downloadIcon.closest('.chat-tab');
                if (tab) {
                    this.downloadTabHistory(tab.dataset.tab);
                }
                e.stopPropagation();
                return;
            }
            const closeIcon = e.target.closest('.tab-close');
            if (closeIcon) {
                const tab = closeIcon.closest('.chat-tab');
                if (tab && tab.dataset.tab !== 'main') {
                    this.closeTab(tab.dataset.tab);
                }
                e.stopPropagation();
                return;
            }
            const tab = e.target.closest('.chat-tab');
            if (tab) {
                this.switchTab(tab.dataset.tab);
            }
        });
        // this.elements.downloadHistoryBtn.addEventListener('click', () => { // removed
        //     this.downloadCurrentTabHistory(); // removed
        // }); // removed
    }
    
    loadSettings() {
        try {
            const settings = JSON.parse(localStorage.getItem('nakenChatSettings') || '{}');
            this.elements.modalServerInput.value = settings.server || 'localhost';
            this.elements.modalPortInput.value = settings.port || 6666;
            this.elements.modalUsernameInput.value = settings.username || '';
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }
    
    saveSettings() {
        try {
            const settings = {
                server: this.elements.modalServerInput.value,
                port: this.elements.modalPortInput.value,
                username: this.elements.modalUsernameInput.value
            };
            localStorage.setItem('nakenChatSettings', JSON.stringify(settings));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    
    showConnectionModal() {
        this.elements.connectionModal.classList.remove('hidden');
        // Focus on username field if it's empty, otherwise focus on server field
        if (!this.elements.modalUsernameInput.value.trim()) {
            this.elements.modalUsernameInput.focus();
        } else {
            this.elements.modalServerInput.focus();
        }
        
        // Add keyboard event listeners
        this.addModalKeyboardListeners();
        
        // Add click outside to close
        this.addModalClickOutsideListener();
    }
    
    addModalKeyboardListeners() {
        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.connect();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hideConnectionModal();
            }
        };
        
        // Add listeners to all modal inputs
        this.elements.modalServerInput.addEventListener('keydown', handleKeydown);
        this.elements.modalPortInput.addEventListener('keydown', handleKeydown);
        this.elements.modalUsernameInput.addEventListener('keydown', handleKeydown);
        
        // Store the handler for cleanup
        this.modalKeydownHandler = handleKeydown;
    }
    
    removeModalKeyboardListeners() {
        if (this.modalKeydownHandler) {
            this.elements.modalServerInput.removeEventListener('keydown', this.modalKeydownHandler);
            this.elements.modalPortInput.removeEventListener('keydown', this.modalKeydownHandler);
            this.elements.modalUsernameInput.removeEventListener('keydown', this.modalKeydownHandler);
            this.modalKeydownHandler = null;
        }
    }
    
    addModalClickOutsideListener() {
        const handleClickOutside = (e) => {
            if (e.target === this.elements.connectionModal) {
                this.hideConnectionModal();
            }
        };
        
        this.elements.connectionModal.addEventListener('click', handleClickOutside);
        this.modalClickOutsideHandler = handleClickOutside;
    }
    
    removeModalClickOutsideListener() {
        if (this.modalClickOutsideHandler) {
            this.elements.connectionModal.removeEventListener('click', this.modalClickOutsideHandler);
            this.modalClickOutsideHandler = null;
        }
    }
    
    hideConnectionModal() {
        this.elements.connectionModal.classList.add('hidden');
        this.removeModalKeyboardListeners();
        this.removeModalClickOutsideListener();
    }
    
    showToast(message, type = 'error') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast' + (type ? ' ' + type : '');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => container.removeChild(toast), 500);
        }, 2500);
    }

    async connect() {
        const server = this.elements.modalServerInput.value.trim();
        const port = parseInt(this.elements.modalPortInput.value);
        const username = this.elements.modalUsernameInput.value.trim();
        if (!server || !port || !username) {
            this.addMessage('Please fill in all connection details.', 'error');
            this.showToast('Please fill in all connection details.', 'error');
            return;
        }
        if (port < 1 || port > 65535) {
            this.addMessage('Port must be between 1 and 65535.', 'error');
            this.showToast('Port must be between 1 and 65535.', 'error');
            return;
        }
        this.server = server;
        this.port = port;
        this.username = username;
        try {
            this.updateConnectionStatus('Connecting...', 'connecting');
            this.elements.modalConnectBtn.disabled = true;
            localStorage.removeItem('nakenChatHistories');
            this.chatHistories = { main: [] };
            this.tabUsers = {};
            this.saveChatHistories();
            this.clearPrivateTabsAndHistories();
            const wsUrl = `ws://localhost:7666`;
            this.socket = new WebSocket(wsUrl);
            this.socket.onopen = () => {
                this.socket.send(JSON.stringify({
                    type: 'setTarget',
                    host: server,
                    port: port
                }));
                this.isConnected = true;
                this.updateConnectionStatus('Connected', 'connected');
                this.elements.modalConnectBtn.disabled = true;
                this.elements.disconnectBtn.disabled = false;
                this.elements.messageInput.disabled = false;
                this.elements.sendBtn.disabled = false;
                this.hideConnectionModal();
                this.addMessage(`Connected to ${server}:${port}`, 'success');
                this.sendCommand(`.n ${username}`);
                setTimeout(() => {
                    this.sendCommand('.w');
                }, 1000);
            };
            this.socket.onmessage = (event) => {
                // Split incoming data by newlines and process each line
                const lines = event.data.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    // Try to parse as JSON error
                    try {
                        const data = JSON.parse(trimmed);
                        if (data.type === 'error' && data.message) {
                            this.showToast(data.message, 'error');
                            this.handleDisconnect();
                            return;
                        }
                    } catch (e) {
                        // Not JSON, continue as normal
                    }
                    this.handleMessage(trimmed);
                }
            };
            this.socket.onclose = () => {
                this.handleDisconnect();
            };
            this.socket.onerror = (error) => {
                this.addMessage(`Connection error: ${error.message}`, 'error');
                this.showToast('Could not connect to server. Please check the address and try again.', 'error');
                this.handleDisconnect();
            };
        } catch (error) {
            this.addMessage(`Failed to connect: ${error.message}`, 'error');
            this.showToast('Could not connect to server. Please check the address and try again.', 'error');
            this.handleDisconnect();
        }
        this.hasShownWelcome = false;
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.close();
        }
        this.handleDisconnect();
        this.elements.modalConnectBtn.disabled = false;
        this.showConnectionModal();
    }
    
    handleDisconnect() {
        // Clear private tabs and histories on disconnect
        this.clearPrivateTabsAndHistories();
        this.isConnected = false;
        this.socket = null;
        this.users.clear();
        this.updateUsersList();
        
        this.updateConnectionStatus('Disconnected', 'disconnected');
        this.elements.modalConnectBtn.disabled = false;
        this.elements.disconnectBtn.disabled = true;
        this.elements.messageInput.disabled = true;
        this.elements.sendBtn.disabled = true;
        
        this.addMessage('Disconnected from server', 'system');
    }
    
    sendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message || !this.isConnected) return;

        this.elements.messageInput.value = '';

        // If in a private tab and not sending a command, send as private message
        if (this.activeTab.startsWith('pm_') && !message.startsWith('.')) {
            const tabUser = this.tabUsers[this.activeTab];
            if (tabUser && tabUser.number) {
                debugLog('📤 Sending private message from tab:', this.activeTab, 'to user:', tabUser);
                this.setLastPrivateSent(tabUser.number, tabUser.username, message);
                this.sendCommand(`.p ${tabUser.number} ${message}`);
                return;
            }
        }

        if (message.startsWith('.')) {
            // Check if this is a .p command and set lastPrivateSent accordingly
            const pMatch = message.match(/^\.p\s+(\d+)\s+([\s\S]+)/);
            if (pMatch) {
                const number = pMatch[1];
                const msg = pMatch[2];
                // Try to get username from tabUsers or users list
                let username = '';
                if (this.tabUsers[`pm_${number}`]) {
                    username = this.tabUsers[`pm_${number}`].username;
                } else if (this.users.has(number)) {
                    username = this.users.get(number).username;
                }
                this.setLastPrivateSent(number, username, msg);
            }
            debugLog('📤 Sending command:', message);
            this.sendCommand(message);
        } else {
            debugLog('📤 Sending regular message:', message);
            this.sendToServer(message);
        }
    }

    setLastPrivateSent(number, username, message) {
        this.lastPrivateSent = { number, username, message };
        if (this.lastPrivateSentTimeout) clearTimeout(this.lastPrivateSentTimeout);
        this.lastPrivateSentTimeout = setTimeout(() => {
            debugLog('Clearing lastPrivateSent due to timeout');
            this.lastPrivateSent = null;
        }, 10000); // 10 seconds
    }
    
    sendCommand(command) {
        if (!this.isConnected) return;
        
        debugLog('📤 Sending command to server:', command);
        
        // Special debugging for private messages
        if (command.startsWith('.p ')) {
            debugLog('📤 PRIVATE MESSAGE COMMAND DETECTED:', command);
            const parts = command.split(' ');
            if (parts.length >= 3) {
                debugLog('📤 Private message details - Number:', parts[1], 'Message:', parts.slice(2).join(' '));
            }
        }
        
        this.sendToServer(command);
        
        // Handle special commands locally
        const parts = command.split(' ');
        const cmd = parts[0].toLowerCase();
        
        switch (cmd) {
            case '.help':
                // Do not call this.showHelp() here; let the server trigger it
                break;
            case '.w':
            case '.f':
            case '.a':
                // These will be handled by server response
                break;
            case '.q':
                this.disconnect();
                break;
        }
    }
    
    sendToServer(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(data + '\n');
        }
    }
    
    handleMessage(data) {
        // Debug: log every incoming message
        debugLog('handleMessage received:', data);
        // Split incoming data by newlines and process each line
        const lines = data.toString().split('\n');
        let suppressing = !this.hasShownWelcome;
        for (let i = 0; i < lines.length; i++) {
            // Clean message: remove null chars and trim
            const message = lines[i];
            const cleanMsg = message.replace(/\0/g, '').trim();
            if (!cleanMsg) continue;
            debugLog('RECEIVED:', cleanMsg);
            
            // Enhanced debugging for private message detection
            if (cleanMsg.includes('private') || cleanMsg.includes('Message sent to') || 
                (cleanMsg.includes('>>') && cleanMsg.includes('[') && cleanMsg.includes(']')) ||
                cleanMsg.includes('>>')) {
                debugLog('🔍 POTENTIAL PRIVATE MESSAGE DETECTED:', cleanMsg);
                debugLog('🔍 Message contains "private":', cleanMsg.includes('private'));
                debugLog('🔍 Message contains "Message sent to":', cleanMsg.includes('Message sent to'));
                debugLog('🔍 Message contains ">>":', cleanMsg.includes('>>'));
                debugLog('🔍 Message contains "[" and "]":', cleanMsg.includes('[') && cleanMsg.includes(']'));
            }

            // --- SUPPRESS SERVER .HELP OUTPUT LOGIC ---
            if (cleanMsg === 'List of commands:') {
                this.suppressServerHelp = true;
                this.showHelp(); // Show your formatted block
                continue;
            }
            if (this.suppressServerHelp) {
                // End suppression on blank line, header, or normal chat message
                if (
                    !cleanMsg ||
                    cleanMsg.startsWith('Name') ||
                    cleanMsg.startsWith('[') ||
                    cleanMsg.startsWith('Total:') ||
                    /^\[\d+\]\S+:/.test(cleanMsg) // normal chat message
                ) {
                    this.suppressServerHelp = false;
                }
                if (this.suppressServerHelp) continue; // Only skip if still suppressing
            }
            // --- END SUPPRESS SERVER .HELP OUTPUT LOGIC ---

            if (suppressing) {
                this.collectingWelcome = true;
                this.welcomeBuffer.push(cleanMsg);
                if (/^>> You just logged on line \d+ from:/.test(cleanMsg)) {
                    this.showWelcomeModal(this.welcomeBuffer.join('\n'));
                    this.collectingWelcome = false;
                    this.hasShownWelcome = true;
                    this.welcomeBuffer = [];
                    suppressing = false;
                }
                continue; // Suppress all welcome lines from chat
            }

            // Detect join/leave/quit messages and refresh user list
            if (/has joined|has left|has quit|logged on line|logged off|disconnected/i.test(cleanMsg)) {
                setTimeout(() => this.sendCommand('.w'), 500);
            }

            // .w user list collection
            if (this.collectingUsers) {
                if (cleanMsg.startsWith('Total:')) {
                    this.userBuffer.push(cleanMsg.replace(/\r/g, ''));
                    // Debug: log before parsing user list
                    debugLog('Calling parseAndShowUserList with:', this.userBuffer);
                    this.parseAndShowUserList(this.userBuffer);
                    this.userBuffer = [];
                    this.collectingUsers = false;
                    continue; // Suppress 'Total: <#>' from chat
                } else {
                    this.userBuffer.push(cleanMsg.replace(/\r/g, ''));
                    continue; // Only suppress user list lines
                }
            }
            // Start .w user list collection on flexible header
            if (cleanMsg.startsWith('Name') && cleanMsg.includes('Channel') && cleanMsg.includes('Location')) {
                this.collectingUsers = true;
                this.userBuffer = [cleanMsg.replace(/\r/g, '')];
                continue;
            }

            // Suppress 'Total: <#>' lines from chat
            if (/^Total: \d+/.test(cleanMsg)) {
                continue;
            }

            // --- IMPROVED PRIVATE MESSAGE DETECTION ---
            // Handle private messages with better pattern matching for different server versions
            const privateMessageResult = this.handlePrivateMessage(cleanMsg);
            if (privateMessageResult.handled) {
                debugLog('Private message handled, skipping further processing');
                continue; // Message was handled as private, don't process further
            }

            // Only add to main chat if not a private message
            debugLog('Adding message to main chat:', cleanMsg);
            this.addMessage(cleanMsg, 'user');
        }
    }

    // New method to handle private message detection and routing
    handlePrivateMessage(cleanMsg) {
        debugLog(`Checking for private message patterns in: "${cleanMsg}"`);
        
        // Enhanced debugging - log all messages that might be private
        if (cleanMsg.includes('private') || cleanMsg.includes('Message sent to') || 
            (cleanMsg.includes('>>') && cleanMsg.includes('[') && cleanMsg.includes(']'))) {
            debugLog('POTENTIAL PRIVATE MESSAGE DETECTED:', cleanMsg);
        }
        
        // Pattern 1: Outgoing private message with full echo
        // >> Message sent to [1]bob: <0>Derrick (private): hi
        const privOutMatch = cleanMsg.match(/^>> Message sent to \[(\d+)\](.*?): <\d+>(.+?) \(private\): (.+)$/);
        
        // Pattern 2: Incoming private message
        // <1>bob (private): hello
        const privInMatch = cleanMsg.match(/^<(\d+)>(.*?) \(private\): (.+)$/);
        
        // Pattern 3: Short confirmation for outgoing message (no echo)
        // >> Message sent to [1]bob.
        const privSentShort = cleanMsg.match(/^>> Message sent to \[(\d+)\](.*)\.$/);
        
        // Pattern 4: Alternative incoming format (some server versions)
        // <1>bob: hello (private)
        const privInAltMatch = cleanMsg.match(/^<(\d+)>(.*?): (.+?) \(private\)$/);
        
        // Pattern 5: Another alternative format
        // [1]bob (private): hello
        const privInAlt2Match = cleanMsg.match(/^\[(\d+)\](.*?) \(private\): (.+)$/);
        
        // Pattern 6: Online server format - outgoing with different structure
        // >> Message sent to [1]username: message
        const privOutOnlineMatch = cleanMsg.match(/^>> Message sent to \[(\d+)\](.*?): (.+)$/);
        
        // Pattern 7: Online server format - incoming with different structure
        // >> [1]username: message (private)
        const privInOnlineMatch = cleanMsg.match(/^>> \[(\d+)\](.*?): (.+?) \(private\)$/);
        
        // Pattern 8: Another online server format
        // >> [1]username (private): message
        const privInOnline2Match = cleanMsg.match(/^>> \[(\d+)\](.*?) \(private\): (.+)$/);
        
        // Pattern 9: Simple confirmation format (with optional period)
        // >> Message sent to [1]username or >> Message sent to [1]username.
        const privSentSimple = cleanMsg.match(/^>> Message sent to \[(\d+)\](.*?)\.?$/);

        if (privOutMatch) {
            debugLog('Matched Pattern 1 (outgoing with echo):', privOutMatch);
            // Outgoing private message with full echo
            const number = privOutMatch[1];
            const username = privOutMatch[2].trim();
            const from = privOutMatch[3].trim();
            const message = privOutMatch[4];
            
            this.handleOutgoingPrivateMessage(number, username, from, message);
            return { handled: true };
        } else if (privInMatch) {
            debugLog('Matched Pattern 2 (incoming):', privInMatch);
            // Incoming private message
            const number = privInMatch[1];
            const username = privInMatch[2];
            const message = privInMatch[3];
            
            this.handleIncomingPrivateMessage(number, username, message);
            return { handled: true };
        } else if (privSentShort && this.lastPrivateSent && privSentShort[1] === String(this.lastPrivateSent.number)) {
            debugLog('Matched Pattern 3 (short confirmation):', privSentShort);
            // Short confirmation for outgoing message
            this.handleOutgoingPrivateConfirmation();
            return { handled: true };
        } else if (privInAltMatch) {
            debugLog('Matched Pattern 4 (alternative incoming):', privInAltMatch);
            // Alternative incoming format
            const number = privInAltMatch[1];
            const username = privInAltMatch[2];
            const message = privInAltMatch[3];
            
            this.handleIncomingPrivateMessage(number, username, message);
            return { handled: true };
        } else if (privInAlt2Match) {
            debugLog('Matched Pattern 5 (alternative format 2):', privInAlt2Match);
            // Another alternative incoming format
            const number = privInAlt2Match[1];
            const username = privInAlt2Match[2];
            const message = privInAlt2Match[3];
            
            this.handleIncomingPrivateMessage(number, username, message);
            return { handled: true };
        } else if (privOutOnlineMatch && this.lastPrivateSent && privOutOnlineMatch[1] === String(this.lastPrivateSent.number)) {
            debugLog('Matched Pattern 6 (online outgoing):', privOutOnlineMatch);
            // Online server outgoing format
            const number = privOutOnlineMatch[1];
            const username = privOutOnlineMatch[2].trim();
            const message = privOutOnlineMatch[3];
            
            this.handleOutgoingPrivateMessage(number, username, this.username, message);
            return { handled: true };
        } else if (privInOnlineMatch) {
            debugLog('Matched Pattern 7 (online incoming):', privInOnlineMatch);
            // Online server incoming format
            const number = privInOnlineMatch[1];
            const username = privInOnlineMatch[2];
            const message = privInOnlineMatch[3];
            
            this.handleIncomingPrivateMessage(number, username, message);
            return { handled: true };
        } else if (privInOnline2Match) {
            debugLog('Matched Pattern 8 (online incoming 2):', privInOnline2Match);
            // Another online server incoming format
            const number = privInOnline2Match[1];
            const username = privInOnline2Match[2];
            const message = privInOnline2Match[3];
            
            this.handleIncomingPrivateMessage(number, username, message);
            return { handled: true };
        } else if (privSentSimple) {
            debugLog('Pattern 9 (simple confirmation) matched:', privSentSimple);
            if (this.lastPrivateSent) {
                debugLog('lastPrivateSent:', this.lastPrivateSent);
                debugLog('privSentSimple[1] (number):', privSentSimple[1], 'lastPrivateSent.number:', this.lastPrivateSent.number);
                debugLog('String match:', privSentSimple[1] === String(this.lastPrivateSent.number));
            } else {
                debugLog('lastPrivateSent is null or undefined');
            }
            if (this.lastPrivateSent && privSentSimple[1] === String(this.lastPrivateSent.number)) {
                debugLog('Matched Pattern 9 (simple confirmation):', privSentSimple);
                // Simple confirmation for outgoing message (with or without period)
                this.handleOutgoingPrivateConfirmation();
                return { handled: true };
            }
        }

        debugLog('No private message patterns matched');
        return { handled: false };
    }

    // Handle outgoing private message with full echo
    handleOutgoingPrivateMessage(number, username, from, message) {
        try {
            const tabId = `pm_${number}`;
            debugLog(`Handling outgoing private message to ${username} (#${number}): ${message}`);
            
            // Create tab if it doesn't exist
            if (!this.chatHistories[tabId]) {
                debugLog(`Creating new chat history for tab: ${tabId}`);
                this.chatHistories[tabId] = [];
                this.tabUsers[tabId] = { number, username };
                this.createPrivateTab(tabId, number, username);
            }
            
            // Switch to the tab if it was just created
            const tabElement = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
            if (!tabElement) {
                debugLog(`Tab element not found, switching to: ${tabId}`);
                this.switchTab(tabId);
            }
            
            // Flash tab if not active
            if (this.activeTab !== tabId) {
                debugLog(`Flashing tab: ${tabId} (active: ${this.activeTab})`);
                this.flashTab(tabId);
            }
            
            // Add message to tab history
            const pillClass = from === this.username ? 'username username-primary' : 'username';
            const messageContent = `<span class='${pillClass}'>${from}</span> (you): ${message}`;
            this.chatHistories[tabId].push({ 
                content: messageContent, 
                type: 'user' 
            });
            this.saveChatHistories();
            
            // Display in active tab if it's the current tab
            if (tabId === this.activeTab) {
                debugLog(`Displaying message in active tab: ${tabId}`);
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message user';
                const timestamp = new Date().toLocaleTimeString();
                // Don't process content that's already been processed
                const displayContent = messageContent.includes('<span class=') ? messageContent : this.processMessageContent(messageContent);
                messageDiv.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="content">${displayContent}</span>
                `;
                this.elements.chatMessages.appendChild(messageDiv);
                this.scrollToBottom();
            }
        } catch (error) {
            console.error('Error handling outgoing private message:', error);
        }
    }

    // Handle incoming private message
    handleIncomingPrivateMessage(number, username, message) {
        try {
            const tabId = `pm_${number}`;
            debugLog(`Handling incoming private message from ${username} (#${number}): ${message}`);
            
            // Create tab if it doesn't exist
            if (!this.chatHistories[tabId]) {
                debugLog(`Creating new chat history for incoming message tab: ${tabId}`);
                this.chatHistories[tabId] = [];
                this.tabUsers[tabId] = { number, username };
                this.createPrivateTab(tabId, number, username);
            }
            
            // Switch to the tab if it was just created
            const tabElement = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
            if (!tabElement) {
                debugLog(`Tab element not found for incoming message, switching to: ${tabId}`);
                this.switchTab(tabId);
            }
            
            // Flash tab if not active
            if (this.activeTab !== tabId) {
                debugLog(`Flashing tab for incoming message: ${tabId} (active: ${this.activeTab})`);
                this.flashTab(tabId);
            }
            
            // Add message to tab history
            const pillClass = username === this.username ? 'username username-primary' : 'username';
            const messageContent = `<span class='${pillClass}'>${username}</span>: ${message}`;
            this.chatHistories[tabId].push({ 
                content: messageContent, 
                type: 'user' 
            });
            this.saveChatHistories();
            
            // Display in active tab if it's the current tab
            if (tabId === this.activeTab) {
                debugLog(`Displaying incoming message in active tab: ${tabId}`);
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message user';
                const timestamp = new Date().toLocaleTimeString();
                // Don't process content that's already been processed
                const displayContent = messageContent.includes('<span class=') ? messageContent : this.processMessageContent(messageContent);
                messageDiv.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="content">${displayContent}</span>
                `;
                this.elements.chatMessages.appendChild(messageDiv);
                this.scrollToBottom();
            }
        } catch (error) {
            console.error('Error handling incoming private message:', error);
        }
    }

    // Handle outgoing private message confirmation (short format)
    handleOutgoingPrivateConfirmation() {
        try {
            debugLog('handleOutgoingPrivateConfirmation called');
            if (!this.lastPrivateSent) {
                debugLog('No lastPrivateSent data available for confirmation');
                return;
            }
            if (this.lastPrivateSentTimeout) {
                clearTimeout(this.lastPrivateSentTimeout);
                this.lastPrivateSentTimeout = null;
            }
            debugLog('lastPrivateSent in confirmation handler:', this.lastPrivateSent);
            const tabId = `pm_${this.lastPrivateSent.number}`;
            debugLog(`Handling outgoing private confirmation for tab: ${tabId}`);
            
            // Create tab if it doesn't exist
            if (!this.chatHistories[tabId]) {
                debugLog(`Creating new chat history for confirmation tab: ${tabId}`);
                this.chatHistories[tabId] = [];
                this.tabUsers[tabId] = { 
                    number: this.lastPrivateSent.number, 
                    username: this.lastPrivateSent.username 
                };
                this.createPrivateTab(tabId, this.lastPrivateSent.number, this.lastPrivateSent.username);
                this.switchTab(tabId);
            }
            
            // Add your own message to the tab
            const messageContent = `<span class='username'>You</span> (you): ${this.lastPrivateSent.message}`;
            this.chatHistories[tabId].push({ 
                content: messageContent, 
                type: 'user' 
            });
            this.saveChatHistories();
            
            // Display in active tab if it's the current tab
            if (tabId === this.activeTab) {
                debugLog(`Displaying confirmation message in active tab: ${tabId}`);
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message user';
                const timestamp = new Date().toLocaleTimeString();
                // Don't process content that's already been processed
                const displayContent = messageContent.includes('<span class=') ? messageContent : this.processMessageContent(messageContent);
                messageDiv.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="content">${displayContent}</span>
                `;
                this.elements.chatMessages.appendChild(messageDiv);
                this.scrollToBottom();
            }
            
            debugLog(`Clearing lastPrivateSent for: ${this.lastPrivateSent.username} (#${this.lastPrivateSent.number})`);
            this.lastPrivateSent = null;
        } catch (error) {
            console.error('Error handling outgoing private confirmation:', error);
        }
    }
    
    handleSystemMessage(message) {
        this.addMessage(message, 'system');
    }
    
    handleGenericMessage(message) {
        const processedMessage = this.processMessageContent(message);
        this.addMessage(processedMessage, 'system');
    }
    
    handleHelpResponse(message) {
        const lines = message.split('\n');
        let helpText = '<div class="help-commands">';
        helpText += '<h4>Available Commands:</h4>';
        
        for (const line of lines) {
            if (line.trim() && !line.includes('List of commands:')) {
                helpText += `<div class="command-item">${this.processMessageContent(line)}</div>`;
            }
        }
        helpText += '</div>';
        
        this.addMessage(helpText, 'system');
    }
    
    handleUsersList(message) {
        // Parse the detailed users list from .w command
        const lines = message.split('\n');
        // Only clear users if this is a fresh .w response (contains header)
        if (message.includes('Name                       Channel        Idle Location')) {
            this.users.clear();
        }
        let foundUser = false;
        for (const line of lines) {
            // Match the user line format: [0]username  status  channel  location (idle may be missing)
            // Example: [0]localhost         ----- Main                localhost
            const match = line.match(/^\[(\d+)\](\S+)\s+([\-A-Z]+)\s+(\S+)\s+(.+)$/);
            if (match) {
                const [, number, username, status, channel, location] = match;
                this.users.set(number, {
                    username: username,
                    status: status,
                    channel: channel,
                    idle: '', // Not present in this output
                    location: location.trim()
                });
                foundUser = true;
            }
        }
        // Do not add a system message for total users
        // Remove simulated users if not in demo mode
        if (!foundUser && !this.demoMode) {
            this.users.clear();
        }
        this.updateUsersList();
    }

    parseAndShowUserList(lines) {
        debugLog('User list lines received:', lines);
        // Find the header line index
        const headerIdx = lines.findIndex(line => line.trim().startsWith('Name'));
        if (headerIdx === -1) {
            console.warn('User list header not found.');
            return;
        }
        let parsedUsers = new Map();
        for (let i = headerIdx + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('-') || line.startsWith('Total:')) continue;
            // Debug: log the line before parsing
            debugLog('Parsing user line:', line);
            // Robust regex for user line
            const match = line.match(/^\[(\d+)\](\S+)\s+([\-A-Za-z]+)\s+(\S+)\s+(?:(\d+[hm]?)\s+)?(.+)$/);
            debugLog('Regex match result:', match);
            if (match) {
                const [, number, username, status, channel, idle, location] = match;
                parsedUsers.set(number, {
                    username,
                    status,
                    channel,
                    idle: idle || '',
                    location: location.trim()
                });
            } else {
                console.warn('User line not parsed by regex:', line);
            }
        }
        if (parsedUsers.size > 0) {
            this.users.clear();
            for (const [number, userInfo] of parsedUsers.entries()) {
                this.users.set(number, userInfo);
            }
            debugLog('USERS PARSED:', Array.from(this.users.entries()));
            this.updateUsersList();
        } else {
            console.warn('No users parsed from .w output, not clearing user list.');
        }
    }

    parseAndShowZUserList(lines) {
        this.users.clear();
        for (const line of lines) {
            const match = line.match(/^\+\[(\d+)\](\S+)$/);
            if (match) {
                const [, number, username] = match;
                this.users.set(number, {
                    username: username,
                    status: '',
                    channel: '',
                    idle: '',
                    location: ''
                });
            }
        }
        debugLog('USERS PARSED:', Array.from(this.users.entries()));
        this.updateUsersList();
    }
    
    processMessageContent(content) {
        // If content already contains HTML spans, don't process it again
        if (content.includes('<span class=')) {
            debugLog('Content already contains HTML, skipping processing:', content.substring(0, 50) + '...');
            return content;
        }
        // If the message matches [number]username: message, only process the message part
        const chatMsgMatch = content.match(/^(\[(\d+)\])(\S+):([\s\S]*)$/);
        let prefix = '', msg = content;
        if (chatMsgMatch) {
            // Extract number and username
            const number = chatMsgMatch[2];
            const username = chatMsgMatch[3];
            const isPrimary = username === this.username;
            const numberBadgeClass = isPrimary ? 'user-number-badge user-number-badge-primary' : 'user-number-badge';
            const namePillClass = isPrimary ? 'user-name-pill user-name-pill-primary' : 'user-name-pill';
            prefix = `<span class=\"${numberBadgeClass}\">${number}</span><span class=\"${namePillClass}\">${username}</span>`;
            msg = chatMsgMatch[4];
            // Ensure a space after the username pill
            if (!/^\s/.test(msg)) {
                msg = ' ' + msg;
            }
        }
        msg = msg.trim(); // Trim leading/trailing spaces
        debugLog('Processing for emoji:', msg);

        // 1. Convert text emojis to Unicode emojis (before linkifying URLs)
        const emojiMap = this.emojiMap;
        // Sort emoji keys by length (longest first) to avoid partial matches
        const emojiKeys = Object.keys(emojiMap).sort((a, b) => b.length - a.length);
        // Build a global regex to match any emoji code
        const emojiPattern = new RegExp(emojiKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
        msg = msg.replace(emojiPattern, (match, offset, string) => {
            // Check boundaries: only replace if not part of a word or URL
            const before = string[offset - 1];
            const after = string[offset + match.length];
            const boundary = (ch) => !ch || /[\s.,!?;:()\[\]{}<>"']/.test(ch);
            if (boundary(before) && boundary(after)) {
                return emojiMap[match];
            }
            return match;
        });

        // 2. Hyperlink URLs (after emoji replacement)
        const urlRegex = /\b(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[\w\-./?%&=]*)?)/g;
        msg = msg.replace(urlRegex, (url) => {
            let href = url;
            if (!href.match(/^https?:\/\//)) {
                href = 'http://' + href;
            }
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });

        return prefix + msg;
    }
    
    addMessage(content, type = 'system', scroll = true) {
        // Suppress help output from being added to the chat
        if (typeof content === 'string' && content.includes('List of commands:')) {
            return;
        }
        // Add to main tab (private messages are handled separately)
        const tabId = 'main';
        if (!this.chatHistories[tabId]) this.chatHistories[tabId] = [];
        this.chatHistories[tabId].push({ content, type });
        this.saveChatHistories();
        // Flash main chat tab if not active
        if (tabId !== this.activeTab) {
            const mainTab = this.elements.chatTabs.querySelector('[data-tab="main"]');
            if (mainTab) mainTab.classList.add('flashing');
        }
        // Only render if this is the active tab
        if (tabId === this.activeTab) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${type}`;
            const timestamp = new Date().toLocaleTimeString();
            const processedContent = this.processMessageContent(content);
            messageDiv.innerHTML = `
                <span class="timestamp">[${timestamp}]</span>
                <span class="content">${processedContent}</span>
            `;
            this.elements.chatMessages.appendChild(messageDiv);
            if (scroll !== false) this.scrollToBottom();
        }
    }
    
    updateConnectionStatus(status, type) {
        this.elements.connectionStatus.textContent = status;
        this.elements.connectionStatus.className = `connection-status ${type}`;
    }
    
    updateUsersList() {
        debugLog('UPDATE SIDEBAR:', Array.from(this.users.entries()));
        const usersList = this.elements.usersList;
        usersList.innerHTML = '';
        
        if (this.users.size === 0) {
            usersList.innerHTML = '<div class="no-users">No users online</div>';
            // For demo/testing: simulate .w output if no users after connecting and in demo mode
            if (this.isConnected && this.demoMode) {
                this.simulateUserList();
            }
            return;
        }
        
        // Sort users by number
        const sortedUsers = Array.from(this.users.entries()).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
        
        for (const [number, userInfo] of sortedUsers) {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-item';
            
            // Determine status color
            let statusClass = 'status-normal';
            if (userInfo.status.includes('E')) statusClass = 'status-echo';
            if (userInfo.status.includes('A')) statusClass = 'status-admin';

            // Determine if this is the current user
            const isPrimary = userInfo.username === this.username;
            const numberBadgeClass = isPrimary ? 'user-number-badge user-number-badge-primary' : 'user-number-badge';
            const namePillClass = isPrimary ? 'user-name-pill user-name-pill-primary' : 'user-name-pill';

            userDiv.innerHTML = `
                <div class="user-header">
                    <span class="${numberBadgeClass}">${number}</span>
                    <span class="${namePillClass}">${userInfo.username}</span>
                    <span class="user-status ${statusClass}">${userInfo.status}</span>
                </div>
                <div class="user-details">
                    <span class="user-channel">${userInfo.channel}</span>
                    <span class="user-idle">${userInfo.idle}</span>
                </div>
                <div class="user-location">${userInfo.location}</div>
            `;
            
            // Prevent private messaging yourself
            if (!isPrimary) {
                userDiv.addEventListener('click', () => {
                    this.elements.messageInput.value = `.p ${number} `;
                    this.elements.messageInput.focus();
                });
            } else {
                userDiv.title = "You cannot private message yourself.";
                userDiv.style.opacity = 0.7;
                userDiv.style.cursor = "not-allowed";
            }
            
            usersList.appendChild(userDiv);
        }
        // Update user count in sidebar header
        const userCountSpan = document.getElementById('userCount');
        if (userCountSpan) {
            userCountSpan.textContent = this.users.size;
        }
    }
    
    refreshUsers() {
        if (this.isConnected) {
            this.sendCommand('.w');
        }
    }
    
    showHelp() {
        const helpText = `
            <div class="help-commands">
                <h4>Available Commands:</h4>
                <div class="command-item">.n &lt;name&gt; - Set your username</div>
                <div class="command-item">.b, .hi, .e - Private beeps/hilite/echo</div>
                <div class="command-item">.w, .f, .a - List users/channels</div>
                <div class="command-item">.i &lt;number&gt; - List user info</div>
                <div class="command-item">.d - 10 minute timestamping</div>
                <div class="command-item">.p &lt;number&gt; - Send private message</div>
                <div class="command-item">.t, .u, .v - Chat server info</div>
                <div class="command-item">.g, .s &lt;number&gt; - Gag/channel squelch users</div>
                <div class="command-item">.q - Quit chat</div>
                <div class="command-item">%, .e &lt;char&gt; - Emote message/change emote char</div>
                <div class="command-item">.l - Lock a channel</div>
                <div class="command-item">.k &lt;number&gt; - Kick user</div>
                <div class="command-item">.o &lt;number&gt; - Give channel ownership</div>
                <div class="command-item">.c &lt;channel&gt; - Change channels</div>
                <div class="command-item">.y - Cross channel yell</div>
                <div class="command-item">.hu, .m - Hush yelling/messages</div>
            </div>
        `;
        this.addMessage(helpText, 'system');
    }
    
    scrollToBottom() {
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    simulateUserList() {
        // Simulate a .w output for testing/demo
        const fakeWOutput = `Name                       Channel        Idle Location\n[0]Derrick            ----E Main             1m localhost\n[1]mike               ----- Main             3s Mac.mikekohn.net\n[2]indrek             ----E Main            50m gateway.mare.ee\n[3]joe                ----E Main             9h ppp-70-129-57-233.ds\n--------------------------------------------------------\nTotal: 4`;
        this.handleUsersList(fakeWOutput);
    }

    isWelcomeMessage(message) {
        // Detects the welcome message block from the server
        // Looks for the banner and the '>> You just logged on line ...' line
        return (
            message.includes("Welcome to Michael Kohn's Naken Chat Server!") &&
            message.match(/>> You just logged on line \d+ from:/)
        );
    }

    showWelcomeModal(message) {
        // Only show if not disabled by user
        if (localStorage.getItem('nakenHideWelcome') === '1') return;

        // Remove any mention of 'Naken Chat' from the message
        let cleanMsg = message.replace(/Naken Chat/gi, '');

        // Extract the banner up to the '>> You just logged on line ...' line
        const match = cleanMsg.match(/([\s\S]*?)(>> You just logged on line \d+ from:.*)/);
        let banner = cleanMsg;
        if (match) {
            banner = match[1] + match[2];
        }

        // Create modal if not already present
        if (!document.getElementById('welcomeModal')) {
            const modal = document.createElement('div');
            modal.id = 'welcomeModal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(10,20,40,0.85)';
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            modal.style.zIndex = '9999';

            modal.innerHTML = `
                <div style="background: #1a1a2e; color: #e8e8e8; border-radius: 16px; padding: 32px 32px 16px 32px; max-width: 700px; min-width: 500px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); position: relative;">
                    <div style="white-space: pre-line; font-family: 'Fira Mono', 'Consolas', monospace; font-size: 1rem; margin-bottom: 18px;">${banner.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    <label style="display: flex; align-items: center; font-size: 0.95rem; margin-bottom: 12px;">
                        <input type="checkbox" id="welcomeModalCheckbox" style="margin-right: 8px;"> Do not show again
                    </label>
                    <button id="welcomeModalClose" style="background: linear-gradient(45deg, #64b5f6, #42a5f5); color: white; border: none; border-radius: 8px; padding: 10px 24px; font-size: 1rem; cursor: pointer;">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
            this.elements.welcomeModal = modal;
            this.elements.welcomeModalCheckbox = document.getElementById('welcomeModalCheckbox');
            this.elements.welcomeModalClose = document.getElementById('welcomeModalClose');

            this.elements.welcomeModalClose.onclick = () => {
                if (this.elements.welcomeModalCheckbox.checked) {
                    localStorage.setItem('nakenHideWelcome', '1');
                }
                modal.remove();
            };
        }
    }

    checkWelcomePreference() {
        // If user has set to hide the welcome, do nothing (modal will not show)
        // This is called on load to ensure the preference is respected
        if (localStorage.getItem('nakenHideWelcome') === '1') {
            // Optionally, you could show a small info message here
        }
    }

    isHelpMessage(message) {
        // Detects the .help output from the server
        return message.includes('List of commands:') && message.includes('.n <name>');
    }

    isHelpStart(message) {
        // Detects the start of the .help output from the server
        return message.includes('List of commands:');
    }

    switchTab(tabId) {
        try {
            debugLog(`Switching to tab: ${tabId} (current active: ${this.activeTab})`);
            
            // Don't switch if already on this tab
            if (this.activeTab === tabId) {
                debugLog(`Already on tab: ${tabId}, skipping switch`);
                return;
            }
            
            this.activeTab = tabId;
            
            // Remove active/flashing from all tabs
            Array.from(this.elements.chatTabs.children).forEach(tab => {
                tab.classList.remove('active', 'flashing');
            });
            
            // Set active on the selected tab
            const activeTabEl = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
            if (activeTabEl) {
                activeTabEl.classList.add('active');
                // Remove flashing if switching to main
                if (tabId === 'main') activeTabEl.classList.remove('flashing');
                debugLog(`Activated tab: ${tabId}`);
            } else {
                console.warn(`Tab element not found for: ${tabId}`);
                // If tab doesn't exist, create it (for main tab)
                if (tabId === 'main') {
                    this.ensureMainTabExists();
                }
            }
            
            // Render chat history for this tab
            this.renderChatHistory(tabId);
        } catch (error) {
            console.error('Error switching tab:', error);
        }
    }

    // Ensure main tab exists
    ensureMainTabExists() {
        const mainTab = this.elements.chatTabs.querySelector('[data-tab="main"]');
        if (!mainTab) {
            debugLog('Creating main tab');
            const newMainTab = document.createElement('div');
            newMainTab.className = 'chat-tab active';
            newMainTab.dataset.tab = 'main';
            newMainTab.innerHTML = 'Main Chat <span class="tab-download" title="Download chat history" style="display:inline-block;vertical-align:middle;cursor:pointer;">&#128190;</span>';
            this.elements.chatTabs.appendChild(newMainTab);
        }
    }

    renderChatHistory(tabId) {
        try {
            const messages = this.chatHistories[tabId] || [];
            debugLog(`Rendering chat history for tab: ${tabId}, messages: ${messages.length}`);
            this.elements.chatMessages.innerHTML = '';
            
            for (const { content, type } of messages) {
                // Directly render message DOM, do not call addMessage
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${type}`;
                const timestamp = new Date().toLocaleTimeString();
                
                // Don't process content that's already been processed (contains HTML)
                let displayContent = content;
                if (!content.includes('<span class=')) {
                    displayContent = this.processMessageContent(content);
                } else {
                    debugLog('Skipping processing for already processed content in renderChatHistory');
                }
                
                messageDiv.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="content">${displayContent}</span>
                `;
                this.elements.chatMessages.appendChild(messageDiv);
            }
            this.scrollToBottom();
            debugLog(`Finished rendering ${messages.length} messages for tab: ${tabId}`);
        } catch (error) {
            console.error('Error rendering chat history:', error);
        }
    }

    createPrivateTab(tabId, number, username) {
        try {
            // Remove if already exists (avoid duplicates)
            const existing = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
            if (existing) {
                debugLog(`Tab ${tabId} already exists, skipping creation`);
                return;
            }
            
            const tab = document.createElement('div');
            tab.className = 'chat-tab';
            tab.dataset.tab = tabId;
            // Truncate username if too long
            const maxNameLen = 12;
            let displayName = username;
            if (username.length > maxNameLen) {
                displayName = username.slice(0, maxNameLen - 1) + '…';
            }
            const tabTitle = `#${number} ${username}`;
            tab.innerHTML = `<span class=\"tab-close\" title=\"Close tab\" style=\"margin-right:8px;cursor:pointer;font-size:1.2em;\">&times;</span><span class=\"chat-tab-label\">#${number} ${displayName}</span> <span class=\"tab-download\" title=\"Download chat history\" style=\"display:inline-block;vertical-align:middle;cursor:pointer;\">&#128190;</span>`;
            tab.title = tabTitle;
            this.elements.chatTabs.appendChild(tab);
            
            debugLog(`Created private tab: ${tabId} for user #${number} ${username}`);
        } catch (error) {
            console.error('Error creating private tab:', error);
        }
    }

    flashTab(tabId) {
        const tab = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
        if (tab) {
            tab.classList.add('flashing');
        }
    }

    saveChatHistories() {
        try {
            localStorage.setItem('nakenChatHistories', JSON.stringify(this.chatHistories));
        } catch (e) {
            // ignore
        }
    }

    loadChatHistories() {
        try {
            const data = localStorage.getItem('nakenChatHistories');
            if (data) {
                this.chatHistories = JSON.parse(data);
            }
        } catch (e) {
            // ignore
        }
    }

    // Download for any tab
    downloadTabHistory(tabId) {
        const messages = this.chatHistories[tabId] || [];
        let text = '';
        // Helper to strip HTML tags
        function stripHtml(html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            return tmp.textContent || tmp.innerText || '';
        }
        for (const { content, type } of messages) {
            text += `[${type}] ${stripHtml(content)}\n`;
        }
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tabId}-chat-history.txt`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    closeTab(tabId) {
        // Remove tab DOM
        const tab = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
        if (tab) tab.remove();
        // Remove chat history and tab user
        delete this.chatHistories[tabId];
        delete this.tabUsers[tabId];
        this.saveChatHistories();
        // If closed tab was active, switch to main
        if (this.activeTab === tabId) {
            this.switchTab('main');
        }
    }

    clearPrivateTabsAndHistories() {
        debugLog('Clearing private tabs and histories');
        
        // Remove all private tab DOM elements
        Array.from(this.elements.chatTabs.children).forEach(tab => {
            if (tab.dataset.tab && tab.dataset.tab.startsWith('pm_')) {
                debugLog(`Removing private tab: ${tab.dataset.tab}`);
                tab.remove();
            }
        });
        
        // Remove all private chat histories and tab users
        for (const key of Object.keys(this.chatHistories)) {
            if (key.startsWith('pm_')) {
                debugLog(`Removing chat history: ${key}`);
                delete this.chatHistories[key];
            }
        }
        for (const key of Object.keys(this.tabUsers)) {
            if (key.startsWith('pm_')) {
                debugLog(`Removing tab user: ${key}`);
                delete this.tabUsers[key];
            }
        }
        this.saveChatHistories();
        
        // Ensure Main Chat tab exists
        if (!this.elements.chatTabs.querySelector('[data-tab="main"]')) {
            const mainTab = document.createElement('div');
            mainTab.className = 'chat-tab active';
            mainTab.dataset.tab = 'main';
            mainTab.innerHTML = 'Main Chat <span class="tab-download" title="Download chat history" style="display:inline-block;vertical-align:middle;cursor:pointer;">&#128190;</span>';
            this.elements.chatTabs.appendChild(mainTab);
        }
        
        // Only switch to main tab if we're currently on a private tab
        if (this.activeTab && this.activeTab.startsWith('pm_')) {
            debugLog(`Switching from private tab ${this.activeTab} to main`);
            this.switchTab('main');
        }
        if (this.lastPrivateSentTimeout) {
            clearTimeout(this.lastPrivateSentTimeout);
            this.lastPrivateSentTimeout = null;
        }
        this.lastPrivateSent = null;
    }
}

// Initialize the chat client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatClient = new NakenChatClient();
});

// Add some CSS for help commands
const style = document.createElement('style');
style.textContent = `
    .help-commands {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 16px;
        margin: 8px 0;
    }
    
    .help-commands h4 {
        color: #64b5f6;
        margin-bottom: 12px;
        font-size: 1.1rem;
    }
    
    .command-item {
        padding: 4px 0;
        color: #e8e8e8;
        font-family: 'Courier New', monospace;
        font-size: 0.9rem;
    }
    
    .command-item:hover {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        padding-left: 8px;
    }
`;
document.head.appendChild(style); 