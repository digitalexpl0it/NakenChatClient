const WebSocket = require('ws');
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class TelnetProxy {
    constructor() {
        this.wss = null;
        this.clients = new Map();
        this.telnetConnections = new Map();
        this.config = config;
    }

    start() {
        console.log('Starting Naken Chat Proxy Server...');
        console.log(`WebSocket server listening on port ${this.config.wsPort}`);
        console.log(`Proxying to telnet server at ${this.config.telnetHost}:${this.config.telnetPort}`);

        // Create HTTP server to serve static files
        const server = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });

        // Create WebSocket server
        this.wss = new WebSocket.Server({ server });

        this.wss.on('connection', (ws, req) => {
            // Wait for setTarget message before connecting to telnet
            let clientId = this.generateClientId();
            console.log(`New WebSocket connection: ${clientId}`);
            this.clients.set(clientId, ws);
            let telnetConn = null;
            let targetSet = false;
            let targetHost = null;
            let targetPort = null;

            ws.on('message', (data) => {
                // If not set, expect a JSON message with type 'setTarget'
                if (!targetSet) {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'setTarget' && msg.host && msg.port) {
                            targetHost = msg.host;
                            targetPort = parseInt(msg.port, 10);
                            targetSet = true;
                            telnetConn = this.createTelnetConnection(clientId, targetHost, targetPort);
                            if (!telnetConn) {
                                ws.send('Failed to connect to telnet server\n');
                                ws.close();
                            }
                        } else {
                            ws.send('Expected setTarget message with host and port.');
                            ws.close();
                        }
                    } catch (e) {
                        ws.send('Invalid initial message.');
                        ws.close();
                    }
                    return;
                }
                // Relay all other messages to telnet
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

        // Get or create telnet connection
        let telnetConn = this.telnetConnections.get(clientId);
        
        if (!telnetConn) {
            telnetConn = this.createTelnetConnection(clientId);
            if (!telnetConn) return;
        }

        // Send message to telnet server
        telnetConn.write(message + '\n');
    }

    // Update to accept host/port
    createTelnetConnection(clientId, host, port) {
        const ws = this.clients.get(clientId);
        if (!ws) return null;

        console.log(`Creating telnet connection for ${clientId} to ${host}:${port}`);

        const telnetConn = net.createConnection(port, host, () => {
            console.log(`Telnet connected for ${clientId}`);
            ws.send('Connected to server\n');
        });

        telnetConn.on('data', (data) => {
            const message = data.toString();
            console.log(`Telnet data for ${clientId}: ${message.trim()}`);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });

        telnetConn.on('close', () => {
            console.log(`Telnet connection closed for ${clientId}`);
            this.telnetConnections.delete(clientId);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('Telnet connection closed\n');
            }
        });

        telnetConn.on('error', (error) => {
            console.error(`Telnet error for ${clientId}:`, error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(`Telnet connection error: ${error.message}\n`);
            }
            this.telnetConnections.delete(clientId);
        });

        this.telnetConnections.set(clientId, telnetConn);
        return telnetConn;
    }

    handleWebSocketClose(clientId) {
        console.log(`WebSocket connection closed: ${clientId}`);
        
        // Close telnet connection
        const telnetConn = this.telnetConnections.get(clientId);
        if (telnetConn) {
            telnetConn.end();
            this.telnetConnections.delete(clientId);
        }
        
        this.clients.delete(clientId);
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
        
        // Close all telnet connections
        this.telnetConnections.forEach((conn) => {
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
const proxy = new TelnetProxy();
proxy.start(); 