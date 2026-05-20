import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { routes } from "./routes";
import "./styles.css";

const basePath = (import.meta.env.BASE_URL || "/codenames/").replace(/\/$/, "");

const router = createRouter({
  history: createWebHistory(basePath),
  routes
});

createApp(App).use(router).mount("#app");
