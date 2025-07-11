const net = require('net');

// Simple test script to verify telnet connection
function testTelnetConnection() {
    console.log('Testing telnet connection to localhost:6666...');
    
    const client = net.createConnection(6666, 'localhost', () => {
        console.log('✅ Successfully connected to telnet server!');
        console.log('✅ The proxy server should work correctly.');
        client.end();
    });
    
    client.on('error', (error) => {
        console.log('❌ Failed to connect to telnet server:');
        console.log(`   Error: ${error.message}`);
        console.log('');
        console.log('Troubleshooting:');
        console.log('1. Make sure your telnet chat server is running on port 6666');
        console.log('2. Check if the server is accessible from localhost');
        console.log('3. Verify no firewall is blocking the connection');
        console.log('4. Try running: telnet localhost 6666');
    });
    
    client.on('close', () => {
        console.log('Connection test completed.');
        process.exit(0);
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
        console.log('❌ Connection test timed out after 5 seconds');
        client.destroy();
        process.exit(1);
    }, 5000);
}

// Run the test
testTelnetConnection(); 