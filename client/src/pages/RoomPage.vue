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
const customNumber = ref<number | "">("");
const selectedNumber = ref<number | null>(null);
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

const canConfirmGuess = computed(() => {
  if (!game.value || !isCurrentMember.value) return false;
  if (onlineGuessers.value.length === 0) return false;
  
  if (selectedCardId.value === "skip") {
    // skip button allows confirmation if all online guessers selected skip
    return game.value.guess.skipPreviewPlayerIds && game.value.guess.skipPreviewPlayerIds.length === onlineGuessers.value.length;
  }
  
  if (!selectedCardId.value) return false;
  
  const card = game.value.cards.find(c => c.id === selectedCardId.value);
  if (!card) return false;
  
  return card.previewPlayerIds.length === onlineGuessers.value.length;
});

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
    const currentTurn = game.value.currentTurn;
    if (!currentTurn) return "";
    const turn = currentTurn === "red" ? "红队" : "蓝队";
    const teamClass = currentTurn === "red" ? "team-red" : "team-blue";
    let stageName = game.value.turnStage;
    if (stageName === "captain_hint") {
      stageName = "提示阶段";
    } else if (stageName === "members_guess") {
      stageName = "猜词阶段";
    } else if (stageName === "continue_vote") {
      stageName = "决定是否继续";
    }
    return `<span class="${teamClass}">${turn} · ${stageName}</span>`;
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
  if (canSelectCards.value) {
    if (selectedCardId.value === cardId) {
      selectedCardId.value = null;
      await previewGuess(room.value.id, null);
    } else {
      selectedCardId.value = cardId;
      await previewGuess(room.value.id, cardId);
    }
  }
}

async function onSkipGuess(): Promise<void> {
  if (!room.value || !game.value) return;
  if (canSelectCards.value) {
    if (selectedCardId.value === "skip") {
      selectedCardId.value = null;
      await previewGuess(room.value.id, null);
    } else {
      selectedCardId.value = "skip";
      await previewGuess(room.value.id, "skip");
    }
  }
}

async function onReplaceDraftCard(): Promise<void> {
  if (!room.value || !selectedCardId.value) {
    return;
  }
  await replaceDraftCard(room.value.id, selectedCardId.value);
  selectedCardId.value = null;
}

async function onSkipDraftReplace(): Promise<void> {
  if (!room.value) {
    return;
  }
  await replaceDraftCard(room.value.id, "skip");
  selectedCardId.value = null;
}

async function onConfirmGuess(): Promise<void> {
  if (!room.value || !selectedCardId.value) {
    return;
  }
  await confirmGuess(room.value.id, selectedCardId.value);
  if (selectedCardId.value === "skip") {
    selectedCardId.value = null;
    await previewGuess(room.value.id, null);
  } else {
    selectedCardId.value = null;
  }
}

function selectNumber(n: number) {
  selectedNumber.value = n;
  customNumber.value = "";
}

async function onConfirmHint() {
  if (!room.value || !game.value) return;
  const word = hintWord.value.trim();
  if (!word) {
    appState.lastError = "请输入提示词";
    return;
  }
  
  // local overlap check
  const boardWords = game.value.cards.map(c => c.word);
  const letters = new Set(Array.from(word));
  let hasOverlap = false;
  for (const bw of boardWords) {
    const bwLetters = new Set(Array.from(bw));
    let overlap = false;
    for (const l of letters) {
      if (bwLetters.has(l)) {
        overlap = true;
        break;
      }
    }
    if (overlap) {
      hasOverlap = true;
      break;
    }
  }
  
  if (hasOverlap) {
    hintWord.value = "";
    appState.lastError = "提示词不能包含面板词语的字符";
    return;
  }
  
  const num = selectedNumber.value || (typeof customNumber.value === 'number' ? customNumber.value : 0);
  if (num < 1 || num > 25 || !Number.isInteger(num)) {
    appState.lastError = "请输入有效的数字 (1-25)";
    return;
  }
  
  appState.lastError = "";
  const res1 = await submitHintWord(room.value.id, word);
  if (!res1.ok) return;
  const res2 = await submitHintNumber(room.value.id, num);
  if (!res2.ok) return;
  
  hintWord.value = "";
  selectedNumber.value = null;
  customNumber.value = "";
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
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ playerLabel(player) }}</span>
                    <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-left: 4px; margin-right: 0;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
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
                    <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                    <span>{{ playerLabel(player) }}</span>
                    <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-left: 4px; margin-right: 0;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
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
        <template v-if="room.status !== 'playing'">
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
                      <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                      <span>{{ playerLabel(player) }}</span>
                      <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-left: 4px; margin-right: 0;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
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
                      <svg v-if="player.id === self?.id" class="me-indicator" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
                      <span>{{ playerLabel(player) }}</span>
                      <svg v-if="player.isCaptain" class="me-indicator" style="color: #fbbf24; opacity: 1; margin-left: 4px; margin-right: 0;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2 19h20v2H2v-2zm2-14l3 5 5-7 5 7 3-5v10H4V5z"/></svg>
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
        </template>
        <template v-else>
          <div class="section-head">
            <h2>队伍提示</h2>
          </div>
          
          <div v-if="game?.turnStage === 'captain_hint' && isCurrentCaptain" class="hint-form">
            <label class="field">
              <span>提示词</span>
              <input v-model="hintWord" maxlength="20" placeholder="请输入一个词语" />
            </label>
            <div class="field">
              <span>提示数字</span>
              <div class="number-grid">
                <button v-for="n in 5" :key="n" 
                        class="number-btn" :class="{ active: selectedNumber === n }"
                        @click="selectNumber(n)">{{ n }}</button>
                <input type="number" min="6" max="25" class="number-input" 
                       v-model="customNumber" 
                       @focus="selectedNumber = null"
                       placeholder="自定义" />
              </div>
            </div>
            <button class="primary wide" style="margin-top: 1rem;" @click="onConfirmHint">发送提示</button>
            <p v-if="appState.lastError" class="error-line" style="margin-top: 0.5rem;">{{ appState.lastError }}</p>
          </div>
          
          <div v-else-if="game?.turnStage === 'captain_hint' && !isCurrentCaptain" class="hint-waiting">
            <p class="muted" style="text-align: center; padding: 2rem 0;">等待当前队长给出提示...</p>
          </div>
          
          <div v-else class="hint-display">
            <p style="font-size: 1.1rem; text-align: center; padding: 1.5rem 0; background: rgba(22,22,22,0.03); border-radius: 12px;">
              当前提示：
              <strong style="font-size: 1.3rem;">{{ game?.hint.word }}</strong>
              <span> / {{ game?.hint.number }}</span>
            </p>
          </div>
        </template>
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
            :isCaptain="Boolean(self?.isCaptain && room.status === 'playing')"
            :currentTurn="game?.currentTurn"
            @select="onCardSelect"
          />
        </div>

        <div v-if="room.status === 'draft' && isCurrentCaptain" class="inline-actions">
          <button class="primary" :disabled="!selectedCardId" @click="onReplaceDraftCard">更换当前词语</button>
          <button class="secondary" @click="onSkipDraftReplace">跳过并交给对方</button>
        </div>

        <div v-if="game?.turnStage === 'members_guess' && canSelectCards" class="inline-actions">
          <button class="primary" :disabled="!canConfirmGuess" @click="onConfirmGuess">
            确认{{ selectedCardId === 'skip' ? '跳过' : '选择' }}
          </button>
          <button 
            class="secondary" 
            style="position: relative;"
            :class="{
              [`preview-border-${game?.currentTurn}`]: game?.guess.skipPreviewNicknames?.length || selectedCardId === 'skip',
              'selected-skip': selectedCardId === 'skip'
            }" 
            @click="onSkipGuess"
          >
            跳过回合
            <div v-if="game?.guess.skipPreviewNicknames?.length" class="preview-tags">
              <span v-for="name in game.guess.skipPreviewNicknames" :key="name" class="preview-tag" :class="`tag-${game.currentTurn}`">
                {{ name }}
              </span>
            </div>
          </button>
        </div>
      </section>


    </section>
  </main>
</template>
