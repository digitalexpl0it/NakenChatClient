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
        
        this.emojiMap = {
            ':D': '😀', ':P': '😛', ':)': '🙂', ':(': '😞', ';)': '😉',
            ':O': '😮', ':o': '😮', ':|': '😐', ':/': '😕', ':\\': '😕',
            '8)': '😎', '8-)': '😎', 'B)': '😎', 'B-)': '😎',
            '<3': '❤️', '</3': '💔', ':heart:': '❤️',
            ':smile:': '😊', ':sad:': '😢', ':wink:': '😉',
            ':lol:': '😂', ':rofl:': '🤣', ':cool:': '😎',
            ':thumbsup:': '👍', ':thumbsdown:': '👎',
            ':wave:': '👋', ':clap:': '👏', ':pray:': '🙏'
        };
        
        this.initializeElements();
        this.bindEvents();
        this.loadSettings();
        this.checkWelcomePreference();
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
    }
    
    initializeElements() {
        this.elements = {
            serverInput: document.getElementById('serverInput'),
            portInput: document.getElementById('portInput'),
            usernameInput: document.getElementById('usernameInput'),
            connectBtn: document.getElementById('connectBtn'),
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
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        // Use .w for refresh (was .Z)
        this.elements.refreshUsersBtn.addEventListener('click', () => this.sendCommand('.w'));
        this.elements.serverInput.addEventListener('input', () => this.saveSettings());
        this.elements.portInput.addEventListener('input', () => this.saveSettings());
        this.elements.usernameInput.addEventListener('input', () => this.saveSettings());
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
            this.elements.serverInput.value = settings.server || 'localhost';
            this.elements.portInput.value = settings.port || 6666;
            this.elements.usernameInput.value = settings.username || '';
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }
    
    saveSettings() {
        try {
            const settings = {
                server: this.elements.serverInput.value,
                port: this.elements.portInput.value,
                username: this.elements.usernameInput.value
            };
            localStorage.setItem('nakenChatSettings', JSON.stringify(settings));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    
    async connect() {
        const server = this.elements.serverInput.value.trim();
        const port = parseInt(this.elements.portInput.value);
        const username = this.elements.usernameInput.value.trim();
        
        if (!server || !port || !username) {
            this.addMessage('Please fill in all connection details.', 'error');
            return;
        }
        
        if (port < 1 || port > 65535) {
            this.addMessage('Port must be between 1 and 65535.', 'error');
            return;
        }
        
        this.server = server;
        this.port = port;
        this.username = username;
        
        try {
            this.updateConnectionStatus('Connecting...', 'connecting');
            this.elements.connectBtn.disabled = true;
            
            // Force clear all chat histories and tabUsers from localStorage on new connect
            localStorage.removeItem('nakenChatHistories');
            this.chatHistories = { main: [] };
            this.tabUsers = {};
            this.saveChatHistories();
            // Clear private tabs and histories on new connect
            this.clearPrivateTabsAndHistories();

            // Create WebSocket connection to the local proxy server
            const wsUrl = `ws://localhost:7666`;
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = () => {
                // Send setTarget message with desired telnet host/port
                this.socket.send(JSON.stringify({
                    type: 'setTarget',
                    host: server,
                    port: port
                }));

                this.isConnected = true;
                this.updateConnectionStatus('Connected', 'connected');
                this.elements.connectBtn.disabled = true;
                this.elements.disconnectBtn.disabled = false;
                this.elements.messageInput.disabled = false;
                this.elements.sendBtn.disabled = false;
                
                this.addMessage(`Connected to ${server}:${port}`, 'success');
                
                // Send username command
                this.sendCommand(`.n ${username}`);
                
                // Get user list after a short delay
                setTimeout(() => {
                    this.sendCommand('.w');
                }, 1000);
            };
            
            this.socket.onmessage = (event) => {
                // Split incoming data by newlines and process each line
                const lines = event.data.split('\n');
                for (const line of lines) {
                    if (line.trim() !== '') {
                        this.handleMessage(line);
                    }
                }
            };
            
            this.socket.onclose = () => {
                this.handleDisconnect();
            };
            
            this.socket.onerror = (error) => {
                this.addMessage(`Connection error: ${error.message}`, 'error');
                this.handleDisconnect();
            };
            
        } catch (error) {
            this.addMessage(`Failed to connect: ${error.message}`, 'error');
            this.handleDisconnect();
        }
        this.hasShownWelcome = false;
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.close();
        }
        this.handleDisconnect();
    }
    
    handleDisconnect() {
        // Clear private tabs and histories on disconnect
        this.clearPrivateTabsAndHistories();
        this.isConnected = false;
        this.socket = null;
        this.users.clear();
        this.updateUsersList();
        
        this.updateConnectionStatus('Disconnected', 'disconnected');
        this.elements.connectBtn.disabled = false;
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
                this.lastPrivateSent = { number: tabUser.number, username: tabUser.username, message };
                this.sendCommand(`.p ${tabUser.number} ${message}`);
                return;
            }
        }

        if (message.startsWith('.')) {
            this.sendCommand(message);
        } else {
            this.sendToServer(message);
        }
    }
    
    sendCommand(command) {
        if (!this.isConnected) return;
        
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
        console.log('handleMessage received:', data);
        // Split incoming data by newlines and process each line
        const lines = data.toString().split('\n');
        let suppressing = !this.hasShownWelcome;
        for (let i = 0; i < lines.length; i++) {
            // Clean message: remove null chars and trim
            const message = lines[i];
            const cleanMsg = message.replace(/\0/g, '').trim();
            if (!cleanMsg) continue;
            console.log('RECEIVED:', cleanMsg);

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
                    console.log('Calling parseAndShowUserList with:', this.userBuffer);
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

            // --- NEW: Detect private message patterns and pass special type ---
            const privOutMatch = cleanMsg.match(/^>> Message sent to \[(\d+)\](.*?): <\d+>(.+?) \(private\): (.+)$/);
            const privInMatch = cleanMsg.match(/^<(\d+)>(.*?) \(private\): (.+)$/);
            // Patch: Support for short confirmation (no echo)
            const privSentShort = cleanMsg.match(/^>> Message sent to \[(\d+)\](.*)\.$/);
            if (privOutMatch || privInMatch) {
                this.addMessage(cleanMsg, 'private');
                return;
            } else if (privSentShort && this.lastPrivateSent && privSentShort[1] === String(this.lastPrivateSent.number)) {
                // Create or activate the private tab
                const tabId = `pm_${this.lastPrivateSent.number}`;
                if (!this.chatHistories[tabId]) {
                    this.chatHistories[tabId] = [];
                    this.tabUsers[tabId] = { number: this.lastPrivateSent.number, username: this.lastPrivateSent.username };
                    this.createPrivateTab(tabId, this.lastPrivateSent.number, this.lastPrivateSent.username);
                    this.switchTab(tabId);
                }
                // Add your own message to the tab
                this.chatHistories[tabId].push({ content: `<span class='username'>You</span> (you): ${this.lastPrivateSent.message}`, type: 'user' });
                this.saveChatHistories();
                if (tabId === this.activeTab) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = `message user`;
                    const timestamp = new Date().toLocaleTimeString();
                    const processedContent = this.processMessageContent(`<span class='username'>You</span> (you): ${this.lastPrivateSent.message}`);
                    messageDiv.innerHTML = `
                        <span class="timestamp">[${timestamp}]</span>
                        <span class="content">${processedContent}</span>
                    `;
                    this.elements.chatMessages.appendChild(messageDiv);
                    this.scrollToBottom();
                }
                this.lastPrivateSent = null;
                return;
            }
            // --- END NEW ---

            // Always show all lines in the chat window
            this.addMessage(cleanMsg, 'user');
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
        console.log('User list lines received:', lines);
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
            console.log('Parsing user line:', line);
            // Robust regex for user line
            const match = line.match(/^\[(\d+)\](\S+)\s+([\-A-Za-z]+)\s+(\S+)\s+(?:(\d+[hm]?)\s+)?(.+)$/);
            console.log('Regex match result:', match);
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
            console.log('USERS PARSED:', Array.from(this.users.entries()));
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
        console.log('USERS PARSED:', Array.from(this.users.entries()));
        this.updateUsersList();
    }
    
    processMessageContent(content) {
        // If the message matches [number]username: message, only process the message part
        const chatMsgMatch = content.match(/^\[(\d+)\](\S+):([\s\S]*)$/);
        let prefix = '', msg = content;
        if (chatMsgMatch) {
            // Determine if this is the current user
            const username = chatMsgMatch[2];
            const isPrimary = username === this.username;
            const pillClass = isPrimary ? 'username username-primary' : 'username';
            prefix = `<span class="${pillClass}">[${chatMsgMatch[1]}]${username}</span>`;
            msg = chatMsgMatch[3];
            // Ensure a space after the username pill
            if (!/^\s/.test(msg)) {
                msg = ' ' + msg;
            }
        }
        msg = msg.trim(); // Trim leading/trailing spaces
        // Debug: log the message part being processed for emojis
        console.log('Processing for emoji:', msg);

        // 1. Convert text emojis to Unicode emojis (before linkifying URLs)
        const emojiMap = this.emojiMap || {
            ':D': '😀', ':P': '😛', ':)': '🙂', ':(': '😞', ';)': '😉',
            ':O': '😮', ':o': '😮', ':|': '😐', ':/': '😕', ':\\': '😕',
            '8)': '😎', '8-)': '😎', 'B)': '😎', 'B-)': '😎',
            '<3': '❤️', '</3': '💔', ':heart:': '❤️',
            ':smile:': '😊', ':sad:': '😢', ':wink:': '😉',
            ':lol:': '😂', ':rofl:': '🤣', ':cool:': '😎',
            ':thumbsup:': '👍', ':thumbsdown:': '👎',
            ':wave:': '👋', ':clap:': '👏', ':pray:': '🙏'
        };
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
        // Always check for private message patterns
        let tabId = 'main';
        // Outgoing private message: [1]Bob: (allow any username, non-greedy)
        const privMatch = content.match(/^>> Message sent to \[(\d+)\](.*?): <\d+>(.+?) \(private\): (.+)$/);
        // Incoming private message: <1>Bob (private): ... (allow any username, non-greedy)
        const privInMatch = content.match(/^<(\d+)>(.*?) \(private\): (.+)$/);
        if (privMatch) {
            const number = privMatch[1];
            const username = privMatch[2].trim();
            const from = privMatch[3].trim(); // your username
            const message = privMatch[4];
            tabId = `pm_${number}`;
            let created = false;
            if (!this.chatHistories[tabId]) {
                this.chatHistories[tabId] = [];
                this.tabUsers[tabId] = { number, username };
                this.createPrivateTab(tabId, number, username);
                created = true;
            }
            if (created) {
                this.switchTab(tabId);
            }
            if (this.activeTab !== tabId) {
                this.flashTab(tabId);
            }
            // Show your own message in the private tab
            const pillClass = from === this.username ? 'username username-primary' : 'username';
            this.chatHistories[tabId].push({ content: `<span class='${pillClass}'>${from}</span> (you): ${message}`, type: 'user' });
            this.saveChatHistories();
            if (tabId === this.activeTab) {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message user`;
                const timestamp = new Date().toLocaleTimeString();
                const processedContent = this.processMessageContent(`<span class='${pillClass}'>${from}</span> (you): ${message}`);
                messageDiv.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="content">${processedContent}</span>
                `;
                this.elements.chatMessages.appendChild(messageDiv);
                if (scroll !== false) this.scrollToBottom();
            }
            return;
        } else if (privInMatch) {
            const number = privInMatch[1];
            const username = privInMatch[2];
            const message = privInMatch[3];
            tabId = `pm_${number}`;
            let created = false;
            if (!this.chatHistories[tabId]) {
                this.chatHistories[tabId] = [];
                this.tabUsers[tabId] = { number, username };
                this.createPrivateTab(tabId, number, username);
                created = true;
            }
            if (created) {
                this.switchTab(tabId);
            }
            if (this.activeTab !== tabId) {
                this.flashTab(tabId);
            }
            // Show incoming message in the private tab
            const pillClass = username === this.username ? 'username username-primary' : 'username';
            this.chatHistories[tabId].push({ content: `<span class='${pillClass}'>${username}</span>: ${message}`, type: 'user' });
            this.saveChatHistories();
            if (tabId === this.activeTab) {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message user`;
                const timestamp = new Date().toLocaleTimeString();
                const processedContent = this.processMessageContent(`<span class='${pillClass}'>${username}</span>: ${message}`);
                messageDiv.innerHTML = `
                    <span class="timestamp">[${timestamp}]</span>
                    <span class="content">${processedContent}</span>
                `;
                this.elements.chatMessages.appendChild(messageDiv);
                if (scroll !== false) this.scrollToBottom();
            }
            return;
        }
        // Fallback: Add to main tab
        if (!this.chatHistories[tabId]) this.chatHistories[tabId] = [];
        this.chatHistories[tabId].push({ content, type });
        this.saveChatHistories();
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
        console.log('UPDATE SIDEBAR:', Array.from(this.users.entries()));
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
            
            userDiv.innerHTML = `
                <div class="user-header">
                    <span class="user-number">[${number}]</span>
                    <span class="user-name">${userInfo.username}</span>
                    <span class="user-status ${statusClass}">${userInfo.status}</span>
                </div>
                <div class="user-details">
                    <span class="user-channel">${userInfo.channel}</span>
                    <span class="user-idle">${userInfo.idle}</span>
                </div>
                <div class="user-location">${userInfo.location}</div>
            `;
            
            userDiv.addEventListener('click', () => {
                this.elements.messageInput.value = `.p ${number} `;
                this.elements.messageInput.focus();
            });
            
            usersList.appendChild(userDiv);
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

        // Remove any mention of 'telnet' from the message
        let cleanMsg = message.replace(/telnet/gi, '');

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
        this.activeTab = tabId;
        // Remove active/flashing from all tabs
        Array.from(this.elements.chatTabs.children).forEach(tab => {
            tab.classList.remove('active', 'flashing');
        });
        // Set active on the selected tab
        const activeTabEl = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
        if (activeTabEl) activeTabEl.classList.add('active');
        // Render chat history for this tab
        this.renderChatHistory(tabId);
    }

    renderChatHistory(tabId) {
        const messages = this.chatHistories[tabId] || [];
        this.elements.chatMessages.innerHTML = '';
        for (const { content, type } of messages) {
            // Directly render message DOM, do not call addMessage
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${type}`;
            const timestamp = new Date().toLocaleTimeString();
            const processedContent = this.processMessageContent(content);
            messageDiv.innerHTML = `
                <span class="timestamp">[${timestamp}]</span>
                <span class="content">${processedContent}</span>
            `;
            this.elements.chatMessages.appendChild(messageDiv);
        }
        this.scrollToBottom();
    }

    createPrivateTab(tabId, number, username) {
        // Remove if already exists (avoid duplicates)
        const existing = this.elements.chatTabs.querySelector(`[data-tab="${tabId}"]`);
        if (existing) return;
        const tab = document.createElement('div');
        tab.className = 'chat-tab';
        tab.dataset.tab = tabId;
        tab.innerHTML = `#${number} ${username} <span class="tab-download" title="Download chat history" style="display:inline-block;vertical-align:middle;cursor:pointer;">&#128190;</span><span class="tab-close" title="Close tab" style="margin-left:8px;cursor:pointer;font-size:1.1em;">&times;</span>`;
        this.elements.chatTabs.appendChild(tab);
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
        for (const { content, type } of messages) {
            text += `[${type}] ${content}\n`;
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
        // Remove all private tab DOM elements
        Array.from(this.elements.chatTabs.children).forEach(tab => {
            if (tab.dataset.tab && tab.dataset.tab.startsWith('pm_')) {
                tab.remove();
            }
        });
        // Remove all private chat histories and tab users
        for (const key of Object.keys(this.chatHistories)) {
            if (key.startsWith('pm_')) {
                delete this.chatHistories[key];
            }
        }
        for (const key of Object.keys(this.tabUsers)) {
            if (key.startsWith('pm_')) {
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
        // Always switch to main tab after clearing
        this.switchTab('main');
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