import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import { GameService } from "./game";

const port = Number(process.env.PORT ?? 3000);
const basePath = (process.env.BASE_PATH ?? "/codenames").replace(/\/$/, "");
const clientDistPath = path.resolve(process.cwd(), "dist", "client");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: `${basePath}/socket.io`,
  cors: {
    origin: true,
    credentials: true
  }
});

const gameService = new GameService(io, basePath);

app.get(`${basePath}/api/health`, (_request, response) => {
  response.json({ ok: true });
});

if (fs.existsSync(clientDistPath)) {
  app.use(basePath, express.static(clientDistPath));
  app.get(`${basePath}/*`, (_request, response) => {
    response.sendFile(path.join(clientDistPath, "index.html"));
  });
}

io.on("connection", (socket) => {
  gameService.attachSocket(socket);
});

server.listen(port, () => {
  process.stdout.write(`Codenames server listening on http://localhost:${port}${basePath}\n`);
});
