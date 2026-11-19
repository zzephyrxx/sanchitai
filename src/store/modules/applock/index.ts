/**
 * 应用锁 store：本地隐私遮挡（非加密防护）
 *
 * - 启用后：应用启动即锁定 + 页眉可手动锁定 + 闲置自动锁定（可关）
 * - 密码/密保答案仅存 SHA-256 哈希（localStorage，同步读取保证启动即锁）
 * - 忘记密码：凭密保答案解锁
 */
import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { sha256 } from '@/utils/hash';

const K = {
  enabled: 'sct-lock-enabled',
  pwdHash: 'sct-lock-pwd-hash',
  question: 'sct-lock-question',
  answerHash: 'sct-lock-answer-hash',
  idleMinutes: 'sct-lock-idle-minutes'
} as const;

/** 预设找回密码问题 */
export const LOCK_QUESTIONS = ['您母亲的姓名是？', '您小学的全称是？', '您出生的城市是？', '您读过的第一本专业书是？', '您导师的姓氏是？'];

export const useAppLockStore = defineStore(SetupStoreId.AppLock, () => {
  const enabled = ref(localStorage.getItem(K.enabled) === 'Y');
  const pwdHash = ref(localStorage.getItem(K.pwdHash) ?? '');
  const question = ref(localStorage.getItem(K.question) ?? '');
  const answerHash = ref(localStorage.getItem(K.answerHash) ?? '');
  const idleMinutes = ref(Number(localStorage.getItem(K.idleMinutes) ?? 0));

  /** 启动时若已启用应用锁则立即锁定 */
  const locked = ref(enabled.value);

  const isSetup = computed(() => Boolean(pwdHash.value) && Boolean(answerHash.value));

  function persist() {
    if (enabled.value) {
      localStorage.setItem(K.enabled, 'Y');
      localStorage.setItem(K.pwdHash, pwdHash.value);
      localStorage.setItem(K.question, question.value);
      localStorage.setItem(K.answerHash, answerHash.value);
      localStorage.setItem(K.idleMinutes, String(idleMinutes.value));
    } else {
      Object.values(K).forEach(k => localStorage.removeItem(k));
    }
  }

  /** 启用应用锁 */
  async function enable(pwd: string, q: string, a: string, idle = 0): Promise<boolean> {
    if (pwd.length < 4) {
      window.$message?.warning('锁屏密码至少 4 位');
      return false;
    }
    if (!q.trim() || !a.trim()) {
      window.$message?.warning('请设置找回密码问题与答案');
      return false;
    }
    pwdHash.value = await sha256(pwd);
    question.value = q.trim();
    answerHash.value = await sha256(a.trim());
    idleMinutes.value = idle;
    enabled.value = true;
    persist();
    return true;
  }

  /** 关闭应用锁（需验证密码） */
  async function disable(pwd: string): Promise<boolean> {
    const hash = await sha256(pwd);
    if (hash !== pwdHash.value) {
      window.$message?.error('密码不正确');
      return false;
    }
    enabled.value = false;
    locked.value = false;
    persist();
    return true;
  }

  /** 修改锁屏密码（需验证旧密码） */
  async function changePassword(oldPwd: string, newPwd: string): Promise<boolean> {
    if ((await sha256(oldPwd)) !== pwdHash.value) {
      window.$message?.error('原密码不正确');
      return false;
    }
    if (newPwd.length < 4) {
      window.$message?.warning('新密码至少 4 位');
      return false;
    }
    pwdHash.value = await sha256(newPwd);
    persist();
    return true;
  }

  function lock() {
    if (!enabled.value) {
      window.$message?.info('尚未启用应用锁，可在「设置 → 应用锁」开启');
      return;
    }
    locked.value = true;
  }

  async function unlock(pwd: string): Promise<boolean> {
    if ((await sha256(pwd)) !== pwdHash.value) {
      return false;
    }
    locked.value = false;
    return true;
  }

  /** 凭密保答案解锁 */
  async function unlockByAnswer(answer: string): Promise<boolean> {
    if ((await sha256(answer.trim())) !== answerHash.value) {
      return false;
    }
    locked.value = false;
    return true;
  }

  function setIdleMinutes(min: number) {
    idleMinutes.value = min;
    persist();
  }

  // ---------------- 闲置自动锁 ----------------
  // 手动活动追踪（vueuse useIdle 不支持动态 timeout）
  let lastActive = Date.now();
  const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  const onActivity = () => {
    lastActive = Date.now();
  };
  ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));

  const idleTimer = window.setInterval(() => {
    if (!enabled.value || locked.value || idleMinutes.value <= 0) return;
    if (Date.now() - lastActive > idleMinutes.value * 60_000) {
      locked.value = true;
    }
  }, 15_000);

  onScopeDispose(() => {
    ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
    window.clearInterval(idleTimer);
  });

  return {
    enabled,
    locked,
    isSetup,
    question,
    idleMinutes,
    enable,
    disable,
    changePassword,
    lock,
    unlock,
    unlockByAnswer,
    setIdleMinutes
  };
});
