const { spawn } = require('child_process');
const path = require('path');

console.log('========================================================');
console.log('🌾 Starting FarmDirect Full-Stack Development Services');
console.log('========================================================');

// Start Express Backend
const server = spawn('node', ['server/src/server.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: '5000' }
});

// Start Vite React Frontend
const client = spawn('npm', ['--prefix', 'client', 'run', 'dev'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true
});

function handleExit() {
  console.log('\nShutting down FarmDirect services...');
  server.kill();
  client.kill();
  process.exit();
}

process.on('SIGINT', handleExit);
process.on('SIGTERM', handleExit);
