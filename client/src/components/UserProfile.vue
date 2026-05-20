<script setup lang="ts">
import { ref, onMounted } from "vue";
import { appState, updateLocalNickname, updateNickname } from "../lib/api";

const showNameDialog = ref(false);
const newNickname = ref("");
const isForcePrompt = ref(false);

onMounted(() => {
  const current = appState.nickname;
  if (!current || current === "新玩家") {
    isForcePrompt.value = true;
    newNickname.value = "";
    showNameDialog.value = true;
  }
});

function openDialog() {
  newNickname.value = appState.nickname;
  isForcePrompt.value = false;
  showNameDialog.value = true;
}

async function confirmName() {
  const trimmed = newNickname.value.trim();
  if (trimmed) {
    if (appState.currentRoom?.room?.id) {
      await updateNickname(appState.currentRoom.room.id, trimmed);
    } else {
      updateLocalNickname(trimmed);
    }
    showNameDialog.value = false;
  }
}
</script>

<template>
  <div class="global-user-profile">
    <button class="profile-trigger" @click="openDialog">
      <div class="avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      </div>
      <span class="nickname">{{ appState.nickname || '未设置昵称' }}</span>
    </button>

    <div v-if="showNameDialog" class="modal-overlay">
      <div class="modal-content">
        <h2>{{ isForcePrompt ? '设置昵称' : '修改昵称' }}</h2>
        <p v-if="isForcePrompt">请输入您的游戏昵称以继续：</p>
        <input v-model="newNickname" maxlength="24" placeholder="输入昵称" @keyup.enter="confirmName" />
        <button class="primary wide" @click="confirmName" :disabled="!newNickname.trim()">确定</button>
        <button v-if="!isForcePrompt" class="secondary wide" @click="showNameDialog = false">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.global-user-profile {
  position: absolute;
  top: 1rem;
  right: 1.5rem;
  z-index: 100;
}

.profile-trigger {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.9);
  padding: 0.4rem 1rem 0.4rem 0.4rem;
  border-radius: 999px;
  box-shadow: 0 4px 12px rgba(34, 29, 23, 0.08);
  backdrop-filter: blur(14px);
  color: var(--ink);
  font-weight: 500;
  transition: all 0.2s ease;
}

.profile-trigger:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(34, 29, 23, 0.12);
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(20, 99, 86, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.avatar svg {
  width: 18px;
  height: 18px;
}

.nickname {
  font-size: 0.95rem;
}
</style>
