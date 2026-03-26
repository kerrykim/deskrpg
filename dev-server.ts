// Dev server — runs Next.js dev mode + Socket.io on the same HTTP server
// Usage: npx tsx dev-server.ts

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server as SocketServer } from "socket.io";
import { setupSocketHandlers } from "./src/server/socket-handlers";

const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev: true, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketServer(httpServer, {
    path: "/socket.io",
  });

  setupSocketHandlers(io);

  httpServer.listen(port, () => {
    console.log(`> Dev server ready on http://${hostname}:${port}`);
  });
});
