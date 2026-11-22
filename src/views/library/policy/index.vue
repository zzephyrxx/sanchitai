<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { NPopconfirm } from 'naive-ui';
import { saveFileWithPicker } from '@/utils/save-file';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'PolicyPage' });

const { bi, tKnowledgeCat } = useSctI18n();

/** 内置政策要点卡（结构化摘要；源自共产党员网 12371.cn 党内法规库及权威法规全文） */
interface PolicyCard {
  id: string;
  title: string;
  category: string;
  docNo?: string;
  source: string;
  url: string;
  tags: string[];
  points: string[];
}

const POLICY_CATEGORIES = ['全部', '支部建设', '发展党员', '党员教育管理', '组织生活', '党费与党务公开', '纪律与处分'];

const BUILT_IN: PolicyCard[] = [
  {
    id: 'p01',
    title: '“三会一课”与主题党日频次口径',
    category: '组织生活',
    docNo: '2018年11月中共中央印发',
    source: '《中国共产党支部工作条例（试行）》第十一至十六条',
    url: 'https://www.12371.cn/2018/11/25/ARTI1543151856097754.shtml',
    tags: ['三会一课', '主题党日'],
    points: [
      '支部党员大会：一般每季度召开 1 次；表决事项以赞成票超过应到会有表决权党员半数为通过',
      '支部委员会会议：一般每月召开 1 次（须半数以上委员到会方可进行）',
      '党小组会：一般每月召开 1 次，组织党员参加政治学习、谈心谈话、开展批评和自我批评',
      '党课：一般每季度至少 1 次；主题党日：每月相对固定 1 天开展（学习、组织生活、民主议事、志愿服务）'
    ]
  },
  {
    id: 'p02',
    title: '发展党员工作五阶段 25 步硬时限',
    category: '发展党员',
    docNo: '中办发〔2014〕33号',
    source: '《中国共产党发展党员工作细则》全章节核心时限',
    url: 'https://www.12371.cn/2014/06/10/ARTI1402408565380543.shtml',
    tags: ['发展党员', '25步流程'],
    points: [
      '入党申请谈话：党组织收到入党申请书后，应当在 1 个月内派人同入党申请人谈话',
      '入党积极分子考察期：1 年以上（自党支部确定为积极分子之日起算），每半年考察 1 次',
      '发展对象短期集中培训：不少于 3 天（或不少于 24 学时），未经培训（除个别特殊情况外）不能发展',
      '预备期与党委审批：预备期为 1 年（自支部大会通过之日起算）；上级党委对支部上报的接收决议须在 3 个月内审批'
    ]
  },
  {
    id: 'p03',
    title: '党费收缴、使用和管理规定',
    category: '党费与党务公开',
    docNo: '中组发〔2008〕3号',
    source: '《关于中国共产党党费收缴、使用和管理的规定》',
    url: 'https://news.12371.cn/2015/10/28/ARTI1446023667889287.shtml',
    tags: ['党费'],
    points: [
      '学生党员：每月交纳党费 0.2 元',
      '有工资收入的党员按税后月收入分档：≤3000 元交 0.5%；3000-5000 元交 1%；5000-10000 元交 1.5%；>10000 元交 2%',
      '交纳要求：党员应当主动按月交纳党费；无正当理由连续 6 个月不交纳党费的，按自行脱党处理',
      '减免程序：交纳党费确有困难的党员，经党支部研究，报上一级党委批准后，可以少交或免交'
    ]
  },
  {
    id: 'p04',
    title: '组织生活会与民主评议党员制度',
    category: '组织生活',
    docNo: '《支部工作条例》第十七、十八条',
    source: '《中国共产党支部工作条例（试行）》第五章',
    url: 'https://www.12371.cn/2018/11/25/ARTI1543151856097754.shtml',
    tags: ['组织生活', '民主评议'],
    points: [
      '组织生活会：党支部每年至少召开 1 次，一般安排在第四季度，也可以根据工作需要随时召开',
      '民主评议党员：一般每年开展 1 次，按照个人自评、党员互评、民主测评的程序，可结合组织生活会一并进行',
      '评议等次：分为优秀、合格、基本合格、不合格（其中优秀档次党员比例一般不超过党员总数的 1/3）'
    ]
  },
  {
    id: 'p05',
    title: '谈心谈话制度与支部委员会设置',
    category: '支部建设',
    docNo: '《支部工作条例》第十九至二十三条',
    source: '《中国共产党支部工作条例（试行）》第五、六章',
    url: 'https://www.12371.cn/2018/11/25/ARTI1543151856097754.shtml',
    tags: ['谈心谈话', '组织建设'],
    points: [
      '谈心谈话频次：党支部委员之间、党支部委员和党员之间、党员和党员之间，每年谈心谈话一般不少于 1 次',
      '委员会设置：正式党员 7 人以上的党支部设立支部委员会（委员 3 至 5 人，最多不超过 7 人）；不足 7 人的设书记 1 名',
      '任期与述职：高校等基层党支部委员会每届任期一般 3 年；党支部书记每年应当向上级党组织和党支部党员大会述职'
    ]
  },
  {
    id: 'p06',
    title: '党员教育管理与党籍/组织关系规范',
    category: '党员教育管理',
    docNo: '2019年5月中共中央印发',
    source: '《中国共产党党员教育管理工作条例》',
    url: 'https://www.12371.cn/2019/05/21/ARTI1558442798867164.shtml',
    tags: ['党员教育', '组织关系'],
    points: [
      '集中学习学时：党支部每年组织党员集中学习不少于 32 学时；党支部书记和班子成员每年集中学习不少于 56 学时',
      '组织关系转接：外出学习、工作、生活 6 个月以上且地点相对固定的，应当转移正式组织关系；6 个月以内的开具党员证明信',
      '流动党员管理：外出流动党员应当至少每半年向流出地党组织汇报 1 次外出期间思想、学习和工作情况',
      '高校毕业生党员：已经落实工作单位的，将组织关系及时转移到单位党组织；尚未落实的，可转移到本人或父母居住地街道社区党组织'
    ]
  },
  {
    id: 'p07',
    title: '基层党组织换届选举工作规范',
    category: '支部建设',
    docNo: '2020年7月中共中央印发',
    source: '《中国共产党基层组织选举工作条例》',
    url: 'https://www.12371.cn/2020/07/20/ARTI1595248394815763.shtml',
    tags: ['换届选举', '组织建设'],
    points: [
      '有效到会人数：进行选举时，有选举权的到会人数不少于应到会人数的五分之四（≥ 4/5），会议有效',
      '差额选举比例：委员候选人采用差额选举办法，候选人名额多于应选名额不少于 20%；书记、副书记一般由支委会等额选举产生',
      '投票与计票：收回选票数等于或少于发出选票数，选举有效；被选举人获得赞成票超过应到会有选举权人数半数，始得当选'
    ]
  },
  {
    id: 'p08',
    title: '普通高等学校学生党支部建设标准',
    category: '支部建设',
    docNo: '2021年4月修订',
    source: '《中国共产党普通高等学校基层组织工作条例》',
    url: 'https://www.12371.cn/2021/04/22/ARTI1619094461580831.shtml',
    tags: ['高校党建', '学生支部'],
    points: [
      '支部设置方式：学生党支部可以按照年级、专业、学科方向、课题组、实验室或学生宿舍社区等灵活设置',
      '团组织推优：推荐优秀团员作为入党积极分子，是高校培养和发展学生党员的重要渠道（28 周岁以下团员入党一般应经团推优）',
      '先锋模范作用：引导学生党员在政治学习、学术科研、学风建设、志愿服务与社会实践中发挥模范带头作用'
    ]
  },
  {
    id: 'p09',
    title: '支部党务公开内容、程序与时限',
    category: '党费与党务公开',
    docNo: '2017年12月中共中央印发',
    source: '《中国共产党党务公开条例（试行）》',
    url: 'https://www.12371.cn/2017/12/25/ARTI1514203097240968.shtml',
    tags: ['党务公开'],
    points: [
      '公开内容：支部决议部署执行情况、思想政治建设、“三会一课”与组织生活落实、发展党员公示、党费收缴情况等',
      '标准程序：按照“提出 — 审核 — 审批 — 实施”四步程序进行，一般先党内后党外，严守保密与个人信息脱敏纪律',
      '发展公示期：确定发展对象、接收预备党员、预备党员转正等环节公示期一般不少于 5 个工作日'
    ]
  },
  {
    id: 'p10',
    title: '党的六大纪律与支部日常纪检监督',
    category: '纪律与处分',
    docNo: '2023年12月修订（2024年1月施行）',
    source: '《中国共产党纪律处分条例》（12371.cn 专题）',
    url: 'https://www.12371.cn/special/zggcdjlcf/',
    tags: ['纪律教育', '六大纪律'],
    points: [
      '六大纪律体系：政治纪律、组织纪律、廉洁纪律、群众纪律、工作纪律、生活纪律（政治纪律是最重要、最根本、最关键的纪律）',
      '组织纪律红线：违反民主集中制原则、不按规定请示报告重大事项、在发展党员工作中违反程序和规定的，依规予以处分',
      '支部纪检职责：把纪律学习作为必修课，抓早抓小、防微杜渐，结合“三会一课”与主题党日开展常态化警示教育'
    ]
  }
];

const activeMainTab = ref<'rules' | 'archive'>('rules');
const activeCategory = ref('全部');
const keyword = ref('');

const filteredCards = computed(() =>
  BUILT_IN.filter(
    c =>
      (activeCategory.value === '全部' || c.category === activeCategory.value) &&
      (!keyword.value ||
        c.title.toLowerCase().includes(keyword.value.toLowerCase()) ||
        c.source.toLowerCase().includes(keyword.value.toLowerCase()) ||
        c.points.some(p => p.toLowerCase().includes(keyword.value.toLowerCase())))
  )
);

const policyPagination = reactive({
  page: 1,
  pageSize: 12,
  pageSizes: [12, 24, 36]
});

watch([activeCategory, keyword], () => {
  policyPagination.page = 1;
});

watch(
  () => filteredCards.value.length,
  total => {
    const maxPage = Math.max(1, Math.ceil(total / policyPagination.pageSize));
    if (policyPagination.page > maxPage) {
      policyPagination.page = maxPage;
    }
  }
);

const pagedPolicyCards = computed(() => {
  const start = (policyPagination.page - 1) * policyPagination.pageSize;
  return filteredCards.value.slice(start, start + policyPagination.pageSize);
});

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

onMounted(async () => {
  try {
    const { db } = await import('@/db/db');
    const rows = await db.meta.where('key').startsWith('policy-file-').toArray();
    importedFiles.value = rows
      .map(r => {
        const val = r.value as { meta: Omit<PolicyFile, 'blob'>; data: number[] } | undefined;
        if (!val?.meta || !Array.isArray(val.data)) return null;
        return {
          ...val.meta,
          blob: new Blob([new Uint8Array(val.data)], { type: val.meta.mime })
        };
      })
      .filter(Boolean) as PolicyFile[];
  } catch {
    /* 忽略首次加载空库 */
  }
});

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  const newRows: PolicyFile[] = files.map(f => ({
    id: `pf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: f.name,
    mime: f.type || 'application/octet-stream',
    size: f.size,
    added_at: new Date().toISOString(),
    blob: f
  }));
  importedFiles.value.push(...newRows);
  await Promise.all(newRows.map(row => saveToDb(row)));
  window.$message?.success(`已导入 ${files.length} 个文件（存于本机）`);
  input.value = '';
}

async function saveToDb(row: PolicyFile) {
  try {
    const { db } = await import('@/db/db');
    const buf = await row.blob.arrayBuffer();
    await db.meta.put({
      key: `policy-file-${row.id}`,
      value: { meta: { ...row, blob: undefined }, data: Array.from(new Uint8Array(buf)) }
    });
  } catch (err) {
    window.$message?.error(`文件「${row.name}」存储失败：${(err as Error).message}`);
  }
}

async function removeFile(id: string) {
  try {
    const { db } = await import('@/db/db');
    await db.meta.delete(`policy-file-${id}`);
    importedFiles.value = importedFiles.value.filter(f => f.id !== id);
    window.$message?.success('文件已移除');
  } catch (err) {
    window.$message?.error(`移除失败：${(err as Error).message}`);
  }
}

async function download(row: PolicyFile) {
  await saveFileWithPicker(new Blob([row.blob], { type: row.mime }), {
    suggestedName: row.name
  });
}

function fmtSize(size: number) {
  return size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}

const relatedTag = computed<Record<string, string>>(() => ({
  党费: '党费收缴',
  发展党员: '党员发展',
  三会一课: '三会一课'
}));
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex flex-wrap items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('政策文件', 'Policy Documents') }}</span>
          <NTabs v-model:value="activeMainTab" type="segment" size="small" class="w-360px">
            <NTab name="rules" :tab="`${bi('政策文件与法规要点', 'Regulations & Highlights')}（${BUILT_IN.length}）`" />
            <NTab name="archive" :tab="`${bi('本单位文件归档', 'Local Unit Archive')}（${importedFiles.length}）`" />
          </NTabs>
        </div>
      </template>
      <template #header-extra>
        <div class="flex items-center gap-10px">
          <template v-if="activeMainTab === 'rules'">
            <NButton
              tag="a"
              href="https://www.12371.cn/special/tx/"
              target="_blank"
              size="small"
              type="primary"
              secondary
            >
              <template #icon><SvgIcon icon="lucide:landmark" /></template>
              {{ bi('12371.cn 党内法规专题库', '12371.cn Regulations Portal') }}
            </NButton>
            <NInput
              v-model:value="keyword"
              :placeholder="bi('搜索法规名称或条款要点…', 'Search regulation title or points…')"
              size="small"
              class="w-240px"
              clearable
            >
              <template #prefix><SvgIcon icon="lucide:search" class="text-gray-400" /></template>
            </NInput>
          </template>
          <template v-else>
            <NButton type="primary" size="small" @click="fileInput?.click()">
              <template #icon><SvgIcon icon="lucide:upload" /></template>
              {{ bi('导入本单位文件', 'Import Local File') }}
            </NButton>
          </template>
          <input
            ref="fileInput"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            class="hidden"
            @change="onPick"
          />
        </div>
      </template>

      <!-- Tab 1：政策文件与法规要点（一行三列） -->
      <div v-if="activeMainTab === 'rules'">
        <div class="mb-16px flex justify-center">
          <div class="lib-cat-tabs">
            <NTabs v-model:value="activeCategory" type="segment" size="small">
              <NTab
                v-for="cat in POLICY_CATEGORIES"
                :key="cat"
                :name="cat"
                :tab="cat === '全部' ? `${bi('全部', 'All')}（${BUILT_IN.length}）` : tKnowledgeCat(cat)"
              />
            </NTabs>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-14px md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="card in pagedPolicyCards"
            :key="card.id"
            class="policy-card flex flex-col justify-between rounded-12px p-16px"
          >
            <div>
              <div class="flex items-start justify-between gap-8px">
                <div>
                  <span class="text-15px font-bold text-[var(--sct-ink)]">{{ card.title }}</span>
                  <div v-if="card.docNo" class="mt-2px text-11px text-gray-400">{{ card.docNo }}</div>
                </div>
                <div class="flex flex-shrink-0 flex-wrap gap-4px">
                  <NTag size="tiny" type="error" :bordered="false">{{ tKnowledgeCat(card.category) }}</NTag>
                  <NTag v-for="t in card.tags" :key="t" size="tiny" :bordered="false">{{ relatedTag[t] ?? t }}</NTag>
                </div>
              </div>
              <ul class="ma-0 mt-10px pl-18px text-13px leading-relaxed text-[var(--sct-ink)] opacity-90">
                <li v-for="(p, i) in card.points" :key="i" class="mb-4px">{{ p }}</li>
              </ul>
            </div>
            <div
              class="mt-12px flex items-center justify-between border-t border-[var(--sct-border)] pt-10px text-12px text-gray-400"
            >
              <span class="truncate pr-8px">{{ bi('出处：', 'Source: ') }}{{ card.source }}</span>
              <NButton v-if="card.url" tag="a" :href="card.url" target="_blank" size="tiny" quaternary type="primary">
                <template #icon><SvgIcon icon="lucide:external-link" /></template>
                {{ bi('权威原文', 'Full Text') }}
              </NButton>
            </div>
          </div>
        </div>

        <div class="mt-16px flex justify-end">
          <NPagination
            v-model:page="policyPagination.page"
            v-model:page-size="policyPagination.pageSize"
            :item-count="filteredCards.length"
            :page-sizes="policyPagination.pageSizes"
            show-size-picker
            size="small"
          >
            <template #prefix="{ itemCount }">
              <span class="text-12px text-gray-400">{{ bi(`共 ${itemCount} 条`, `Total ${itemCount}`) }}</span>
            </template>
          </NPagination>
        </div>
      </div>

      <!-- Tab 2：本单位文件归档（离线存储） -->
      <div v-else>
        <div
          class="mb-14px flex items-center justify-between rounded-10px bg-[var(--sct-soft)] px-14px py-10px text-12px text-gray-500"
        >
          <span>
            {{
              bi(
                '可导入上级党委/学院下发的通知、方案、审批单等（支持 PDF / Word / 图片，100% 存于本机 IndexedDB，不上传网络）',
                'Import notices, plans, or approval forms (PDF / Word / Images, 100% stored locally in IndexedDB)'
              )
            }}
          </span>
          <NButton size="tiny" type="primary" secondary @click="fileInput?.click()">
            <template #icon><SvgIcon icon="lucide:plus" /></template>
            {{ bi('添加归档文件', 'Add Archive File') }}
          </NButton>
        </div>

        <NEmpty
          v-if="!importedFiles.length"
          :description="
            bi(
              '暂无本单位归档文件——点击右上角「导入本单位文件」即可离线归档保存',
              'No archived local files yet — click [Import Local File] at the top right to save offline'
            )
          "
          class="py-36px"
        />
        <div v-else class="grid grid-cols-1 gap-12px md:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="row in importedFiles"
            :key="row.id"
            class="flex items-center justify-between gap-10px rounded-12px border border-[var(--sct-border)] bg-[var(--sct-soft)] p-14px"
          >
            <div class="min-w-0 flex items-center gap-10px">
              <SvgIcon icon="lucide:file-text" class="flex-shrink-0 text-20px text-[#A81C24]" />
              <div class="min-w-0">
                <div class="truncate text-13px font-bold">{{ row.name }}</div>
                <div class="mt-2px text-11px text-gray-400">
                  {{ fmtSize(row.size) }} · {{ row.added_at.slice(0, 10) }}
                </div>
              </div>
            </div>
            <div class="flex flex-shrink-0 gap-6px">
              <NButton size="tiny" secondary type="primary" @click="download(row)">
                <template #icon><SvgIcon icon="lucide:download" /></template>
                下载
              </NButton>
              <NPopconfirm @positive-click="removeFile(row.id)">
                <template #trigger>
                  <NButton size="tiny" secondary type="error">
                    <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                    删除
                  </NButton>
                </template>
                确认删除文件「{{ row.name }}」？
              </NPopconfirm>
            </div>
          </div>
        </div>
        <div class="mt-12px text-11px text-gray-400">提示：文件仅存本机 IndexedDB，注意上传前做好个人信息脱敏。</div>
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.lib-cat-tabs {
  width: 70%;
  max-width: 100%;
}
@media (max-width: 960px) {
  .lib-cat-tabs {
    width: 100%;
  }
}
.policy-card {
  background: var(--sct-soft);
  border: 1px solid var(--sct-border);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.policy-card:hover {
  border-color: #a81c24;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
}
</style>
