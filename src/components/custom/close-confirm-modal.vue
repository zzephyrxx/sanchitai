<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { applyCloseAction, isMacPlatform } from '@/utils/desktop-bridge';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'CloseConfirmModal' });

const { bi } = useSctI18n();

const visible = ref(false);
const selectedAction = ref<'minimize' | 'exit'>('minimize');
const rememberChoice = ref(true);
const submitting = ref(false);

const minimizeTitle = computed(() =>
  isMacPlatform
    ? bi('收起至程序坞（仅关闭窗口）', 'Hide to Dock (Keep Running)')
    : bi('最小化到任务栏（仅关闭窗口）', 'Minimize to Taskbar (Keep Running)')
);

const minimizeDesc = computed(() =>
  isMacPlatform
    ? bi(
        '仅隐藏主窗口，软件在后台继续运行并保持本机同步服务在线；点击程序坞图标可随时恢复窗口。',
        'Hides the window while keeping local sync running in the background. Click the Dock icon to restore.'
      )
    : bi(
        '仅最小化主窗口至任务栏，软件继续运行并保持本机同步服务在线；点击任务栏图标可随时恢复窗口。',
        'Minimizes the window to the taskbar while keeping local sync running. Click the taskbar icon to restore.'
      )
);

function onCloseRequested() {
  selectedAction.value = 'minimize';
  rememberChoice.value = true;
  visible.value = true;
}

async function handleConfirm() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    visible.value = false;
    await applyCloseAction(selectedAction.value, rememberChoice.value);
  } finally {
    submitting.value = false;
  }
}

function handleCancel() {
  visible.value = false;
}

onMounted(() => {
  window.addEventListener('sct-close-requested', onCloseRequested);
});

onBeforeUnmount(() => {
  window.removeEventListener('sct-close-requested', onCloseRequested);
});
</script>

<template>
  <NModal
    v-model:show="visible"
    preset="card"
    :title="bi('关闭窗口时的操作', 'When Closing Window')"
    class="w-460px max-w-[92vw]"
    :mask-closable="true"
  >
    <div class="flex flex-col gap-12px">
      <div class="text-13px leading-relaxed text-gray-500">
        {{
          bi(
            '您正在关闭三尺台桌面窗口，请选择点击关闭按钮时的默认行为：',
            'You are closing the desktop window. Choose what clicking the close button should do:'
          )
        }}
      </div>

      <NRadioGroup v-model:value="selectedAction" class="w-full">
        <div class="flex flex-col gap-10px">
          <label
            class="flex cursor-pointer items-start gap-10px rounded-10px border px-12px py-10px transition-colors"
            :class="
              selectedAction === 'minimize'
                ? 'border-[var(--primary-color)] bg-[var(--sct-soft)]'
                : 'border-gray-200 dark:border-gray-700'
            "
          >
            <NRadio value="minimize" class="mt-2px shrink-0" />
            <div class="min-w-0">
              <div class="text-13px font-semibold">{{ minimizeTitle }}</div>
              <div class="mt-2px text-12px leading-relaxed text-gray-500">{{ minimizeDesc }}</div>
            </div>
          </label>

          <label
            class="flex cursor-pointer items-start gap-10px rounded-10px border px-12px py-10px transition-colors"
            :class="
              selectedAction === 'exit'
                ? 'border-[var(--primary-color)] bg-[var(--sct-soft)]'
                : 'border-gray-200 dark:border-gray-700'
            "
          >
            <NRadio value="exit" class="mt-2px shrink-0" />
            <div class="min-w-0">
              <div class="text-13px font-semibold">{{ bi('直接退出软件', 'Quit Application') }}</div>
              <div class="mt-2px text-12px leading-relaxed text-gray-500">
                {{
                  bi(
                    '关闭窗口并彻底退出三尺台桌面进程（本机浏览器同步服务也将随之停止）。',
                    'Closes the window and exits the application completely (stops the local browser sync bridge).'
                  )
                }}
              </div>
            </div>
          </label>
        </div>
      </NRadioGroup>

      <NCheckbox v-model:checked="rememberChoice" class="mt-2px">
        <span class="text-12px text-gray-600 dark:text-gray-300">
          {{
            bi(
              '记住我的选择，下次不再询问（可随时在「系统设置」中修改）',
              'Remember my choice (changeable anytime in Settings)'
            )
          }}
        </span>
      </NCheckbox>
    </div>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton @click="handleCancel">{{ bi('取消', 'Cancel') }}</NButton>
        <NButton type="primary" :loading="submitting" @click="handleConfirm">
          <template #icon><SvgIcon icon="lucide:check" /></template>
          {{ bi('确定', 'Confirm') }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped></style>
