import { createMemoryHistory, createRouter } from "vue-router";
import {
  CANONICAL_AGENT_CASE_ROUTES,
  CANONICAL_AGENT_ROUTES,
} from "@/constants/agents";

const EmptyFixtureRoute = { template: "<div />" };

const fixtureAgentPaths = [
  ...Object.values(CANONICAL_AGENT_ROUTES),
  ...Object.values(CANONICAL_AGENT_CASE_ROUTES),
].filter((path, index, paths) => paths.indexOf(path) === index);

export function createChatVisualFixtureRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: EmptyFixtureRoute },
      ...fixtureAgentPaths.map((path) => ({
        path,
        component: EmptyFixtureRoute,
      })),
    ],
  });
}
