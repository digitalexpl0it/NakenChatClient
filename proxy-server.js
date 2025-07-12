const WebSocket = require('ws');
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class NakenChatProxy {
    constructor() {
        this.wss = null;
        this.clients = new Map();
        this.nakenChatConnections = new Map();
        this.clientTargets = new Map(); // Store target host/port for each client
        this.config = config;
    }

    start() {
        console.log('Starting Naken Chat Proxy Server...');
        console.log(`WebSocket server listening on port ${this.config.wsPort}`);
        console.log(`Proxying to Naken Chat server at ${this.config.nakenChatHost}:${this.config.nakenChatPort}`);

        // Create HTTP server to serve static files
        const server = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });

        // Create WebSocket server
        this.wss = new WebSocket.Server({ server });

        this.wss.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            console.log(`New WebSocket connection: ${clientId}`);
            this.clients.set(clientId, ws);

            ws.on('message', (data) => {
                this.handleWebSocketMessage(clientId, data);
            });

            ws.on('close', () => {
                this.handleWebSocketClose(clientId);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for ${clientId}:`, error);
                this.handleWebSocketClose(clientId);
            });

            // Send welcome message
            ws.send('Welcome to Naken Chat Client!\n');
        });

        server.listen(this.config.wsPort, () => {
            console.log(`Server started on port ${this.config.wsPort}`);
            console.log(`Open http://localhost:${this.config.wsPort} in your browser`);
        });
    }

    handleHttpRequest(req, res) {
        let filePath = req.url === '/' ? '/index.html' : req.url;
        filePath = path.join(__dirname, filePath);

        // Security: prevent directory traversal
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const ext = path.extname(filePath);
        const contentType = this.getContentType(ext);

        fs.readFile(filePath, (err, data) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('File not found');
                } else {
                    res.writeHead(500);
                    res.end('Internal server error');
                }
                return;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    getContentType(ext) {
        const types = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.ico': 'image/x-icon'
        };
        return types[ext] || 'text/plain';
    }

    handleWebSocketConnection(ws, req) {
        const clientId = this.generateClientId();
        console.log(`New WebSocket connection: ${clientId}`);

        this.clients.set(clientId, ws);

        ws.on('message', (data) => {
            this.handleWebSocketMessage(clientId, data);
        });

        ws.on('close', () => {
            this.handleWebSocketClose(clientId);
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for ${clientId}:`, error);
            this.handleWebSocketClose(clientId);
        });

        // Send welcome message
        ws.send('Welcome to Naken Chat Client!\n');
    }

    handleWebSocketMessage(clientId, data) {
        const message = data.toString().trim();
        console.log(`Message from ${clientId}: ${message}`);

        // Try to parse as JSON for special commands
        try {
            const parsedMessage = JSON.parse(message);
            if (parsedMessage.type === 'setTarget') {
                // Store the target host/port for this client
                this.clientTargets.set(clientId, {
                    host: parsedMessage.host,
                    port: parsedMessage.port
                });
                console.log(`Set target for ${clientId}: ${parsedMessage.host}:${parsedMessage.port}`);
                return;
            }
        } catch (e) {
            // Not JSON, treat as regular Naken Chat command
        }

        // Get or create Naken Chat connection
        let nakenChatConn = this.nakenChatConnections.get(clientId);
        
        if (!nakenChatConn) {
            const target = this.clientTargets.get(clientId);
            if (!target) {
                console.error(`No target set for client ${clientId}`);
                const ws = this.clients.get(clientId);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send('Error: No server target set. Please connect first.\n');
                }
                return;
            }
            nakenChatConn = this.createNakenChatConnection(clientId, target.host, target.port);
            if (!nakenChatConn) return;
        }

        // Send message to Naken Chat server
        nakenChatConn.write(message + '\n');
    }

    // Update to accept host/port
    createNakenChatConnection(clientId, host, port) {
        const ws = this.clients.get(clientId);
        if (!ws) return null;

        console.log(`Creating Naken Chat connection for ${clientId} to ${host}:${port}`);

        const nakenChatConn = net.createConnection(port, host, () => {
            console.log(`Naken Chat connected for ${clientId}`);
            ws.send('Connected to server\n');
        });

        nakenChatConn.on('data', (data) => {
            const message = data.toString();
            console.log(`Naken Chat data for ${clientId}: ${message.trim()}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });

        nakenChatConn.on('close', () => {
            console.log(`Naken Chat connection closed for ${clientId}`);
            this.nakenChatConnections.delete(clientId);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('Naken Chat connection closed\n');
            }
        });

        nakenChatConn.on('error', (error) => {
            console.error(`Naken Chat error for ${clientId}:`, error);
            if (ws.readyState === WebSocket.OPEN) {
                // Send JSON error message for client toast
                ws.send(JSON.stringify({ type: 'error', message: 'Could not connect to target server. Please check the address and try again.' }));
                ws.send(`Naken Chat connection error: ${error.message}\n`);
            }
            this.nakenChatConnections.delete(clientId);
        });

        this.nakenChatConnections.set(clientId, nakenChatConn);
        return nakenChatConn;
    }

    handleWebSocketClose(clientId) {
        console.log(`WebSocket connection closed: ${clientId}`);
        
        // Close Naken Chat connection
        const nakenChatConn = this.nakenChatConnections.get(clientId);
        if (nakenChatConn) {
            nakenChatConn.end();
            this.nakenChatConnections.delete(clientId);
        }
        
        // Clean up client data
        this.clients.delete(clientId);
        this.clientTargets.delete(clientId);
    }

    generateClientId() {
        return Math.random().toString(36).substr(2, 9);
    }

    shutdown() {
        console.log('Shutting down proxy server...');
        
        // Close all WebSocket connections
        this.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        
        // Close all Naken Chat connections
        this.nakenChatConnections.forEach((conn) => {
            conn.end();
        });
        
        // Close WebSocket server
        if (this.wss) {
            this.wss.close();
        }
        
        console.log('Proxy server shutdown complete');
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    proxy.shutdown();
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    proxy.shutdown();
});

// Start the proxy server
const proxy = new NakenChatProxy();
proxy.start(); 