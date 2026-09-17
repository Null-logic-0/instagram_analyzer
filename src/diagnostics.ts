import type { StepReport, StepStatus } from "./types.js";

export const diagnostics: StepReport[] = [];

export function note(step: string, status: StepStatus, detail: string): void {
  diagnostics.push({ step, status, detail });
}
