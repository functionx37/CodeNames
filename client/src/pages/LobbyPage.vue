<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { appState, createRoom, joinRoom, subscribeToLobby } from "../lib/api";

const router = useRouter();
const joinId = ref("");
const creating = ref(false);
const showJoinDialog = ref(false);

subscribeToLobby();

const rooms = computed(() => appState.lobby);

async function onCreateRoom(): Promise<void> {
  creating.value = true;
  const response = await createRoom("游戏房间");
  creating.value = false;
  if (response.ok && response.roomId) {
    await router.push(`/room/${response.roomId}`);
  }
}

async function onJoinRoom(roomId: string): Promise<void> {
  const normalized = roomId.trim().toUpperCase();
  if (!normalized) {
    return;
  }
  const response = await joinRoom(normalized);
  if (response.ok && response.roomId) {
    showJoinDialog.value = false;
    await router.push(`/room/${response.roomId}`);
  } else if (!response.ok) {
    alert(response.error || "加入房间失败");
  }
}
</script>

<template>
  <main class="page shell">
    <section class="hero-card hero-lobby">
      <div class="lobby-title">
        <h1>游戏大厅</h1>
      </div>

      <div class="lobby-actions">
        <button class="primary hero-btn" :disabled="creating" @click="onCreateRoom">创建新房间</button>
        <button class="secondary hero-btn" @click="showJoinDialog = true">加入房间</button>
      </div>
    </section>

    <div v-if="showJoinDialog" class="modal-overlay">
      <div class="modal-content">
        <h2>加入房间</h2>
        <input v-model="joinId" placeholder="输入房间号 (如 ABC123)" @keyup.enter="onJoinRoom(joinId)" />
        <div class="modal-actions" style="display: flex; gap: 1rem;">
          <button class="primary wide" @click="onJoinRoom(joinId)" :disabled="!joinId.trim()">加入</button>
          <button class="secondary wide" @click="showJoinDialog = false">取消</button>
        </div>
      </div>
    </div>

    <section class="lobby-grid">
      <div class="room-list">
        <article v-for="room in rooms" :key="room.id" class="room-card" @click="onJoinRoom(room.id)" style="cursor: pointer;">
          <div class="room-card-top">
            <div>
              <h3>{{ room.id }}</h3>
            </div>
            <span class="status-pill" :data-status="room.status">{{ room.status.toUpperCase() }}</span>
          </div>
          <p class="room-meta">
            红 {{ room.redCount }} · 蓝 {{ room.blueCount }} · 旁观 {{ room.spectatorCount }} · 在线 {{ room.connectedCount }}
          </p>
        </article>
      </div>
    </section>
  </main>
</template>
