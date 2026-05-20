import fs from "node:fs";
import path from "node:path";
import {
  CardColor,
  CardView,
  ChatKind,
  ChatMessage,
  ContinueVote,
  DraftState,
  GameSnapshot,
  LogEvent,
  PlayerSummary,
  RevealOutcome,
  RoomSnapshot,
  RoomStatus,
  RoomSummary,
  SeatSide,
  TeamSide,
  TurnStage,
  ViewerRole
} from "../shared/types";
import type { Server, Socket } from "socket.io";

type AckResponse =
  | { ok: true; roomId?: string; playerId?: string; token?: string }
  | { ok: false; error: string };

interface ServerPlayer extends PlayerSummary {
  socketId: string | null;
  token: string;
}

interface ServerCard extends Omit<CardView, "color"> {
  color: CardColor;
}

interface ServerGame extends Omit<GameSnapshot, "cards"> {
  cards: ServerCard[];
  usedWords: Set<string>;
  previewSelections: Record<string, string | null>;
  confirmedSelections: Record<string, string | null>;
}

interface ServerRoom {
  id: string;
  name: string;
  status: RoomStatus;
  players: ServerPlayer[];
  messages: ChatMessage[];
  game: ServerGame | null;
  createdAt: string;
  updatedAt: string;
  gameCounter: number;
}

interface JoinPayload {
  roomId: string;
  nickname: string;
  token: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix = "", length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = prefix;
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function sampleOne<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function otherTeam(team: TeamSide): TeamSide {
  return team === "red" ? "blue" : "red";
}

function sanitizeName(input: string, fallback: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 24);
}

function sanitizeRoomName(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 32) || "未命名房间";
}

function sanitizeChat(input: string): string {
  return input.trim().slice(0, 160);
}

function isTeamSide(value: SeatSide): value is TeamSide {
  return value === "red" || value === "blue";
}

export class GameService {
  private readonly io: Server;
  private readonly basePath: string;
  private readonly rooms = new Map<string, ServerRoom>();
  private readonly socketToMembership = new Map<string, { roomId: string; playerId: string }>();
  private readonly vocabulary: string[];
  private readonly logsDir: string;

  constructor(io: Server, basePath: string) {
    this.io = io;
    this.basePath = basePath;
    this.logsDir = path.resolve(process.cwd(), "server", "logs");
    this.vocabulary = this.loadVocabulary();
  }

  attachSocket(socket: Socket): void {
    socket.emit("lobby:snapshot", this.getLobbySnapshot());

    socket.on("room:create", (payload: { roomName: string; nickname: string; token: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.createRoom(socket, payload.roomName, payload.nickname, payload.token));
    });

    socket.on("room:join", (payload: JoinPayload, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.joinRoom(socket, payload));
    });

    socket.on("room:leave", (payload: { roomId: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.leaveRoom(socket, payload.roomId));
    });

    socket.on("player:updateName", (payload: { roomId: string; nickname: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.updateNickname(socket, payload.roomId, payload.nickname));
    });

    socket.on("player:setSeat", (payload: { roomId: string; seat: SeatSide }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.setSeat(socket, payload.roomId, payload.seat));
    });

    socket.on("player:setReady", (payload: { roomId: string; ready: boolean }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.setReady(socket, payload.roomId, payload.ready));
    });

    socket.on("game:start", (payload: { roomId: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.startGame(socket, payload.roomId));
    });

    socket.on("draft:replace", (payload: { roomId: string; cardId: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.replaceDraftCard(socket, payload.roomId, payload.cardId));
    });

    socket.on("hint:submitWord", (payload: { roomId: string; word: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.submitHintWord(socket, payload.roomId, payload.word));
    });

    socket.on("hint:submitNumber", (payload: { roomId: string; number: number }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.submitHintNumber(socket, payload.roomId, payload.number));
    });

    socket.on("chat:send", (payload: { roomId: string; text: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.sendChat(socket, payload.roomId, payload.text));
    });

    socket.on("guess:preview", (payload: { roomId: string; cardId: string | null }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.previewGuess(socket, payload.roomId, payload.cardId));
    });

    socket.on("guess:confirm", (payload: { roomId: string; cardId: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.confirmGuess(socket, payload.roomId, payload.cardId));
    });

    socket.on("turn:vote", (payload: { roomId: string; vote: ContinueVote }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.voteContinue(socket, payload.roomId, payload.vote));
    });

    socket.on("game:rematch", (payload: { roomId: string }, ack?: (response: AckResponse) => void) => {
      this.withAck(ack, () => this.requestRematch(socket, payload.roomId));
    });

    socket.on("disconnect", () => {
      this.handleDisconnect(socket.id);
    });
  }

  private withAck(ack: ((response: AckResponse) => void) | undefined, action: () => AckResponse): void {
    const response = action();
    if (ack) {
      ack(response);
    }
  }

  private createRoom(socket: Socket, roomName: string, nickname: string, token: string): AckResponse {
    const id = this.createRoomId();
    const room: ServerRoom = {
      id,
      name: sanitizeRoomName(roomName),
      status: "waiting",
      players: [],
      messages: [],
      game: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      gameCounter: 0
    };
    this.rooms.set(id, room);
    this.logEvent(room, null, "room.created", { roomName: room.name });
    const joinResult = this.joinRoom(socket, { roomId: id, nickname, token });
    return joinResult.ok ? { ...joinResult, roomId: id } : joinResult;
  }

  private joinRoom(socket: Socket, payload: JoinPayload): AckResponse {
    const room = this.rooms.get(payload.roomId.trim().toUpperCase());
    if (!room) {
      return this.fail("房间不存在");
    }

    const normalizedToken = payload.token.trim() || randomId("P", 10);
    const existingPlayer = room.players.find((player) => player.token === normalizedToken);
    let player: ServerPlayer;

    if (existingPlayer) {
      if (existingPlayer.socketId && existingPlayer.socketId !== socket.id) {
        this.socketToMembership.delete(existingPlayer.socketId);
      }
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      existingPlayer.lastSeenAt = nowIso();
      player = existingPlayer;
      this.logEvent(room, player.id, "player.reconnected", { nickname: player.nickname });
    } else {
      const safeNickname = this.ensureUniqueNickname(room, sanitizeName(payload.nickname, `玩家${room.players.length + 1}`));
      const createdAt = nowIso();
      player = {
        id: randomId("PLAYER_", 10),
        token: normalizedToken,
        nickname: safeNickname,
        seat: room.status === "waiting" ? "spectator" : "spectator",
        ready: false,
        connected: true,
        isCaptain: false,
        joinedAt: createdAt,
        lastSeenAt: createdAt,
        socketId: socket.id
      };
      room.players.push(player);
      this.logEvent(room, player.id, "player.joined", { nickname: player.nickname, seat: player.seat });
      this.addMessage(room, "system", null, "系统", `${player.nickname} 加入了房间`);
    }

    socket.join(room.id);
    this.socketToMembership.set(socket.id, { roomId: room.id, playerId: player.id });
    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true, roomId: room.id, playerId: player.id, token: player.token };
  }

  private leaveRoom(socket: Socket, roomId: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    
    // Remove player from room
    room.players = room.players.filter(p => p.id !== player.id);
    this.socketToMembership.delete(socket.id);
    socket.leave(room.id);

    this.addMessage(room, "system", null, "系统", `${player.nickname} 退出了房间`);
    this.logEvent(room, player.id, "player.left", {});

    if (room.players.length === 0) {
      this.rooms.delete(room.id);
      this.logEvent(room, null, "room.destroyed", { reason: "empty" });
    } else {
      this.touchRoom(room);
      this.broadcastRoom(room);
    }
    
    this.broadcastLobby();
    return { ok: true };
  }

  private updateNickname(socket: Socket, roomId: string, nickname: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    const nextNickname = this.ensureUniqueNickname(room, sanitizeName(nickname, player.nickname), player.id);
    if (nextNickname === player.nickname) {
      return { ok: true };
    }

    const previous = player.nickname;
    player.nickname = nextNickname;
    player.lastSeenAt = nowIso();
    this.syncPlayerNames(room);
    this.addMessage(room, "system", null, "系统", `${previous} 现在叫 ${nextNickname}`);
    this.logEvent(room, player.id, "player.renamed", { from: previous, to: nextNickname });
    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  private setSeat(socket: Socket, roomId: string, seat: SeatSide): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    if (room.status !== "waiting") {
      return this.fail("当前阶段不能换边");
    }

    const previousSeat = player.seat;
    player.seat = seat;
    player.ready = false;
    player.isCaptain = false;
    player.lastSeenAt = nowIso();
    this.logEvent(room, player.id, "player.seat_changed", { from: previousSeat, to: seat });
    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  private setReady(socket: Socket, roomId: string, ready: boolean): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    if (room.status !== "waiting") {
      return this.fail("只有等待阶段可以准备");
    }
    if (!isTeamSide(player.seat)) {
      return this.fail("旁观者不能准备");
    }

    player.ready = ready;
    player.lastSeenAt = nowIso();
    this.logEvent(room, player.id, ready ? "player.ready" : "player.unready", { seat: player.seat });
    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  private startGame(socket: Socket, roomId: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    if (room.status !== "waiting") {
      return this.fail("当前不能开始");
    }
    if (!isTeamReady(room)) {
      return this.fail("需要双方至少两人且所有队员已准备");
    }

    const redPlayers = room.players.filter((roomPlayer) => roomPlayer.seat === "red");
    const bluePlayers = room.players.filter((roomPlayer) => roomPlayer.seat === "blue");
    const redCaptain = sampleOne(redPlayers);
    const blueCaptain = sampleOne(bluePlayers);
    room.players.forEach((roomPlayer) => {
      roomPlayer.isCaptain = roomPlayer.id === redCaptain.id || roomPlayer.id === blueCaptain.id;
      roomPlayer.ready = false;
    });

    const firstTeam: TeamSide = Math.random() < 0.5 ? "red" : "blue";
    const secondTeam = otherTeam(firstTeam);
    const initialWords = this.drawUniqueWords(25, new Set<string>());
    const createdAt = nowIso();
    const cards: ServerCard[] = initialWords.map((word, index) => ({
      id: `CARD_${index + 1}`,
      word,
      color: "white",
      revealed: false,
      locked: false,
      revealedAt: null,
      previewPlayerIds: [],
      previewNicknames: []
    }));

    room.gameCounter += 1;
    room.game = {
      id: `GAME_${room.id}_${room.gameCounter}`,
      status: "draft",
      currentTurn: firstTeam,
      firstTeam,
      secondTeam,
      turnStage: null,
      cards,
      captains: {
        red: redCaptain.id,
        blue: blueCaptain.id
      },
      remainingByColor: {
        red: 0,
        blue: 0,
        black: 1,
        white: 0
      },
      draft: {
        round: 1,
        totalRounds: 3,
        currentCaptainSide: secondTeam,
        replacementsUsed: 0
      },
      hint: {
        word: null,
        number: null,
        captainId: null
      },
      guess: {
        confirmedCardId: null,
        confirmationPlayerIds: [],
        continueVotes: {}
      },
      winner: null,
      winnerReason: null,
      createdAt,
      usedWords: new Set(cards.map((card) => card.word)),
      previewSelections: {},
      confirmedSelections: {}
    };

    room.status = "draft";
    this.addMessage(room, "system", null, "系统", `${player.nickname} 开始了新游戏`);
    this.logEvent(room, player.id, "game.started", {
      firstTeam,
      secondTeam,
      redCaptain: redCaptain.nickname,
      blueCaptain: blueCaptain.nickname,
      cards: cards.map((card) => card.word)
    });
    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  private replaceDraftCard(socket: Socket, roomId: string, cardId: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    const game = room.game;
    if (!game || room.status !== "draft" || !game.draft) {
      return this.fail("当前不是换词阶段");
    }

    const currentSide = game.draft.currentCaptainSide;
    if (player.id !== game.captains[currentSide]) {
      return this.fail("只有当前队长可以换词");
    }

    if (cardId === "skip") {
      game.draft.replacementsUsed += 1;
      
      if (game.draft.currentCaptainSide === game.secondTeam) {
        game.draft.currentCaptainSide = game.firstTeam!;
      } else {
        game.draft.currentCaptainSide = game.secondTeam!;
        game.draft.round += 1;
      }

      this.logEvent(room, player.id, "draft.skipped", {
        round: game.draft.round,
        skippedBy: player.nickname
      });

      if (game.draft.replacementsUsed >= game.draft.totalRounds * 2) {
        this.assignColors(room);
      }

      this.touchRoom(room);
      this.broadcastRoom(room);
      this.broadcastLobby();
      return { ok: true };
    }

    const card = game.cards.find((value) => value.id === cardId);
    if (!card) {
      return this.fail("词卡不存在");
    }
    if (card.locked) {
      return this.fail("这张卡已经翻过");
    }

    const oldWord = card.word;
    const [replacement] = this.drawUniqueWords(1, game.usedWords);
    game.usedWords.add(replacement);
    card.word = replacement;
    card.locked = true;
    game.draft.replacementsUsed += 1;

    if (game.draft.currentCaptainSide === game.secondTeam) {
      game.draft.currentCaptainSide = game.firstTeam!;
    } else {
      game.draft.currentCaptainSide = game.secondTeam!;
      game.draft.round += 1;
    }

    this.logEvent(room, player.id, "draft.replaced", {
      round: game.draft.round,
      replacedBy: player.nickname,
      cardId,
      from: oldWord,
      to: replacement
    });

    if (game.draft.replacementsUsed >= game.draft.totalRounds * 2) {
      this.assignColors(room);
    }

    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  private assignColors(room: ServerRoom): void {
    const game = room.game;
    if (!game || !game.firstTeam || !game.secondTeam) {
      return;
    }

    room.status = "assigning";
    game.status = "assigning";
    game.draft = null;

    const indexes = this.shuffledIndexes(game.cards.length);
    const firstCount = 9;
    const secondCount = 8;
    const blackIndex = indexes[firstCount + secondCount];

    indexes.forEach((cardIndex, orderIndex) => {
      const card = game.cards[cardIndex];
      if (cardIndex === blackIndex) {
        card.color = "black";
      } else if (orderIndex < firstCount) {
        card.color = game.firstTeam!;
      } else if (orderIndex < firstCount + secondCount) {
        card.color = game.secondTeam!;
      } else {
        card.color = "white";
      }
      card.locked = false;
    });

    game.remainingByColor = this.computeRemainingByColor(game.cards);
    this.logEvent(room, null, "game.assigned", {
      firstTeam: game.firstTeam,
      assignments: game.cards.map((card) => ({
        cardId: card.id,
        word: card.word,
        color: card.color
      }))
    });

    room.status = "playing";
    game.status = "playing";
    game.turnStage = "captain_hint";
    game.currentTurn = game.firstTeam;
    game.hint = {
      word: null,
      number: null,
      captainId: null
    };
    game.guess = {
      confirmedCardId: null,
      confirmationPlayerIds: [],
      continueVotes: {}
    };
    game.previewSelections = {};
    game.confirmedSelections = {};
    this.addMessage(room, "system", null, "系统", `${this.teamLabel(game.currentTurn)} 先手，请队长出提示`);
  }

  private submitHintWord(socket: Socket, roomId: string, word: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    const game = room.game;
    if (!game || room.status !== "playing" || game.turnStage !== "captain_hint" || !game.currentTurn) {
      return this.fail("当前不能发送提示词");
    }
    if (player.id !== game.captains[game.currentTurn]) {
      return this.fail("只有当前队长可以发送提示词");
    }

    const trimmed = word.trim();
    if (!trimmed || /\s/.test(trimmed)) {
      return this.fail("提示词必须是单个连续词");
    }

    if (this.hasCharacterOverlap(trimmed, game.cards.map((card) => card.word))) {
      const masked = "*".repeat(Array.from(trimmed).length);
      this.addMessage(room, "invalid_hint", player.id, player.nickname, masked, { original: trimmed });
      this.logEvent(room, player.id, "hint.invalid", { original: trimmed, masked });
      this.touchRoom(room);
      this.broadcastRoom(room);
      return { ok: true };
    }

    game.hint.word = trimmed;
    game.hint.captainId = player.id;
    game.hint.number = null;
    this.addMessage(room, "hint_word", player.id, player.nickname, trimmed);
    this.logEvent(room, player.id, "hint.word", { word: trimmed, team: game.currentTurn });
    this.touchRoom(room);
    this.broadcastRoom(room);
    return { ok: true };
  }

  private submitHintNumber(socket: Socket, roomId: string, number: number): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    const game = room.game;
    if (!game || room.status !== "playing" || game.turnStage !== "captain_hint" || !game.currentTurn) {
      return this.fail("当前不能发送数字");
    }
    if (player.id !== game.captains[game.currentTurn]) {
      return this.fail("只有当前队长可以发送数字");
    }
    if (!game.hint.word) {
      return this.fail("请先发送提示词");
    }
    if (!Number.isInteger(number) || number < 1 || number > 25) {
      return this.fail("提示数字必须在 1 到 25 之间");
    }

    game.hint.number = number;
    game.turnStage = "members_guess";
    this.addMessage(room, "hint_number", player.id, player.nickname, String(number));
    this.logEvent(room, player.id, "hint.number", { number, team: game.currentTurn, word: game.hint.word });
    this.touchRoom(room);
    this.broadcastRoom(room);
    return { ok: true };
  }

  private sendChat(socket: Socket, roomId: string, text: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    const cleanText = sanitizeChat(text);
    if (!cleanText) {
      return this.fail("消息不能为空");
    }

    this.addMessage(room, "chat", player.id, player.nickname, cleanText);
    this.logEvent(room, player.id, "chat.sent", { text: cleanText });
    this.touchRoom(room);
    this.broadcastRoom(room);
    return { ok: true };
  }

  private previewGuess(socket: Socket, roomId: string, cardId: string | null): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }
    const { room, player } = membership;
    const game = room.game;
    if (!game || room.status !== "playing" || game.turnStage !== "members_guess" || !game.currentTurn) {
      return this.fail("当前不能试选");
    }
    if (player.seat !== game.currentTurn || player.isCaptain || !player.connected) {
      return this.fail("只有当前队队员可以试选");
    }

    if (cardId === null) {
      delete game.previewSelections[player.id];
      delete game.confirmedSelections[player.id];
      this.rebuildCardSelections(room);
      this.touchRoom(room);
      this.broadcastRoom(room);
      return { ok: true };
    }

    if (cardId === "skip") {
      game.previewSelections[player.id] = "skip";
      delete game.confirmedSelections[player.id];
      this.rebuildCardSelections(room);
      this.touchRoom(room);
      this.broadcastRoom(room);
      return { ok: true };
    }

    const card = game.cards.find((value) => value.id === cardId);
    if (!card || card.revealed) {
      return this.fail("这张卡不能被选择");
    }

    game.previewSelections[player.id] = cardId;
    delete game.confirmedSelections[player.id];
    this.rebuildCardSelections(room);
    this.touchRoom(room);
    this.broadcastRoom(room);
    return { ok: true };
  }

  private confirmGuess(socket: Socket, roomId: string, cardId: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }
    const { room, player } = membership;
    const game = room.game;
    if (!game || room.status !== "playing" || game.turnStage !== "members_guess" || !game.currentTurn) {
      return this.fail("当前不能确认猜词");
    }
    if (player.seat !== game.currentTurn || player.isCaptain || !player.connected) {
      return this.fail("只有当前队队员可以确认");
    }

    const activeMembers = this.currentGuessers(room);
    if (activeMembers.length === 0) {
      return this.fail("当前没有在线队员可确认");
    }

    const allSelectedSame = activeMembers.every(m => game.previewSelections[m.id] === cardId);
    if (!allSelectedSame) {
      return this.fail("需要所有队员选择相同才能确认");
    }

    if (cardId === "skip") {
      this.addMessage(room, "system", null, "系统", `${this.teamLabel(game.currentTurn)} 选择了跳过回合`);
      this.endTurn(room);
      this.touchRoom(room);
      this.broadcastRoom(room);
      return { ok: true };
    }

    const card = game.cards.find((value) => value.id === cardId);
    if (!card || card.revealed) {
      return this.fail("这张卡不能被确认");
    }

    this.revealCard(room, cardId);
    this.touchRoom(room);
    this.broadcastRoom(room);
    return { ok: true };
  }

  private revealCard(room: ServerRoom, cardId: string): void {
    const game = room.game!;
    const card = game.cards.find((value) => value.id === cardId);
    if (!card || !game.currentTurn) {
      return;
    }

    card.revealed = true;
    card.revealedAt = nowIso();
    game.guess.confirmedCardId = card.id;
    game.guess.confirmationPlayerIds = this.currentGuessers(room).map((player) => player.id);
    this.logEvent(room, null, "guess.revealed", {
      cardId: card.id,
      word: card.word,
      color: card.color,
      team: game.currentTurn
    });

    game.remainingByColor = this.computeRemainingByColor(game.cards);
    this.clearSelections(game);

    const winner = this.checkColorWin(game);
    if (winner) {
      this.finishGame(room, winner, `${this.teamLabel(winner)} 率先找齐全部词语`);
      return;
    }

    if (card.color === game.currentTurn) {
      game.turnStage = "members_guess";
      this.addMessage(room, "system", null, "系统", `${this.teamLabel(game.currentTurn)} 猜中了自己的词，可以继续猜或跳过`);
      return;
    }

    if (card.color === "black") {
      this.finishGame(room, otherTeam(game.currentTurn), `${this.teamLabel(game.currentTurn)} 猜到了黑词`);
      return;
    }

    if (card.color === "white") {
      this.addMessage(room, "system", null, "系统", `翻到平民，轮到 ${this.teamLabel(otherTeam(game.currentTurn))}`);
      this.endTurn(room);
      return;
    }

    this.addMessage(room, "system", null, "系统", `翻到了对方颜色，轮到 ${this.teamLabel(card.color)}`);
    const opponentWinner = this.checkColorWin(game);
    if (opponentWinner) {
      this.finishGame(room, opponentWinner, `${this.teamLabel(opponentWinner)} 率先找齐全部词语`);
      return;
    }
    this.endTurn(room);
  }

  private voteContinue(socket: Socket, roomId: string, vote: ContinueVote): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }
    const { room, player } = membership;
    const game = room.game;
    if (!game || room.status !== "playing" || game.turnStage !== "continue_vote" || !game.currentTurn) {
      return this.fail("当前不能投票");
    }
    if (player.seat !== game.currentTurn || player.isCaptain || !player.connected) {
      return this.fail("只有当前队队员可以投票");
    }

    game.guess.continueVotes[player.id] = vote;
    const activeMembers = this.currentGuessers(room);
    const votes = unique(
      activeMembers
        .map((member) => game.guess.continueVotes[member.id])
        .filter((value): value is ContinueVote => Boolean(value))
    );

    if (votes.length === 1 && activeMembers.every((member) => game.guess.continueVotes[member.id] === votes[0])) {
      if (votes[0] === "continue") {
        game.turnStage = "members_guess";
        game.guess = {
          confirmedCardId: null,
          confirmationPlayerIds: [],
          continueVotes: {}
        };
        this.addMessage(room, "system", null, "系统", `${this.teamLabel(game.currentTurn)} 选择继续猜`);
      } else {
        this.addMessage(room, "system", null, "系统", `${this.teamLabel(game.currentTurn)} 选择结束本回合`);
        this.endTurn(room);
      }
    }

    this.touchRoom(room);
    this.broadcastRoom(room);
    return { ok: true };
  }

  private requestRematch(socket: Socket, roomId: string): AckResponse {
    const membership = this.requireMembership(socket.id, roomId);
    if (!membership.ok) {
      return membership;
    }

    const { room, player } = membership;
    if (room.status !== "ended") {
      return this.fail("只有结束后才能再来一局");
    }

    room.status = "waiting";
    room.game = null;
    room.players.forEach((roomPlayer) => {
      roomPlayer.ready = false;
      roomPlayer.isCaptain = false;
    });
    this.addMessage(room, "system", null, "系统", `${player.nickname} 发起了再来一局`);
    this.logEvent(room, player.id, "game.rematch_requested", {});
    this.touchRoom(room);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  private finishGame(room: ServerRoom, winner: TeamSide, reason: string): void {
    const game = room.game!;
    game.status = "ended";
    game.winner = winner;
    game.winnerReason = reason;
    game.turnStage = null;
    room.status = "ended";
    this.addMessage(room, "system", null, "系统", `${this.teamLabel(winner)} 获胜：${reason}`);
    this.logEvent(room, null, "game.ended", { winner, reason });
  }

  private endTurn(room: ServerRoom): void {
    const game = room.game!;
    game.currentTurn = otherTeam(game.currentTurn!);
    game.turnStage = "captain_hint";
    game.hint = {
      word: null,
      number: null,
      captainId: null
    };
    game.guess = {
      confirmedCardId: null,
      confirmationPlayerIds: [],
      continueVotes: {}
    };
    this.clearSelections(game);
    this.logEvent(room, null, "turn.changed", { currentTurn: game.currentTurn });
  }

  private currentGuessers(room: ServerRoom): ServerPlayer[] {
    const game = room.game;
    if (!game || !game.currentTurn) {
      return [];
    }

    return room.players.filter(
      (player) => player.seat === game.currentTurn && !player.isCaptain && player.connected
    );
  }

  private clearSelections(game: ServerGame): void {
    game.previewSelections = {};
    game.confirmedSelections = {};
    game.cards.forEach((card) => {
      card.previewPlayerIds = [];
      card.previewNicknames = [];
    });
    game.guess.confirmedCardId = null;
    game.guess.confirmationPlayerIds = [];
    game.guess.continueVotes = {};
    game.guess.skipPreviewPlayerIds = [];
    game.guess.skipPreviewNicknames = [];
  }

  private rebuildCardSelections(room: ServerRoom): void {
    const game = room.game;
    if (!game) {
      return;
    }

    const playerMap = new Map(room.players.map((player) => [player.id, player]));
    game.cards.forEach((card) => {
      const previewPlayerIds = Object.entries(game.previewSelections)
        .filter(([, selectedCardId]) => selectedCardId === card.id)
        .map(([playerId]) => playerId);
      card.previewPlayerIds = previewPlayerIds;
      card.previewNicknames = previewPlayerIds
        .map((playerId) => playerMap.get(playerId)?.nickname)
        .filter((value): value is string => Boolean(value));
    });

    const skipPreviewPlayerIds = Object.entries(game.previewSelections)
      .filter(([, selectedCardId]) => selectedCardId === "skip")
      .map(([playerId]) => playerId);
    game.guess.skipPreviewPlayerIds = skipPreviewPlayerIds;
    game.guess.skipPreviewNicknames = skipPreviewPlayerIds
      .map((playerId) => playerMap.get(playerId)?.nickname)
      .filter((value): value is string => Boolean(value));
  }

  private handleDisconnect(socketId: string): void {
    const membership = this.socketToMembership.get(socketId);
    if (!membership) {
      return;
    }

    const room = this.rooms.get(membership.roomId);
    if (!room) {
      return;
    }

    const player = room.players.find((roomPlayer) => roomPlayer.id === membership.playerId);
    if (!player) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    player.lastSeenAt = nowIso();
    this.socketToMembership.delete(socketId);
    this.addMessage(room, "system", null, "系统", `${player.nickname} 暂时离线`);
    this.logEvent(room, player.id, "player.disconnected", {});
    
    // Cleanup room if everyone is disconnected
    const allDisconnected = room.players.every(p => !p.connected);
    if (allDisconnected) {
      this.rooms.delete(room.id);
      this.logEvent(room, null, "room.destroyed", { reason: "all_disconnected" });
    } else {
      this.touchRoom(room);
      this.broadcastRoom(room);
    }
    
    this.broadcastLobby();
  }

  private requireMembership(socketId: string, roomId: string):
    | { ok: true; room: ServerRoom; player: ServerPlayer }
    | { ok: false; error: string } {
    const normalizedRoomId = roomId.trim().toUpperCase();
    const membership = this.socketToMembership.get(socketId);
    if (!membership || membership.roomId !== normalizedRoomId) {
      return this.fail("请先加入房间");
    }
    const room = this.rooms.get(normalizedRoomId);
    if (!room) {
      return this.fail("房间不存在");
    }
    const player = room.players.find((roomPlayer) => roomPlayer.id === membership.playerId);
    if (!player) {
      return this.fail("玩家不存在");
    }
    return { ok: true, room, player };
  }

  private fail(error: string): { ok: false; error: string } {
    return { ok: false, error };
  }

  private teamLabel(team: TeamSide): string {
    return team === "red" ? "红队" : "蓝队";
  }

  private hasCharacterOverlap(word: string, boardWords: string[]): boolean {
    const letters = new Set(Array.from(word));
    return boardWords.some((boardWord) => Array.from(boardWord).some((letter) => letters.has(letter)));
  }

  private checkColorWin(game: ServerGame): TeamSide | null {
    if (game.remainingByColor.red === 0) {
      return "red";
    }
    if (game.remainingByColor.blue === 0) {
      return "blue";
    }
    return null;
  }

  private computeRemainingByColor(cards: ServerCard[]): Record<CardColor, number> {
    return cards.reduce<Record<CardColor, number>>(
      (result, card) => {
        if (!card.revealed) {
          result[card.color] += 1;
        }
        return result;
      },
      {
        red: 0,
        blue: 0,
        black: 0,
        white: 0
      }
    );
  }

  private shuffledIndexes(length: number): number[] {
    const indexes = Array.from({ length }, (_, index) => index);
    for (let index = indexes.length - 1; index > 0; index -= 1) {
      const otherIndex = Math.floor(Math.random() * (index + 1));
      [indexes[index], indexes[otherIndex]] = [indexes[otherIndex], indexes[index]];
    }
    return indexes;
  }

  private drawUniqueWords(count: number, excluded: Set<string>): string[] {
    const available = this.vocabulary.filter((word) => !excluded.has(word));
    if (available.length < count) {
      throw new Error("词库不足以提供不重复词语");
    }

    const indexes = this.shuffledIndexes(available.length).slice(0, count);
    return indexes.map((index) => available[index]);
  }

  private createRoomId(): string {
    let roomId = randomId("", 6);
    while (this.rooms.has(roomId)) {
      roomId = randomId("", 6);
    }
    return roomId;
  }

  private ensureUniqueNickname(room: ServerRoom, desiredNickname: string, playerId?: string): string {
    const existingNames = new Set(
      room.players
        .filter((player) => player.id !== playerId)
        .map((player) => player.nickname)
    );

    if (!existingNames.has(desiredNickname)) {
      return desiredNickname;
    }

    let suffix = 2;
    let candidate = `${desiredNickname}(${suffix})`;
    while (existingNames.has(candidate)) {
      suffix += 1;
      candidate = `${desiredNickname}(${suffix})`;
    }
    return candidate;
  }

  private syncPlayerNames(room: ServerRoom): void {
    const game = room.game;
    if (!game) {
      return;
    }
    this.rebuildCardSelections(room);
  }

  private addMessage(
    room: ServerRoom,
    kind: ChatKind,
    playerId: string | null,
    nickname: string,
    text: string,
    meta?: Record<string, unknown>
  ): void {
    room.messages.push({
      id: randomId("MSG_", 10),
      kind,
      playerId,
      nickname,
      text,
      createdAt: nowIso(),
      meta
    });
    if (room.messages.length > 300) {
      room.messages = room.messages.slice(-300);
    }
  }

  private broadcastRoom(room: ServerRoom): void {
    room.players
      .filter((player) => player.socketId)
      .forEach((player) => {
        const socketId = player.socketId!;
        this.io.to(socketId).emit("room:snapshot", this.buildRoomSnapshot(room, player.id));
      });
  }

  private buildRoomSnapshot(room: ServerRoom, viewerPlayerId: string): RoomSnapshot {
    const viewer = room.players.find((player) => player.id === viewerPlayerId) ?? null;
    const viewerRole = this.getViewerRole(room, viewer);
    return {
      room: this.buildRoomSummary(room),
      selfPlayerId: viewer?.id ?? null,
      selfViewerRole: viewerRole,
      players: room.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        seat: player.seat,
        ready: player.ready,
        connected: player.connected,
        isCaptain: player.isCaptain,
        joinedAt: player.joinedAt,
        lastSeenAt: player.lastSeenAt
      })),
      game: room.game ? this.buildGameSnapshot(room.game, viewerRole) : null,
      messages: room.messages
    };
  }

  private buildGameSnapshot(game: ServerGame, viewerRole: ViewerRole | null): GameSnapshot {
    const canSeeAnswers =
      viewerRole === "red_captain" || viewerRole === "blue_captain" || viewerRole === "spectator";

    return {
      id: game.id,
      status: game.status,
      currentTurn: game.currentTurn,
      firstTeam: game.firstTeam,
      secondTeam: game.secondTeam,
      turnStage: game.turnStage,
      cards: game.cards.map((card) => ({
        id: card.id,
        word: card.word,
        color: card.revealed || canSeeAnswers ? card.color : null,
        revealed: card.revealed,
        locked: card.locked,
        revealedAt: card.revealedAt,
        previewPlayerIds: card.previewPlayerIds,
        previewNicknames: card.previewNicknames
      })),
      captains: game.captains,
      remainingByColor: game.remainingByColor,
      draft: game.draft ? { ...game.draft } : null,
      hint: { ...game.hint },
      guess: {
        confirmedCardId: game.guess.confirmedCardId,
        confirmationPlayerIds: [...game.guess.confirmationPlayerIds],
        continueVotes: { ...game.guess.continueVotes },
        skipPreviewPlayerIds: game.guess.skipPreviewPlayerIds ? [...game.guess.skipPreviewPlayerIds] : [],
        skipPreviewNicknames: game.guess.skipPreviewNicknames ? [...game.guess.skipPreviewNicknames] : []
      },
      winner: game.winner,
      winnerReason: game.winnerReason,
      createdAt: game.createdAt
    };
  }

  private getViewerRole(room: ServerRoom, viewer: ServerPlayer | null): ViewerRole | null {
    if (!viewer) {
      return null;
    }
    if (viewer.seat === "spectator") {
      return "spectator";
    }
    if (viewer.seat === "red") {
      return viewer.isCaptain ? "red_captain" : "red_member";
    }
    return viewer.isCaptain ? "blue_captain" : "blue_member";
  }

  private buildRoomSummary(room: ServerRoom): RoomSummary {
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      playerCount: room.players.length,
      connectedCount: room.players.filter((player) => player.connected).length,
      redCount: room.players.filter((player) => player.seat === "red").length,
      blueCount: room.players.filter((player) => player.seat === "blue").length,
      spectatorCount: room.players.filter((player) => player.seat === "spectator").length,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    };
  }

  private touchRoom(room: ServerRoom): void {
    room.updatedAt = nowIso();
  }

  private getLobbySnapshot(): RoomSummary[] {
    return Array.from(this.rooms.values())
      .map((room) => this.buildRoomSummary(room))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private broadcastLobby(): void {
    this.io.emit("lobby:snapshot", this.getLobbySnapshot());
  }

  private logEvent(room: ServerRoom, actorPlayerId: string | null, type: string, payload: Record<string, unknown>): void {
    const gameId = room.game?.id ?? null;
    const event: LogEvent = {
      id: randomId("LOG_", 10),
      roomId: room.id,
      gameId,
      actorPlayerId,
      type,
      createdAt: nowIso(),
      payload
    };
    const roomDir = path.join(this.logsDir, room.id);
    fs.mkdirSync(roomDir, { recursive: true });
    const logFile = path.join(roomDir, `${gameId ?? "room"}.jsonl`);
    fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`, "utf8");
  }

  private loadVocabulary(): string[] {
    const vocabularyPath = path.resolve(process.cwd(), "server", "data", "vocabulary.json");
    const raw = fs.readFileSync(vocabularyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Vocabulary file must be a JSON array");
    }

    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }
}

function isTeamReady(room: ServerRoom): boolean {
  const redPlayers = room.players.filter((player) => player.seat === "red");
  const bluePlayers = room.players.filter((player) => player.seat === "blue");
  if (redPlayers.length < 2 || bluePlayers.length < 2) {
    return false;
  }

  return room.players
    .filter((player) => player.seat !== "spectator")
    .every((player) => player.ready);
}
