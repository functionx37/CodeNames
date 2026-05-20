import type { RouteRecordRaw } from "vue-router";
import LobbyPage from "./pages/LobbyPage.vue";
import RoomPage from "./pages/RoomPage.vue";

export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    component: LobbyPage
  },
  {
    path: "/room/:roomId",
    component: RoomPage
  }
];
