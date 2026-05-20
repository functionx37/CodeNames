export type SeatSide = "red" | "blue" | "spectator";
export type TeamSide = "red" | "blue";
export type RoomStatus = "waiting" | "draft" | "assigning" | "playing" | "ended";
export type TurnStage = "captain_hint" | "members_guess" | "continue_vote";
export type CardColor = "red" | "blue" | "black" | "white";
export type ViewerRole = "red_captain" | "blue_captain" | "red_member" | "blue_member" | "spectator";
export type RevealOutcome = "correct" | "opponent" | "neutral" | "black" | "win";
export type ContinueVote = "continue" | "stop";
export type ChatKind = "chat" | "hint_word" | "hint_number" | "invalid_hint" | "system";

export interface PlayerSummary {
  id: string;
  nickname: string;
  seat: SeatSide;
  ready: boolean;
  connected: boolean;
  isCaptain: boolean;
  joinedAt: string;
  lastSeenAt: string;
}

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  playerId: string | null;
  nickname: string;
  text: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

export interface CardView {
  id: string;
  word: string;
  color: CardColor | null;
  revealed: boolean;
  locked: boolean;
  revealedAt: string | null;
  previewPlayerIds: string[];
  previewNicknames: string[];
}

export interface HintState {
  word: string | null;
  number: number | null;
  captainId: string | null;
}

export interface GuessState {
  confirmedCardId: string | null;
  confirmationPlayerIds: string[];
  continueVotes: Record<string, ContinueVote>;
  skipPreviewPlayerIds?: string[];
  skipPreviewNicknames?: string[];
}

export interface DraftState {
  round: number;
  totalRounds: number;
  currentCaptainSide: TeamSide;
  replacementsUsed: number;
}

export interface GameSnapshot {
  id: string;
  status: RoomStatus;
  currentTurn: TeamSide | null;
  firstTeam: TeamSide | null;
  secondTeam: TeamSide | null;
  turnStage: TurnStage | null;
  cards: CardView[];
  captains: Record<TeamSide, string | null>;
  remainingByColor: Record<CardColor, number>;
  draft: DraftState | null;
  hint: HintState;
  guess: GuessState;
  winner: TeamSide | null;
  winnerReason: string | null;
  createdAt: string;
}

export interface RoomSummary {
  id: string;
  name: string;
  status: RoomStatus;
  playerCount: number;
  connectedCount: number;
  redCount: number;
  blueCount: number;
  spectatorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomSnapshot {
  room: RoomSummary;
  selfPlayerId: string | null;
  selfViewerRole: ViewerRole | null;
  players: PlayerSummary[];
  game: GameSnapshot | null;
  messages: ChatMessage[];
}

export interface LogEvent {
  id: string;
  roomId: string;
  gameId: string | null;
  actorPlayerId: string | null;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
}
