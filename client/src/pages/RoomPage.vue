<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { CardView, ContinueVote, PlayerSummary, SeatSide } from "@shared/types";
import BoardCard from "../components/BoardCard.vue";
import {
  appState,
  confirmGuess,
  joinRoom,
  leaveRoom,
  previewGuess,
  rematch,
  replaceDraftCard,
  roomMessages,
  sendChat,
  setReady,
  setSeat,
  startGame,
  submitHintNumber,
  submitHintWord,
  voteTurn
} from "../lib/api";

const route = useRoute();
const router = useRouter();
const roomId = computed(() => String(route.params.roomId || "").toUpperCase());
const currentRoomId = ref<string>(roomId.value);
const hintWord = ref("");
const hintNumber = ref(1);
const chatText = ref("");
const selectedCardId = ref<string | null>(null);

onMounted(async () => {
  currentRoomId.value = roomId.value;
  const response = await joinRoom(roomId.value);
  if (!response.ok) {
    await router.push("/");
  }
});

onUnmounted(() => {
  if (currentRoomId.value) {
    leaveRoom(currentRoomId.value);
  }
});

async function onLeaveRoom() {
  if (currentRoomId.value) {
    await leaveRoom(currentRoomId.value);
  }
  await router.push("/");
}

watch(
  () => appState.currentRoom?.selfPlayerId,
  () => {
    selectedCardId.value = null;
  }
);

const snapshot = computed(() => appState.currentRoom);
const room = computed(() => snapshot.value?.room ?? null);
const players = computed(() => snapshot.value?.players ?? []);
const game = computed(() => snapshot.value?.game ?? null);
const self = computed(() => players.value.find((player) => player.id === snapshot.value?.selfPlayerId) ?? null);
const messages = computed(() => roomMessages());
const roomLink = computed(() => `${window.location.origin}${import.meta.env.BASE_URL}room/${roomId.value}`);
const redPlayers = computed(() => players.value.filter((player) => player.seat === "red"));
const bluePlayers = computed(() => players.value.filter((player) => player.seat === "blue"));
const spectatorPlayers = computed(() => players.value.filter((player) => player.seat === "spectator"));

const canStart = computed(() => {
  if (!room.value || room.value.status !== "waiting") {
    return false;
  }
  if (redPlayers.value.length < 2 || bluePlayers.value.length < 2) {
    return false;
  }
  return players.value.filter((player) => player.seat !== "spectator").every((player) => player.ready);
});

const currentCaptainId = computed(() => {
  if (room.value?.status === "draft") {
    const currentSide = game.value?.draft?.currentCaptainSide;
    if (!currentSide) return null;
    return game.value?.captains[currentSide] ?? null;
  }
  const currentTurn = game.value?.currentTurn;
  if (!currentTurn) {
    return null;
  }
  return game.value?.captains[currentTurn] ?? null;
});

const isCurrentCaptain = computed(() => self.value?.id === currentCaptainId.value);
const isCurrentMember = computed(() => {
  if (!self.value || !game.value?.currentTurn) {
    return false;
  }
  return self.value.seat === game.value.currentTurn && !self.value.isCaptain && self.value.connected;
});

const onlineGuessers = computed(() => {
  if (!game.value?.currentTurn) {
    return [];
  }
  return players.value.filter(
    (player) => player.seat === game.value?.currentTurn && !player.isCaptain && player.connected
  );
});

const canSelectCards = computed(() => Boolean(game.value && game.value.turnStage === "members_guess" && isCurrentMember.value));
const canVoteContinue = computed(() => Boolean(game.value && game.value.turnStage === "continue_vote" && isCurrentMember.value));

function playerLabel(player: PlayerSummary): string {
  return player.nickname;
}

function seatName(seat: SeatSide): string {
  if (seat === "red") {
    return "红方";
  }
  if (seat === "blue") {
    return "蓝方";
  }
  return "旁观";
}

function stageText(): string {
  if (!room.value) {
    return "";
  }
  if (!game.value) {
    return room.value.status;
  }
  if (room.value.status === "draft" && game.value.draft) {
    const currentSide = game.value.draft.currentCaptainSide;
    const teamClass = currentSide === "red" ? "team-red" : "team-blue";
    const teamName = currentSide === "red" ? "红队" : "蓝队";
    return `<span class="${teamClass}">换词第 ${game.value.draft.round} / ${game.value.draft.totalRounds} 轮，当前 ${teamName} 队长操作</span>`;
  }
  if (room.value.status === "playing") {
    const turn = game.value.currentTurn === "red" ? "红队" : "蓝队";
    return `${turn} · ${game.value.turnStage}`;
  }
  if (room.value.status === "ended") {
    return game.value.winnerReason || "已结束";
  }
  return room.value.status;
}

function cardSelectable(card: CardView): boolean {
  if (room.value?.status === "draft") {
    return isCurrentCaptain.value && !card.locked;
  }
  if (canSelectCards.value) {
    return !card.revealed;
  }
  return false;
}

async function onSeatChange(seat: SeatSide): Promise<void> {
  if (!room.value || !self.value) {
    return;
  }
  // Toggle off if clicking the same seat (unless clicking spectator)
  if (self.value.seat === seat && seat !== 'spectator') {
    return;
  } else {
    await setSeat(room.value.id, seat);
  }
}

async function onReadyToggle(): Promise<void> {
  if (!room.value || !self.value) {
    return;
  }
  await setReady(room.value.id, !self.value.ready);
}

async function onStartGame(): Promise<void> {
  if (!room.value) {
    return;
  }
  await startGame(room.value.id);
}

async function onCardSelect(cardId: string): Promise<void> {
  if (!room.value || !game.value) {
    return;
  }
  if (room.value.status === "draft") {
    if (isCurrentCaptain.value) {
      const card = game.value.cards.find(c => c.id === cardId);
      if (card && !card.locked) {
        selectedCardId.value = cardId;
      }
    }
    return;
  }
  selectedCardId.value = cardId;
  if (canSelectCards.value) {
    await previewGuess(room.value.id, cardId);
  }
}

async function onReplaceDraftCard(): Promise<void> {
  if (!room.value || !selectedCardId.value) {
    return;
  }
  await replaceDraftCard(room.value.id, selectedCardId.value);
  selectedCardId.value = null;
}

async function onConfirmGuess(): Promise<void> {
  if (!room.value || !selectedCardId.value) {
    return;
  }
  await confirmGuess(room.value.id, selectedCardId.value);
}

async function onClearGuess(): Promise<void> {
  if (!room.value) {
    return;
  }
  selectedCardId.value = null;
  await previewGuess(room.value.id, null);
}

async function onSendHintWord(): Promise<void> {
  if (!room.value || !hintWord.value.trim()) {
    return;
  }
  await submitHintWord(room.value.id, hintWord.value.trim());
}

async function onSendHintNumber(): Promise<void> {
  if (!room.value) {
    return;
  }
  await submitHintNumber(room.value.id, hintNumber.value);
}

async function onSendChat(): Promise<void> {
  if (!room.value || !chatText.value.trim()) {
    return;
  }
  await sendChat(room.value.id, chatText.value.trim());
  chatText.value = "";
}

async function onVote(vote: ContinueVote): Promise<void> {
  if (!room.value) {
    return;
  }
  await voteTurn(room.value.id, vote);
}

async function onRematch(): Promise<void> {
  if (!room.value) {
    return;
  }
  await rematch(room.value.id);
}

async function copyInvite(): Promise<void> {
  await navigator.clipboard.writeText(roomLink.value);
}
</script>

<template>
  <main v-if="room && snapshot" class="page room-shell">
    <section class="topbar">
      <div class="topbar-info">
        <h1>房间 {{ room.id }}</h1>
        <div class="topbar-meta">
          <span v-if="room.status !== 'waiting'" class="status-pill" :data-status="room.status" v-html="stageText()"></span>
        </div>
      </div>

      <div class="topbar-actions">
        <button class="secondary" @click="copyInvite">复制邀请链接</button>
        <button class="secondary link-button" @click="onLeaveRoom">返回大厅</button>
      </div>
    </section>

    <section v-if="room.status === 'waiting'" class="prep-view">
      <div class="prep-teams">
        <div class="panel team-card red-team" :class="{ 'joined-team-red': self?.seat === 'red' }" @click="onSeatChange('red')">
          <div class="team-header">
            <h2 class="team-red">红队</h2>
          </div>
          <ul class="player-list large-list red-list">
            <li v-for="player in redPlayers" :key="player.id">
                <div class="name-wrapper-container">
                  <div class="name-wrapper">
                    <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ playerLabel(player) }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="{ ready: player.ready }">{{ player.ready ? '已准备' : '未准备' }}</span>
              </li>
          </ul>
        </div>

        <div class="panel center-prep">
          <div class="prep-actions">
            <button v-if="self && self.seat !== 'spectator'" class="primary wide" @click="onReadyToggle">
              {{ self.ready ? "取消准备" : "准备" }}
            </button>
            <button class="primary wide start-btn" :disabled="!canStart" @click="onStartGame">
              开始游戏
            </button>
          </div>

          <div class="panel spectator-section" :class="{ 'joined-team-gray': self?.seat === 'spectator' }" @click="onSeatChange('spectator')">
            <div class="team-header">
              <h3>旁观者</h3>
            </div>
            <ul class="player-list spectator-list">
              <li v-for="player in spectatorPlayers" :key="player.id">
                <div class="name-wrapper-container">
                  <div class="name-wrapper">
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ player.nickname }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div class="panel team-card blue-team" :class="{ 'joined-team-blue': self?.seat === 'blue' }" @click="onSeatChange('blue')">
          <div class="team-header">
            <h2 class="team-blue">蓝队</h2>
          </div>
          <ul class="player-list large-list blue-list">
            <li v-for="player in bluePlayers" :key="player.id">
                <div class="name-wrapper-container">
                  <div class="name-wrapper">
                    <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ playerLabel(player) }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="{ ready: player.ready }">{{ player.ready ? '已准备' : '未准备' }}</span>
              </li>
          </ul>
        </div>
      </div>
    </section>

    <section v-else class="grid-3">
      <aside class="panel">
        <div class="section-head">
          <h2>玩家</h2>
          <span>{{ players.length }} 人</span>
        </div>

        <button v-if="room.status === 'ended'" class="primary wide" @click="onRematch">再来一局</button>

        <div class="team-columns">
          <div>
            <h3 class="team-red" style="text-align:center; margin-bottom: 0.5rem;">红方</h3>
            <ul class="player-list large-list red-list">
              <li v-for="player in redPlayers" :key="player.id">
                <div class="name-wrapper-container">
                  <div class="name-wrapper">
                    <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ playerLabel(player) }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="{ offline: !player.connected }">{{ player.connected ? "在线" : "离线" }}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3 class="team-blue" style="text-align:center; margin-bottom: 0.5rem;">蓝方</h3>
            <ul class="player-list large-list blue-list">
              <li v-for="player in bluePlayers" :key="player.id">
                <div class="name-wrapper-container">
                  <div class="name-wrapper">
                    <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ playerLabel(player) }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="{ offline: !player.connected }">{{ player.connected ? "在线" : "离线" }}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3 style="text-align:center; margin-bottom: 0.5rem;">旁观</h3>
            <ul class="player-list spectator-list">
              <li v-for="player in spectatorPlayers" :key="player.id">
                <div class="name-wrapper-container">
                  <div class="name-wrapper">
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ player.nickname }}</span>
                  </div>
                </div>
                <span class="status-pill" :class="{ offline: !player.connected }">{{ player.connected ? "在线" : "离线" }}</span>
              </li>
            </ul>
          </div>
        </div>
      </aside>

      <section class="panel board-panel" style="grid-column: span 2;">
        <div class="section-head">
          <h2>词语板</h2>
          <span v-if="game">{{ game.currentTurn ? (game.currentTurn === "red" ? "红队回合" : "蓝队回合") : room.status }}</span>
        </div>


        <div class="board-grid">
          <BoardCard
            v-for="card in game?.cards ?? []"
            :key="card.id"
            :card="card"
            :selectable="cardSelectable(card)"
            :selected="selectedCardId === card.id"
            @select="onCardSelect"
          />
        </div>

        <div v-if="room.status === 'draft' && isCurrentCaptain" class="inline-actions">
          <button class="primary" :disabled="!selectedCardId" @click="onReplaceDraftCard">更换当前词语</button>
        </div>

        <div v-if="game?.turnStage === 'members_guess' && canSelectCards" class="inline-actions">
          <button class="secondary" :disabled="!selectedCardId" @click="onConfirmGuess">确认当前选择</button>
          <button class="secondary" @click="onClearGuess">清除试选</button>
        </div>

        <div v-if="game?.turnStage === 'continue_vote' && canVoteContinue" class="inline-actions">
          <button class="primary" @click="onVote('continue')">继续猜</button>
          <button class="secondary" @click="onVote('stop')">放弃回合</button>
        </div>
      </section>


    </section>
  </main>
</template>
