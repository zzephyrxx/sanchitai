<script setup lang="ts">
/**
 * 应用锁锁屏：全屏毛玻璃遮挡，密码解锁 / 密保答案找回
 */
import { computed, ref, watch } from 'vue';
import dayjs from 'dayjs';
import { useAppLockStore } from '@/store/modules/applock';

defineOptions({ name: 'AppLockOverlay' });

const appLock = useAppLockStore();

const mode = ref<'lock' | 'recover'>('lock');
const pwd = ref('');
const answer = ref('');
const shaking = ref(false);
const busy = ref(false);

const show = computed(() => appLock.locked);

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const now = computed(() => dayjs().format('HH:mm'));
const dateText = `${dayjs().format('M月D日')} ${WEEK_CN[dayjs().day()]}`;

watch(show, v => {
  if (v) {
    mode.value = 'lock';
    pwd.value = '';
    answer.value = '';
  }
});

function shake() {
  shaking.value = true;
  window.setTimeout(() => {
    shaking.value = false;
  }, 500);
}

async function handleUnlock() {
  if (!pwd.value) return;
  busy.value = true;
  const ok = await appLock.unlock(pwd.value);
  busy.value = false;
  if (ok) {
    pwd.value = '';
    window.$message?.success('已解锁');
  } else {
    shake();
    window.$message?.error('密码不正确');
  }
}

async function handleRecover() {
  if (!answer.value) return;
  busy.value = true;
  const ok = await appLock.unlockByAnswer(answer.value);
  busy.value = false;
  if (ok) {
    answer.value = '';
    window.$message?.success('密保答案正确，已解锁（可在设置中修改密码）');
  } else {
    shake();
    window.$message?.error('密保答案不正确');
  }
}
</script>

<template>
  <Teleport to="body">
    <!-- 不加过渡：隐藏窗口下 CSS 过渡会冻结，导致遮罩残留（与 GlobalContent 修复同类问题） -->
    <div v-if="show" class="lock-overlay">
        <div class="lock-card" :class="{ 'lock-card--shake': shaking }">
          <div class="flex justify-center">
            <!-- 三尺台 · 朱红方印 -->
            <svg width="56" height="56" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
              <rect x="16" y="16" width="480" height="480" rx="56" fill="#A81C24" />
              <rect x="52" y="52" width="408" height="408" rx="36" fill="none" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="6" />
              <g fill="#FFFFFF" font-family="'Songti SC','STSong','SimSun',serif" font-weight="900" text-anchor="middle">
                <text x="256" y="178" font-size="126">三</text>
                <text x="256" y="312" font-size="126">尺</text>
                <text x="256" y="446" font-size="126">台</text>
              </g>
            </svg>
          </div>

          <div class="mt-16px text-center">
            <div class="text-40px font-bold tracking-wide text-[var(--sct-ink)]">{{ now }}</div>
            <div class="mt-2px text-12px text-gray-400">{{ dateText }}</div>
          </div>

          <template v-if="mode === 'lock'">
            <div class="mt-18px text-center text-14px text-gray-600">工作台已锁定，输入密码继续</div>
            <div class="mt-14px">
              <NInput
                v-model:value="pwd"
                type="password"
                show-password-on="mousedown"
                placeholder="锁屏密码"
                :maxlength="32"
                :disabled="busy"
                clearable
                @keyup.enter="handleUnlock"
              />
            </div>
            <NButton type="primary" block class="mt-10px" :loading="busy" @click="handleUnlock">解锁</NButton>
            <div class="mt-12px text-center">
              <a class="text-12px text-gray-400 transition hover:text-gray-600" @click="mode = 'recover'">忘记密码？</a>
            </div>
          </template>

          <template v-else>
            <div class="mt-18px text-13px leading-relaxed text-gray-600">
              <div class="mb-4px font-bold text-[var(--sct-ink)]">找回密码问题</div>
              {{ appLock.question }}
            </div>
            <div class="mt-12px">
              <NInput
                v-model:value="answer"
                placeholder="输入密保答案"
                :maxlength="64"
                :disabled="busy"
                @keyup.enter="handleRecover"
              />
            </div>
            <NButton type="primary" block class="mt-10px" :loading="busy" @click="handleRecover">验证并解锁</NButton>
            <div class="mt-12px text-center">
              <a class="text-12px text-gray-400 transition hover:text-gray-600" @click="mode = 'lock'">返回输入密码</a>
            </div>
          </template>

          <div class="mt-16px border-t border-[var(--sct-border)] pt-10px text-center text-11px leading-relaxed text-gray-400">
            数据仅存于本机 · 应用锁为隐私遮挡，非加密防护
          </div>
        </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sct-overlay-bg);
  backdrop-filter: blur(22px) saturate(1.05);
  -webkit-backdrop-filter: blur(22px) saturate(1.05);
}
.lock-card {
  width: 340px;
  padding: 30px 28px 20px;
  background: var(--sct-overlay-card);
  border: 1px solid var(--sct-border);
  border-radius: 18px;
  box-shadow: 0 18px 60px rgba(64, 40, 40, 0.14);
}
.lock-card--shake {
  animation: lock-shake 0.4s;
}
@keyframes lock-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  50% { transform: translateX(8px); }
  75% { transform: translateX(-5px); }
}
</style>
