// dashboard.js

const express = require('express');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DASHBOARD_PORT = 6004;

// servers config
const servers = [
  { number: 1, port: 6001, child: null, pid: null, lastExit: 0, desired: true, starting: false, restartAttempts: 0 },
  { number: 2, port: 6002, child: null, pid: null, lastExit: 0, desired: true, starting: false, restartAttempts: 0 },
  { number: 3, port: 6003, child: null, pid: null, lastExit: 0, desired: true, starting: false, restartAttempts: 0 }
];


function isPortFreeByConnect(port, host = '127.0.0.1', timeout = 300) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    sock.setTimeout(timeout);
    sock.once('connect', () => {
      done = true;
      sock.destroy();
      resolve(false); 
    });
    sock.once('timeout', () => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(true); 
    });
    sock.once('error', () => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(true); 
    });
    sock.connect(port, host);
  });
}


async function startServer(server) {
  if (server.child || server.starting) return;
  server.desired = true;
  server.starting = true;

  const free = await isPortFreeByConnect(server.port);
  if (!free) {
    console.log(`Port ${server.port} is already in use; not starting server ${server.number}`);
    server.starting = false;
    return;
  }

  
  server.restartAttempts = 0;

  const script = path.join(__dirname, `server${server.number}.js`);
  const child = spawn(process.execPath, [script], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.child = child;
  server.pid = child.pid;
  server.starting = false;
  console.log(`Started server ${server.number} (pid ${server.pid})`);

  child.stdout.on('data', (d) => {
    process.stdout.write(`[S${server.number} stdout] ${d}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[S${server.number} stderr] ${d}`);
  });

  child.on('exit', async (code, signal) => {
    server.child = null;
    server.pid = null;
    server.lastExit = Date.now();
    console.log(`Server ${server.number} exited (code=${code}, signal=${signal})`);

    
    if (server.desired) {
      server.restartAttempts = (server.restartAttempts || 0) + 1;
      const maxAttempts = 10;
      if (server.restartAttempts > maxAttempts) {
        console.log(`Server ${server.number} exceeded restart attempts (${maxAttempts}). Will not auto-restart until manually started.`);
        return;
      }
      const backoffMs = Math.min(2000 * server.restartAttempts, 15000);
      console.log(`Will attempt to restart server ${server.number} in ${backoffMs}ms (attempt ${server.restartAttempts})`);
      setTimeout(async () => {
        const freeNow = await isPortFreeByConnect(server.port);
        if (freeNow && server.desired) {
          startServer(server);
        } else {
          
          setTimeout(() => {
            if (server.desired) startServer(server);
          }, 2000);
        }
      }, backoffMs);
    } else {
      console.log(`Server ${server.number} will remain stopped (desired=false)`);
    }
  });
}

// i used here a little of ai to fix problem, don't call this ai slop, whole project is normal and written by me.
function stopServer(server) {
  server.desired = false;
  return new Promise((resolve) => {
    if (!server.pid) {
      server.child = null;
      server.pid = null;
      return resolve();
    }

    const pid = server.pid;
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Sent SIGTERM to server ${server.number} (pid ${pid})`);
    } catch (err) {
      console.log(`Error sending SIGTERM to server ${server.number}: ${err.message}`);
    }

    const checkInterval = setInterval(() => {
      if (!server.pid) {
        clearInterval(checkInterval);
        return resolve();
      }
    }, 100);

    
    setTimeout(() => {
      if (server.pid === pid && server.pid) {
        try {
          process.kill(pid, 'SIGKILL');
          console.log(`Sent SIGKILL to server ${server.number} (pid ${pid})`);
        } catch (e) {}
      }
    }, 2000);

    
    setTimeout(() => {
      clearInterval(checkInterval);
      server.child = null;
      server.pid = null;
      resolve();
    }, 6000);
  });
}

function restartServer(server) {
  server.desired = true;
  stopServer(server).then(() => {
    setTimeout(() => startServer(server), 300);
  });
}

function pingServer(server) {
  return new Promise(resolve => {
    http.get({ hostname: '127.0.0.1', port: server.port, path: '/', timeout: 1200 }, res => {
      resolve(res.statusCode === 200 ? 'Started' : `Error ${res.statusCode}`);
    }).on('error', () => {
      resolve('Stopped');
    }).on('timeout', () => {
      resolve('Stopped');
    });
  });
}


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html')); // i wonder why did i select two files instead of one dashboard file. or wait? i am dumb i guess.
});

app.get('/status', async (req, res) => {
  const statuses = await Promise.all(servers.map(pingServer));
  res.json(statuses);
});

app.post('/api/toggle/:id', (req, res) => {
  const server = servers.find(s => s.number == req.params.id);
  if (!server) return res.status(404).json({ ok: false });
  if (server.pid) {
    stopServer(server).then(() => res.json({ ok: true }));
  } else {
    startServer(server);
    res.json({ ok: true });
  }
});

app.post('/api/restart/:id', (req, res) => {
  const server = servers.find(s => s.number == req.params.id);
  if (!server) return res.status(404).json({ ok: false });
  restartServer(server);
  res.json({ ok: true });
});

app.post('/api/toggleAll', async (req, res) => {
  const anyRunning = servers.some(s => s.pid);
  if (anyRunning) {
    await Promise.all(servers.map(s => stopServer(s)));
    return res.json({ ok: true, action: 'stopped' });
  } else {
    servers.forEach(s => { s.desired = true; startServer(s); });
    return res.json({ ok: true, action: 'started' });
  }
});

app.post('/api/stopAll', async (req, res) => {
  await Promise.all(servers.map(s => stopServer(s)));
  res.json({ ok: true });
});


app.listen(DASHBOARD_PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on http://0.0.0.0:${DASHBOARD_PORT}`);
  // start only if desired and port free, because code was fricking out when i just added something.
  servers.forEach(s => { if (s.desired) startServer(s); });
});


function shutdownDashboard() {
  console.log('Shutting down dashboard and child servers...');
  servers.forEach(s => { s.desired = false; });
  Promise.all(servers.map(s => stopServer(s))).then(() => {
    process.exit(0);
  });
}
process.on('SIGINT', shutdownDashboard);
process.on('SIGTERM', shutdownDashboard);

