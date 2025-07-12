// NakenChat Client configuration
if (typeof window !== 'undefined') {
  window.NAKENCHAT_DEBUG = false; // Set to true to enable debug logging in the browser
}

// Configuration file for Naken Chat Client
module.exports = {
    // WebSocket server configuration
    wsPort: 7666,
    
    // Naken Chat server configuration
    nakenChatPort: 6666,
    nakenChatHost: 'localhost',
    
    // Server settings
    serverName: 'Naken Chat Proxy',
    maxConnections: 100,
    
    // Logging
    enableLogging: true,
    logLevel: 'info', // 'debug', 'info', 'warn', 'error'
    
    // Security
    enableRateLimiting: true,
    maxMessagesPerMinute: 60,
    
    // Features
    enableAutoReconnect: true,
    reconnectDelay: 5000, // milliseconds
    
    // Custom emoji mappings (optional)
    customEmojis: {
        // Add your custom emojis here
        // ':custom:': '🎉'
    }
}; 