// server2.js
const http = require('http');
const Random = require('random-js').Random;
const useragent = require('useragent');

const PORT = 6002;
const serverNumber = 2;
const startTime = new Date();
let counter = 0;
let interval;

const random = new Random();

const server = http.createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':ok\n\n');
    const sseInterval = setInterval(() => {
      res.write(`data: ${counter}\n\n`);
    }, 1000);
    req.on('close', () => clearInterval(sseInterval));
    return;
  }

  const agent = useragent.parse(req.headers['user-agent'] || '');
  const randomNumber = random.integer(1, 1000);

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(`
    <html><body>
      <pre>
Hello! I am Server ${serverNumber}.
I was started up from ${startTime}.
I also get pinged by main project.
I also count until I will get shutted down.
Here's my count from startup: <span id="counter">${counter}</span>
I can generate random number each time you refresh page. Here's one: ${randomNumber}
I can tell your browser. Here's: ${agent.toString()}
      </pre>
      <script>
        const es = new EventSource('/events');
        es.onmessage = e => {
          document.getElementById('counter').textContent = e.data;
        };
        es.onerror = () => {
          document.getElementById('counter').textContent = '—';
          es.close();
        };
      </script>
    </body></html>
  `);
});
server.setMaxListeners(0);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ${serverNumber} running on port ${PORT}`);
  interval = setInterval(() => counter++, 1000);
});

function shutdown() {
  clearInterval(interval);
  server.close(() => {
    console.log(`Server ${serverNumber} shut down`);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error(`Uncaught exception in server ${serverNumber}:`, err && err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', (r) => {
  console.error(`Unhandled rejection in server ${serverNumber}:`, r);
  process.exit(1);
});

