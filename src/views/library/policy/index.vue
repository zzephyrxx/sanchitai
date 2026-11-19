<script setup lang="ts">
import { computed, ref } from 'vue';
import { saveAs } from 'file-saver';
import { useWorkDataStore } from '@/store/modules/work-data';

defineOptions({ name: 'PolicyPage' });

const workStore = useWorkDataStore();

/** 内置政策要点卡（结构化摘要；全文以导入文件为准） */
interface PolicyCard {
  id: string;
  title: string;
  source: string;
  url?: string;
  tags: string[];
  points: string[];
}

const BUILT_IN: PolicyCard[] = [
  {
    id: 'p01',
    title: '“三会一课”频次口径',
    source: '《中国共产党支部工作条例（试行）》第十一至十六条',
    url: 'https://www.idcpc.org.cn/zgzc/zcwj/201912/t20191216_106820.html',
    tags: ['三会一课'],
    points: [
      '支部党员大会：一般每季度召开 1 次',
      '支部委员会会议：一般每月召开 1 次（须半数以上委员到会）',
      '党小组会：一般每月召开 1 次',
      '党课：一般每季度至少 1 次；主题党日：每月相对固定 1 天开展'
    ]
  },
  {
    id: 'p02',
    title: '党员发展硬时限',
    source: '《中国共产党发展党员工作细则》',
    tags: ['发展党员'],
    points: [
      '积极分子培养考察期 ≥1 年（自确定之日起算）',
      '短期集中培训不少于 3 天（或 24 学时）',
      '预备期 1 年（自支部大会通过之日算）；党委审批 ≤3 个月',
      '从递交申请书到成为正式党员一般至少 2 年'
    ]
  },
  {
    id: 'p03',
    title: '党费收缴标准',
    source: '中组发〔2008〕3 号《关于中国共产党党费收缴、使用和管理的规定》',
    url: 'https://news.12371.cn/2015/10/28/ARTI1446023667889287.shtml',
    tags: ['党费'],
    points: [
      '学生党员：每月 0.2 元',
      '有工资收入者按税后月收入：≤3000 元 0.5%；3000-5000 元 1%；5000-10000 元 1.5%；>10000 元 2%',
      '确有困难可少交或免交（支部研究、上级党委批准）'
    ]
  },
  {
    id: 'p04',
    title: '组织生活会与民主评议',
    source: '《中国共产党支部工作条例（试行）》第十七、十八条',
    tags: ['组织生活'],
    points: [
      '组织生活会：每年至少 1 次，一般安排在第四季度',
      '民主评议党员：一般每年 1 次，可结合组织生活会进行',
      '评议等次：优秀/合格/基本合格/不合格（优秀比例一般 ≤1/3）'
    ]
  },
  {
    id: 'p05',
    title: '谈心谈话与支部设置',
    source: '《中国共产党支部工作条例（试行）》第十九、二十至二十一条',
    tags: ['谈心谈话', '组织建设'],
    points: [
      '支委之间、支委和党员之间、党员之间每年谈心谈话一般不少于 1 次',
      '正式党员 7 人以上设支部委员会（3-5 人，不超 7 人）',
      '支部委员会每届任期：高校等基层单位一般 3 年',
      '书记每年向上级党组织和党员大会述职'
    ]
  }
];

// ---------------- 用户导入文件（IndexedDB blob） ----------------
interface PolicyFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  added_at: string;
  blob: Blob;
}

const importedFiles = ref<PolicyFile[]>([]);
const fileInput = ref<HTMLInputElement>();

const workStoreAny = workStore as unknown as { docTemplates: unknown[] };

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  for (const f of files) {
    const row: PolicyFile = {
      id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: f.name,
      mime: f.type || 'application/octet-stream',
      size: f.size,
      added_at: new Date().toISOString(),
      blob: f
    };
    importedFiles.value.push(row);
    await saveToDb(row);
  }
  window.$message?.success(`已导入 ${files.length} 个文件（存于本机）`);
  input.value = '';
}

async function saveToDb(row: PolicyFile) {
  const { db } = await import('@/db/db');
  const buf = await row.blob.arrayBuffer();
  await db.meta.put({ key: `policy-file-${row.id}`, value: { meta: { ...row, blob: undefined }, data: Array.from(new Uint8Array(buf)) } });
}

async function download(row: PolicyFile) {
  saveAs(new Blob([row.blob], { type: row.mime }), row.name);
}

function previewUrl(row: PolicyFile) {
  return URL.createObjectURL(row.blob);
}

function fmtSize(size: number) {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}

const relatedTag = computed<Record<string, string>>(() => ({
  党费: '党费台账',
  发展党员: '发展台账',
  三会一课: '三会一课'
}));
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false" title="政策要点" class="mb-16px">
      <div class="grid grid-cols-1 gap-12px lg:grid-cols-2">
        <div v-for="card in BUILT_IN" :key="card.id" class="rounded-12px p-14px" style="background: var(--sct-soft)">
          <div class="flex items-center justify-between">
            <span class="text-14px font-bold">{{ card.title }}</span>
            <div class="flex gap-4px">
              <NTag v-for="t in card.tags" :key="t" size="tiny" :bordered="false">{{ relatedTag[t] ?? t }}</NTag>
            </div>
          </div>
          <ul class="ma-0 mt-8px pl-18px text-13px leading-relaxed text-gray-600">
            <li v-for="(p, i) in card.points" :key="i" class="mb-2px">{{ p }}</li>
          </ul>
          <div class="mt-8px flex items-center justify-between text-11px text-gray-400">
            <span>{{ card.source }}</span>
            <a v-if="card.url" :href="card.url" target="_blank" class="text-[var(--sct-accent)]">原文 ↗</a>
          </div>
        </div>
      </div>
    </NCard>

    <NCard :bordered="false" title="本单位文件">
      <template #header-extra>
        <NButton type="primary" size="small" @click="fileInput?.click()">导入文件</NButton>
        <input ref="fileInput" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" class="hidden" @change="onPick" />
      </template>
      <NEmpty v-if="!importedFiles.length" description="暂无导入文件——可导入学院下发的通知、方案、审批单等（存于本机）" />
      <div v-else class="grid grid-cols-1 gap-10px md:grid-cols-2 lg:grid-cols-3">
        <div v-for="row in importedFiles" :key="row.id" class="flex items-center justify-between rounded-10px p-10px" style="background: var(--sct-soft)">
          <div class="min-w-0">
            <div class="truncate text-13px font-bold">{{ row.name }}</div>
            <div class="text-11px text-gray-400">{{ fmtSize(row.size) }} · {{ row.added_at.slice(0, 10) }}</div>
          </div>
          <div class="flex gap-6px">
            <NButton size="tiny" @click="download(row)">下载</NButton>
          </div>
        </div>
      </div>
      <div class="mt-10px text-11px text-gray-300">支持 PDF / Word / 图片；文件仅存本机 IndexedDB，可随时下载取回。</div>
    </NCard>
  </div>
</template>

<style scoped></style>
