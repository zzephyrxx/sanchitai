<script setup lang="ts">
/**
 * 跨模块一键导入「待核实积分草稿」弹窗（v0.2.7）
 * 扫描当前年度：三会一课考勤未到会 + 党费欠缴 + 志愿时长台账，生成待核实建议由支书勾选导入，绝不静默扣分。
 */
import { computed, ref, watch } from 'vue';
import { buildPointDraftSuggestions, formatScore } from '@/utils/party-points';
import type { SyncPointDraftSuggestion } from '@/utils/party-points';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'SyncDraftsModal' });

const props = defineProps<{ show: boolean; year: number; scheme: Sct.PointScheme }>();
const emit = defineEmits<{ 'update:show': [val: boolean]; imported: [count: number] }>();

const workStore = useWorkDataStore();
const kindFilter = ref<'all' | 'attendance' | 'fee' | 'volunteer'>('all');
const selectedRefs = ref<string[]>([]);
const busy = ref(false);

const suggestions = computed<SyncPointDraftSuggestion[]>(() => {
  const partyMembers = workStore.members.filter(m => m.type === '正式党员' || m.type === '预备党员');
  return buildPointDraftSuggestions({
    year: props.year,
    scheme: props.scheme,
    members: partyMembers,
    calEvents: workStore.calEvents,
    attendance: workStore.attendance,
    feeRecords: workStore.feeRecords,
    volunteerActivities: workStore.volunteerActivities,
    existingRecords: workStore.pointRecords.filter(r => r.year === props.year)
  });
});

const visibleList = computed(() =>
  suggestions.value.filter(s => kindFilter.value === 'all' || s.sourceKind === kindFilter.value)
);

watch(
  () => [props.show, suggestions.value.length],
  ([visible]) => {
    if (!visible) return;
    selectedRefs.value = suggestions.value.filter(s => !s.alreadyImported).map(s => s.sourceRef);
  },
  { immediate: true }
);

function toggleRef(refKey: string, disabled: boolean) {
  if (disabled) return;
  const idx = selectedRefs.value.indexOf(refKey);
  if (idx >= 0) selectedRefs.value.splice(idx, 1);
  else selectedRefs.value.push(refKey);
}

async function handleImport() {
  const picked = suggestions.value.filter(s => !s.alreadyImported && selectedRefs.value.includes(s.sourceRef));
  if (!picked.length) {
    window.$message?.warning('请至少勾选一条未导入的建议');
    return;
  }
  busy.value = true;
  try {
    const count = await workStore.bulkAddPointRecords(
      picked.map(item => ({
        member_id: item.memberId,
        year: props.year,
        date: item.date,
        category: item.category,
        sub_category: item.subCategory,
        rule_label: item.ruleLabel,
        content: item.content,
        score: item.score,
        status: '待核实',
        source_ref: item.sourceRef,
        calc_meta: item.calcMeta
      }))
    );
    window.$message?.success(`已导入 ${count} 条「待核实」积分草稿，请在个人账单抽屉审核认定`);
    emit('imported', count);
    emit('update:show', false);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`一键同步 ${year} 年度跨模块积分草稿`"
    class="w-700px max-w-95vw"
    @update:show="val => emit('update:show', val)"
  >
    <div class="flex flex-col gap-12px">
      <div class="text-12px text-[var(--sct-muted)]">
        自动扫描 {{ year }} 年度「三会一课未到会」「党费欠缴」「志愿时长台账（已认定）」，勾选后仅生成
        <strong>「待核实」草稿</strong>
        ，需支书审核确认才计入总分。
      </div>

      <div class="flex flex-wrap items-center justify-between gap-8px">
        <NRadioGroup v-model:value="kindFilter" size="small">
          <NRadioButton value="all">全部 ({{ suggestions.length }})</NRadioButton>
          <NRadioButton value="volunteer">
            志愿时长 ({{ suggestions.filter(s => s.sourceKind === 'volunteer').length }})
          </NRadioButton>
          <NRadioButton value="attendance">
            考勤 ({{ suggestions.filter(s => s.sourceKind === 'attendance').length }})
          </NRadioButton>
          <NRadioButton value="fee">党费 ({{ suggestions.filter(s => s.sourceKind === 'fee').length }})</NRadioButton>
        </NRadioGroup>
        <span class="text-12px text-[var(--sct-muted)]">已勾选 {{ selectedRefs.length }} 条</span>
      </div>

      <div
        v-if="!visibleList.length"
        class="rounded-8px border border-dashed border-[var(--sct-border)] py-32px text-center text-13px text-[var(--sct-muted)]"
      >
        当前筛选下暂无可同步的新条目（所有欠缴/未到会/志愿时长均无记录或已同步）。
      </div>

      <div v-else class="max-h-340px flex flex-col gap-6px overflow-y-auto pr-2px">
        <div
          v-for="item in visibleList"
          :key="item.sourceRef"
          class="flex items-center justify-between gap-10px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] px-12px py-8px"
          :class="{ 'opacity-55': item.alreadyImported }"
          @click="toggleRef(item.sourceRef, item.alreadyImported)"
        >
          <div class="flex min-w-0 items-start gap-8px">
            <NCheckbox
              :checked="selectedRefs.includes(item.sourceRef)"
              :disabled="item.alreadyImported"
              class="mt-2px"
              @click.stop
              @update:checked="() => toggleRef(item.sourceRef, item.alreadyImported)"
            />
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-6px text-12.5px">
                <span class="font-bold text-[var(--sct-ink)]">{{ item.memberName }}</span>
                <NTag
                  size="tiny"
                  :type="item.sourceKind === 'volunteer' ? 'success' : item.sourceKind === 'fee' ? 'warning' : 'error'"
                  :bordered="false"
                >
                  {{ item.sourceBadge }}
                </NTag>
                <NTag v-if="item.alreadyImported" size="tiny" :bordered="false">已同步</NTag>
              </div>
              <div class="mt-2px text-11.5px text-[var(--sct-muted)]">{{ item.content }}</div>
            </div>
          </div>
          <span
            class="shrink-0 font-mono text-13px font-bold"
            :style="{ color: item.score >= 0 ? '#16a34a' : '#dc2626' }"
          >
            {{ formatScore(item.score, true) }} 分
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton size="small" type="primary" :loading="busy" :disabled="!selectedRefs.length" @click="handleImport">
          导入所选为待核实草稿 ({{ selectedRefs.length }})
        </NButton>
      </div>
    </template>
  </NModal>
</template>
