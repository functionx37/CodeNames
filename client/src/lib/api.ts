import { reactive } from "vue";
import type { ChatMessage, ContinueVote, RoomSnapshot, RoomSummary, SeatSide } from "@shared/types";
import { getSocket } from "./socket";
import { loadNickname, loadPlayerToken, saveNickname, savePlayerToken } from "./storage";

type Ack = { ok: true; roomId?: string; playerId?: string; token?: string } | { ok: false; error: string };

export const appState = reactive({
  nickname: loadNickname(),
  playerToken: loadPlayerToken(),
  lobby: [] as RoomSummary[],
  currentRoom: null as RoomSnapshot | null,
  connected: false,
  lastError: ""
});

const socket = getSocket();

socket.on("connect", () => {
  appState.connected = true;
});

socket.on("disconnect", () => {
  appState.connected = false;
});

socket.on("lobby:snapshot", (rooms: RoomSummary[]) => {
  appState.lobby = rooms;
});

socket.on("room:snapshot", (snapshot: RoomSnapshot) => {
  appState.currentRoom = snapshot;
});

function emitWithAck<TPayload>(event: string, payload: TPayload): Promise<Ack> {
  return new Promise((resolve) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, error: "请求超时" });
      }
    }, 5000);

    socket.emit(event, payload, (response: Ack) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (!response.ok) {
        appState.lastError = response.error;
      } else {
        appState.lastError = "";
      }
      resolve(response);
    });
  });
}

export async function createRoom(roomName: string): Promise<Ack> {
  const response = await emitWithAck("room:create", {
    roomName,
    nickname: appState.nickname,
    token: appState.playerToken
  });
  if (response.ok && response.token) {
    savePlayerToken(response.token);
    appState.playerToken = response.token;
  }
  return response;
}

export async function joinRoom(roomId: string): Promise<Ack> {
  const response = await emitWithAck("room:join", {
    roomId,
    nickname: appState.nickname,
    token: appState.playerToken
  });
  if (response.ok && response.token) {
    savePlayerToken(response.token);
    appState.playerToken = response.token;
  }
  return response;
}

export async function leaveRoom(roomId: string): Promise<Ack> {
  return emitWithAck("room:leave", { roomId });
}

export async function updateNickname(roomId: string, nickname: string): Promise<Ack> {
  saveNickname(nickname);
  appState.nickname = nickname;
  return emitWithAck("player:updateName", { roomId, nickname });
}

export function updateLocalNickname(nickname: string): void {
  saveNickname(nickname);
  appState.nickname = nickname;
}

export async function setSeat(roomId: string, seat: SeatSide): Promise<Ack> {
  return emitWithAck("player:setSeat", { roomId, seat });
}

export async function setReady(roomId: string, ready: boolean): Promise<Ack> {
  return emitWithAck("player:setReady", { roomId, ready });
}

export async function startGame(roomId: string): Promise<Ack> {
  return emitWithAck("game:start", { roomId });
}

export async function replaceDraftCard(roomId: string, cardId: string): Promise<Ack> {
  return emitWithAck("draft:replace", { roomId, cardId });
}

export async function submitHintWord(roomId: string, word: string): Promise<Ack> {
  return emitWithAck("hint:submitWord", { roomId, word });
}

export async function submitHintNumber(roomId: string, number: number): Promise<Ack> {
  return emitWithAck("hint:submitNumber", { roomId, number });
}

export async function sendChat(roomId: string, text: string): Promise<Ack> {
  return emitWithAck("chat:send", { roomId, text });
}

export async function previewGuess(roomId: string, cardId: string | null): Promise<Ack> {
  return emitWithAck("guess:preview", { roomId, cardId });
}

export async function confirmGuess(roomId: string, cardId: string): Promise<Ack> {
  return emitWithAck("guess:confirm", { roomId, cardId });
}

export async function voteTurn(roomId: string, vote: ContinueVote): Promise<Ack> {
  return emitWithAck("turn:vote", { roomId, vote });
}

export async function rematch(roomId: string): Promise<Ack> {
  return emitWithAck("game:rematch", { roomId });
}

export function subscribeToLobby(): void {
  socket.emit("lobby:subscribe");
}

export function roomMessages(): ChatMessage[] {
  return appState.currentRoom?.messages ?? [];
}
