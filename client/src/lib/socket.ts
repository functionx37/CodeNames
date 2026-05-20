import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) {
    return socket;
  }

  const basePath = (import.meta.env.BASE_URL || "/codenames/").replace(/\/$/, "");
  socket = io({
    path: `${basePath}/socket.io`,
    transports: ["websocket", "polling"]
  });
  return socket;
}
