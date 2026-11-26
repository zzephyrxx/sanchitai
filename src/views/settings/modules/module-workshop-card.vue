<script setup lang="ts">
/**
 * 设置页「工作台模块工坊 & 自定义字段」卡片（v0.2.7 高校定制版）
 * - 台账卡片网格启停扩展模块（座位图 / 党员积分 / 志愿时长 / 政治生日），关闭隐藏菜单但保留数据
 * - 高校学生花名册基础字段默认开启，支持额外增删自定义扩展字段
 * - 快捷唤起新手引导动画、使用指南手册与初始化设置
 */
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { nanoid } from '@sa/utils';
import { WORKSHOP_MODULES } from '@/constants/workspace-presets';
import { openOnboardingGuide, startSpotlightTour } from '@/utils/onboarding-bus';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'ModuleWorkshopCard' });

const router = useRouter();
const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const cfg = computed(() => workStore.workspaceConfig);

const addFieldModalShow = ref(false);
const fieldForm = reactive({
  label: '',
  type: 'text' as 'text' | 'select',
  optionsText: '',
  showInTable: false
});

async function toggleModule(key: Sct.OptionalModuleKey, val: boolean) {
  await workStore.updateWorkspaceConfig({
    enabledModules: {
      ...cfg.value.enabledModules,
      [key]: val
    }
  });
  window.$message?.success(val ? '扩展模块已启用（侧边栏即时可见）' : '扩展模块已隐藏（原有数据安全保留）');
}

function openAddField() {
  fieldForm.label = '';
  fieldForm.type = 'text';
  fieldForm.optionsText = '';
  fieldForm.showInTable = false;
  addFieldModalShow.value = true;
}

async function handleAddCustomField() {
  if (!fieldForm.label.trim()) {
    window.$message?.warning('请输入字段名称');
    return;
  }
  const options =
    fieldForm.type === 'select'
      ? fieldForm.optionsText
          .split(/[,，、\n]+/)
          .map(s => s.trim())
          .filter(Boolean)
      : undefined;
  const nextFields: Sct.CustomFieldDef[] = [
    ...cfg.value.customFields,
    {
      key: `cf_${nanoid(5)}`,
      label: fieldForm.label.trim(),
      type: fieldForm.type,
      options,
      showInTable: fieldForm.showInTable
    }
  ];
  await workStore.updateWorkspaceConfig({ customFields: nextFields });
  addFieldModalShow.value = false;
  window.$message?.success(`已新增花名册自定义字段「${fieldForm.label.trim()}」`);
}

async function removeCustomField(key: string) {
  const nextFields = cfg.value.customFields.filter(f => f.key !== key);
  await workStore.updateWorkspaceConfig({ customFields: nextFields });
  window.$message?.success('已移除该自定义字段');
}
</script>

<template>
  <NCard :bordered="false" data-tour="settings-workshop">
    <template #header>
      <div class="flex flex-wrap items-center gap-8px">
        <SvgIcon icon="lucide:blocks" class="text-17px text-[#A81C24]" />
        <span class="font-bold">{{ bi('工作台模块工坊与扩展字段', 'Module Workshop & Custom Fields') }}</span>
        <NTag size="tiny" type="info" :bordered="false" round>按需启停 · 高校定制</NTag>
      </div>
    </template>
    <template #header-extra>
      <div class="flex flex-wrap items-center gap-6px">
        <NButton size="tiny" secondary @click="startSpotlightTour()">
          <template #icon><SvgIcon icon="lucide:sparkles" /></template>
          新手引导动画
        </NButton>
        <NButton size="tiny" secondary @click="openOnboardingGuide('guide')">
          <template #icon><SvgIcon icon="lucide:book-open" /></template>
          使用指南
        </NButton>
        <NButton size="tiny" secondary @click="openOnboardingGuide('setup')">
          <template #icon><SvgIcon icon="lucide:wand-2" /></template>
          初始化设置
        </NButton>
      </div>
    </template>

    <div class="flex flex-col gap-14px">
      <!-- 扩展模块卡片网格 -->
      <div class="grid grid-cols-1 gap-10px sm:grid-cols-2">
        <div
          v-for="mod in WORKSHOP_MODULES"
          :key="mod.key"
          class="flex flex-col justify-between gap-8px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-12px"
          :class="{ 'opacity-65': !cfg.enabledModules[mod.key] }"
        >
          <div class="flex items-start justify-between gap-8px">
            <div class="min-w-0">
              <div class="flex items-center gap-6px text-13px font-bold">
                <SvgIcon :icon="mod.icon" class="text-16px" :style="{ color: mod.color }" />
                <span>{{ bi(mod.titleZh, mod.titleEn) }}</span>
                <NTag v-if="mod.badgeZh" size="tiny" :bordered="false">{{ mod.badgeZh }}</NTag>
              </div>
              <div class="mt-4px text-11.5px text-[var(--sct-muted)] leading-relaxed">
                {{ bi(mod.descZh, mod.descEn) }}
              </div>
            </div>
            <NSwitch
              :value="cfg.enabledModules[mod.key]"
              size="small"
              @update:value="val => toggleModule(mod.key, val)"
            />
          </div>
          <div v-if="mod.routeName && cfg.enabledModules[mod.key]" class="flex justify-end">
            <NButton size="tiny" quaternary type="primary" @click="router.push({ name: mod.routeName })">
              进入模块 →
            </NButton>
          </div>
        </div>
      </div>

      <!-- 花名册自定义扩展字段 -->
      <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] p-12px">
        <div class="flex flex-wrap items-center justify-between gap-8px">
          <div class="min-w-0">
            <div class="text-12.5px font-bold">花名册自定义扩展字段</div>
            <div class="mt-2px text-11.5px text-[var(--sct-muted)]">
              高校学生默认字段（学号 · 培养层次 · 年级 · 专业 · 班级 · 导师 ·
              宿舍）已内置开启，可按支部需要继续补充自定义字段
            </div>
          </div>
          <NButton size="tiny" type="primary" secondary @click="openAddField">
            <template #icon><SvgIcon icon="lucide:plus" /></template>
            新增自定义字段
          </NButton>
        </div>

        <div
          v-if="cfg.customFields.length"
          class="mt-10px flex flex-wrap gap-6px border-t border-dashed border-[var(--sct-border)] pt-8px"
        >
          <NTag
            v-for="cf in cfg.customFields"
            :key="cf.key"
            size="small"
            closable
            :bordered="false"
            @close="removeCustomField(cf.key)"
          >
            {{ cf.label }}（{{ cf.type === 'select' ? '下拉' : '文本' }}）
          </NTag>
        </div>
      </div>
    </div>

    <!-- 新增自定义字段弹窗 -->
    <NModal v-model:show="addFieldModalShow" preset="card" title="新增花名册自定义字段" class="w-430px max-w-94vw">
      <NForm label-placement="left" label-width="86" size="small">
        <NFormItem required>
          <template #label><span class="sct-field-label">字段名称</span></template>
          <NInput v-model:value="fieldForm.label" placeholder="如：实验室 / 特长技能 / 联系楼栋" />
        </NFormItem>
        <NFormItem>
          <template #label><span class="sct-field-label">字段类型</span></template>
          <NRadioGroup v-model:value="fieldForm.type" size="small">
            <NRadioButton value="text">文本输入</NRadioButton>
            <NRadioButton value="select">下拉选项</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem v-if="fieldForm.type === 'select'">
          <template #label><span class="sct-field-label">选项列表</span></template>
          <NInput v-model:value="fieldForm.optionsText" placeholder="用顿号或逗号分隔，如：一区、二区、三区" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="addFieldModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleAddCustomField">添加字段</NButton>
        </div>
      </template>
    </NModal>
  </NCard>
</template>
