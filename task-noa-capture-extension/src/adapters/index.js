import { taskNoaAdapter } from "./task-noa.js";

const adapters = [taskNoaAdapter];

export function resolveAdapter() {
  return adapters.find((adapter) => adapter.matches()) ?? null;
}
