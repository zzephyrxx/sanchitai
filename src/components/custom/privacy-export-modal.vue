<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'PrivacyExportModal' });

interface Props {
  show: boolean;
  title?: string;
  summary?: string;
  loading?: boolean;
  confirmText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '导出选项与隐私分级',
  summary: '默认导出「脱敏公示版」，身份证号与手机号将自动掩码处理；仅上报上级党组织核验时再启用「全量报送版」。',
  loading: false,
  confirmText: '确认导出'
});

const emit = defineEmits<{
  'update:show': [value: boolean];
  confirm: [mode: Sct.ExportPrivacyMode];
}>();

const { bi } = useSctI18n();

const mode = ref<Sct.ExportPrivacyMode>('masked');
const fullConfirmed = ref(false);

watch(
  () => props.show,
  visible => {
    if (visible) {
      mode.value = 'masked';
      fullConfirmed.value = false;
    }
  }
);

function handleClose() {
  emit('update:show', false);
}

function handleConfirm() {
  if (mode.value === 'full' && !fullConfirmed.value) {
    window.$message?.warning('请先勾选确认「全量报送版」隐私保护承诺');
    return;
  }
  emit('confirm', mode.value);
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    class="w-520px max-w-94vw"
    :title="title"
    :mask-closable="!loading"
    @update:show="val => emit('update:show', val)"
  >
    <div class="flex flex-col gap-12px">
      <div class="text-12px text-[var(--sct-muted)] leading-relaxed">
        {{ summary }}
      </div>

      <div class="grid grid-cols-1 gap-10px sm:grid-cols-2">
        <button
          type="button"
          class="privacy-mode-card"
          :class="{ 'is-active': mode === 'masked' }"
          @click="mode = 'masked'"
        >
          <div class="flex items-center justify-between gap-6px">
            <span class="flex items-center gap-6px font-bold text-13px">
              <SvgIcon icon="lucide:shield-check" class="text-16px text-[#16a34a]" />
              {{ bi('脱敏公示版', 'Masked Public') }}
            </span>
            <NTag size="tiny" type="success" :bordered="false" round>{{ bi('推荐', 'Default') }}</NTag>
          </div>
          <div class="mt-6px text-left text-11.5px text-[var(--sct-muted)] leading-relaxed">
            {{
              bi(
                '身份证号与手机号自动星号掩码，适合支部群公示、内部存档与常规汇总。',
                'ID & phone masked with asterisks. Safe for public notice.'
              )
            }}
          </div>
        </button>

        <button
          type="button"
          class="privacy-mode-card privacy-mode-card--full"
          :class="{ 'is-active': mode === 'full' }"
          @click="mode = 'full'"
        >
          <div class="flex items-center justify-between gap-6px">
            <span class="flex items-center gap-6px font-bold text-13px">
              <SvgIcon icon="lucide:file-key-2" class="text-16px text-[#d97706]" />
              {{ bi('全量报送版', 'Full Sensitive') }}
            </span>
            <NTag size="tiny" type="warning" :bordered="false" round>{{ bi('需确认', 'Confirm') }}</NTag>
          </div>
          <div class="mt-6px text-left text-11.5px text-[var(--sct-muted)] leading-relaxed">
            {{
              bi(
                '保留完整身份证号与联系电话，仅用于上级党委报送、关系转接登记或保险投保。',
                'Keeps full ID & phone for official reporting only.'
              )
            }}
          </div>
        </button>
      </div>

      <div
        v-if="mode === 'full'"
        class="rounded-8px border border-[#f59e0b]/40 bg-[var(--sct-warn-soft)] px-12px py-10px"
      >
        <NCheckbox v-model:checked="fullConfirmed">
          <span class="text-12px font-medium text-[var(--sct-ink)]">
            {{
              bi(
                '我确认导出文件包含个人敏感信息，将仅用于正式组织报送并妥善保管、不外泄公示',
                'I confirm this export contains sensitive data and will only be used for official reporting'
              )
            }}
          </span>
        </NCheckbox>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-8px">
        <NButton size="small" :disabled="loading" @click="handleClose">{{ bi('取消', 'Cancel') }}</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="loading"
          :disabled="mode === 'full' && !fullConfirmed"
          @click="handleConfirm"
        >
          <template #icon><SvgIcon icon="lucide:download" /></template>
          {{ confirmText }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.privacy-mode-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 12px 12px 12px 18px;
  border-radius: var(--sct-radius, 7px);
  border: 1px solid var(--sct-border);
  background: var(--sct-page);
  color: var(--sct-ink);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.privacy-mode-card::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 7px;
  bottom: 7px;
  width: 3.5px;
  border-radius: 999px;
  background: transparent;
  transition: background-color 0.15s ease;
}

.privacy-mode-card:hover {
  border-color: var(--sct-ink);
}

.privacy-mode-card.is-active {
  border-color: color-mix(in srgb, #16a34a 45%, transparent);
  background: var(--sct-ok-soft);
}

.privacy-mode-card.is-active::before {
  background: #16a34a;
}

.privacy-mode-card--full.is-active {
  border-color: color-mix(in srgb, #d97706 45%, transparent);
  background: var(--sct-warn-soft);
}

.privacy-mode-card--full.is-active::before {
  background: #d97706;
}
</style>
