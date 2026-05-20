<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CardView } from "@shared/types";

const props = defineProps<{
  card: CardView;
  selectable: boolean;
  selected: boolean;
  isCaptain: boolean;
}>();

const emit = defineEmits<{
  select: [cardId: string];
}>();

const isFlipping = ref(false);

watch(() => props.card.word, (newWord, oldWord) => {
  if (newWord !== oldWord) {
    isFlipping.value = true;
    setTimeout(() => {
      isFlipping.value = false;
    }, 600);
  }
});

const cardClass = computed(() => {
  if (props.card.revealed || props.isCaptain) {
    if (props.card.color === "red") {
      return "revealed-red";
    }
    if (props.card.color === "blue") {
      return "revealed-blue";
    }
    if (props.card.color === "black") {
      return "revealed-black";
    }
    if (props.card.color === "white") {
      return "revealed-white";
    }
  }
  if (props.card.locked) {
    return "locked";
  }
  return "hidden";
});
</script>

<template>
  <button
    class="board-card"
    :class="[cardClass, { selectable, selected, 'flip-anim': isFlipping, 'is-captain': isCaptain }]"
    :disabled="!selectable"
    @click="emit('select', card.id)"
  >
    <span class="word">{{ card.word }}</span>
    <span v-if="card.revealed && card.color === 'black'" class="skull">💀</span>
    <span v-if="card.previewNicknames.length" class="preview">
      {{ card.previewNicknames.join("、") }}
    </span>
  </button>
</template>
