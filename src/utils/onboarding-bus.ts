/**
 * 新手初始化弹窗、使用指南手册弹窗与 Driver.js「新手引导动画」全局总线
 */
import { ref } from 'vue';

export type OnboardingStage = 'setup' | 'guide';

export const onboardingVisible = ref(false);
export const onboardingStage = ref<OnboardingStage>('guide');

/** 新手引导动画期间强制展开的侧栏子菜单 key 列表（如 ['ledger', 'library']） */
export const tourForcedExpandedKeys = ref<string[] | null>(null);

/** 新手引导动画期间用于驱动页面自动展开抽屉/弹窗/切换页签的轻量命令总线 */
type TourCommandHandler = (cmd: string) => void;
const tourCommandListeners = new Set<TourCommandHandler>();

export function emitTourCommand(cmd: string): void {
  tourCommandListeners.forEach(fn => {
    try {
      fn(cmd);
    } catch {
      /* ignore individual listener errors */
    }
  });
}

export function onTourCommand(handler: TourCommandHandler): () => void {
  tourCommandListeners.add(handler);
  return () => {
    tourCommandListeners.delete(handler);
  };
}

/** 新手引导动画唤起器（支持从指定步骤 ID 起播，默认从第 1 步完整播放） */
let spotlightLauncher: ((startStepId?: string) => void) | null = null;

export function registerSpotlightLauncher(fn: (startStepId?: string) => void): void {
  spotlightLauncher = fn;
}

export function unregisterSpotlightLauncher(fn: (startStepId?: string) => void): void {
  if (spotlightLauncher === fn) spotlightLauncher = null;
}

export function openOnboardingGuide(stage: OnboardingStage = 'guide'): void {
  onboardingStage.value = stage;
  onboardingVisible.value = true;
}

export function closeOnboardingGuide(): void {
  onboardingVisible.value = false;
}

export function startSpotlightTour(startStepId?: string): void {
  onboardingVisible.value = false;
  spotlightLauncher?.(startStepId);
}
