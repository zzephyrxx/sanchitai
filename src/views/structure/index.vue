<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { NPopconfirm } from 'naive-ui';
import { DEV_NODES } from '@/constants/dev-nodes';
import type { DevNodeDef } from '@/constants/dev-nodes';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';
import MemberCard from '@/views/ledger/members/modules/member-card.vue';
import OrgMindmap from './modules/org-mindmap.vue';

defineOptions({ name: 'StructurePage' });

const workStore = useWorkDataStore();
const { bi } = useSctI18n();

const ROLE_SLOTS = ['书记', '副书记', '组织委员', '宣传委员', '纪检委员'] as const;

function memberOfRole(role: string) {
  return workStore.members.find(m => m.role === role);
}

const assignState = reactive<{
  mode: 'core' | 'youth';
  role: string;
  youthSlotId: string | null;
  show: boolean;
}>({
  mode: 'core',
  role: '',
  youthSlotId: null,
  show: false
});
const assignValue = ref<string | null>(null);

function openAssign(role: string) {
  assignState.mode = 'core';
  assignState.role = role;
  assignState.youthSlotId = null;
  assignValue.value = memberOfRole(role)?.id ?? null;
  assignState.show = true;
}

function openAssignYouth(slot: Sct.YouthCommitteeSlot) {
  assignState.mode = 'youth';
  assignState.role = slot.title;
  assignState.youthSlotId = slot.id;
  assignValue.value = slot.member_id ?? null;
  assignState.show = true;
}

async function handleAssign() {
  if (!assignValue.value) return;
  const memberId = assignValue.value;
  const member = workStore.memberOf(memberId);
  if (member && member.type !== '正式党员') {
    window.$message?.warning(
      bi(
        '仅正式党员具有被选举权，预备党员等不能担任支委职务',
        'Only Full Party Members can be elected to committee positions'
      )
    );
    return;
  }

  if (assignState.mode === 'youth' && assignState.youthSlotId) {
    await workStore.assignYouthCommitteeMember(assignState.youthSlotId, memberId);
    window.$message?.success(`「${assignState.role}」已由 ${member?.name} 担任`);
    assignState.show = false;
    return;
  }

  // 若该成员原担任某个青年委员槽位，先同步清空其青年委员槽位
  const prevYouthSlot = workStore.youthCommitteeSlots.find(s => s.member_id === memberId);
  if (prevYouthSlot) {
    await workStore.assignYouthCommitteeMember(prevYouthSlot.id, null);
  }
  if (member && member.role) {
    await workStore.updateMember(member.id, { role: '' });
  }
  const prev = memberOfRole(assignState.role);
  if (prev && prev.id !== memberId) {
    await workStore.updateMember(prev.id, { role: '' });
  }
  await workStore.updateMember(memberId, { role: assignState.role });
  window.$message?.success(`「${assignState.role}」已由 ${member?.name} 担任`);
  assignState.show = false;
}

async function clearRole(role: string) {
  const prev = memberOfRole(role);
  if (prev) {
    await workStore.updateMember(prev.id, { role: '' });
    window.$message?.success(`「${role}」岗位已清空`);
  }
}

async function clearYouthRole(slotId: string) {
  await workStore.assignYouthCommitteeMember(slotId, null);
  window.$message?.success('该青年委员岗位已清空');
}

// ---------------- 青年委员新增 / 编辑弹窗 ----------------
const youthModalShow = ref(false);
const editingYouthSlotId = ref<string | null>(null);
const youthForm = reactive({
  title: '青年委员',
  duty: '联系青年团员 · 组织文体实践与推优入党'
});

function openAddYouthModal() {
  editingYouthSlotId.value = null;
  youthForm.title = '青年委员';
  youthForm.duty = '联系青年团员 · 组织文体实践与推优入党';
  youthModalShow.value = true;
}

function openEditYouthModal(slot: Sct.YouthCommitteeSlot) {
  editingYouthSlotId.value = slot.id;
  youthForm.title = slot.title;
  youthForm.duty = slot.duty || '联系青年团员 · 组织文体实践与推优入党';
  youthModalShow.value = true;
}

async function handleSaveYouthModal() {
  const cleanTitle = youthForm.title.trim() || '青年委员';
  if (editingYouthSlotId.value) {
    await workStore.updateYouthCommitteeSlot(editingYouthSlotId.value, {
      title: cleanTitle,
      duty: youthForm.duty.trim()
    });
    window.$message?.success(`已更新岗位「${cleanTitle}」`);
  } else {
    await workStore.addYouthCommitteeSlot(cleanTitle, youthForm.duty.trim());
    window.$message?.success(`已新增「${cleanTitle}」岗位，可点击卡片指派正式党员`);
  }
  youthModalShow.value = false;
}

async function handleRemoveYouth(slotId: string) {
  await workStore.removeYouthCommitteeSlot(slotId);
  window.$message?.success('已删除该青年委员岗位');
}

// ---------------- 党小组新增 / 重命名弹窗 ----------------
const groupModalShow = ref(false);
const groupModalMode = ref<'add' | 'rename'>('add');
const groupOldName = ref('');
const groupNewName = ref('');

function nextDefaultPartyGroupName(): string {
  const cnNums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const existing = new Set(workStore.partyGroupNames);
  for (let i = 0; i < cnNums.length; i += 1) {
    const cand = `第${cnNums[i]}党小组`;
    if (!existing.has(cand)) return cand;
  }
  return `第${existing.size + 1}党小组`;
}

function openAddGroupModal() {
  groupModalMode.value = 'add';
  groupOldName.value = '';
  groupNewName.value = nextDefaultPartyGroupName();
  groupModalShow.value = true;
}

function openRenameGroupModal(oldName: string) {
  groupModalMode.value = 'rename';
  groupOldName.value = oldName;
  groupNewName.value = oldName;
  groupModalShow.value = true;
}

async function handleSaveGroupModal() {
  const clean = groupNewName.value.trim();
  if (!clean) {
    window.$message?.warning('请输入党小组名称');
    return;
  }
  if (groupModalMode.value === 'add') {
    await workStore.addPartyGroup(clean);
    window.$message?.success(`已新增「${clean}」`);
  } else {
    await workStore.renamePartyGroup(groupOldName.value, clean);
    window.$message?.success(`已将「${groupOldName.value}」更名为「${clean}」，组内成员档案已同步`);
  }
  groupModalShow.value = false;
}

async function handleDeleteGroup(groupName: string) {
  await workStore.deletePartyGroup(groupName);
  window.$message?.success(`已删除「${groupName}」，原成员已归入未分组`);
}

async function handleMoveMemberGroup(memberId: string, targetGroupName: string) {
  const member = workStore.members.find(m => m.id === memberId);
  if (!member) return;
  const currentGroup = (member.group ?? '').trim();
  const nextGroup = targetGroupName.trim();
  if (currentGroup === nextGroup) return;
  await workStore.updateMember(memberId, { group: nextGroup });
  window.$message?.success(`已将「${member.name}」调整至「${nextGroup || '未分组'}」`);
}

const currentAssignOccupied = computed(() => {
  if (assignState.mode === 'youth' && assignState.youthSlotId) {
    return Boolean(workStore.youthCommitteeSlots.find(s => s.id === assignState.youthSlotId)?.member_id);
  }
  return Boolean(memberOfRole(assignState.role));
});

/** 仅正式党员有表决权、选举权和被选举权（《党章》第七条），故支委候选人仅展示正式党员 */
const roleOptions = computed(() =>
  workStore.members
    .filter(m => m.type === '正式党员')
    .map(m => ({
      label: `${m.name}（${m.type}${m.role ? ` · 现任${m.role}` : ''}）`,
      value: m.id
    }))
);

// 点击思维导图普通成员查看详情卡
const memberCardShow = ref(false);
const selectedMemberId = ref<string | null>(null);
function handleSelectMember(m: Sct.Member) {
  selectedMemberId.value = m.id;
  memberCardShow.value = true;
}

// ---------------- 发展流程图 ----------------
const flowTab = ref<'org' | 'flow'>('org');
const flowMode = ref<'standard' | 'academy'>('standard');

const STAGES: Array<{ key: DevNodeDef['stage']; label: string; color: string; soft: string }> = [
  { key: '申请人', label: '一、申请入党阶段', color: '#64748b', soft: 'rgba(100, 116, 139, 0.10)' },
  { key: '入党积极分子', label: '二、入党积极分子的确定和培养教育', color: '#2080f0', soft: 'var(--sct-info-soft)' },
  { key: '发展对象', label: '三、发展对象的确定和考察', color: '#d97706', soft: 'var(--sct-warn-soft)' },
  { key: '预备党员', label: '四、预备党员的接收', color: '#A81C24', soft: 'var(--sct-err-soft)' },
  { key: '正式党员', label: '五、预备党员的教育考察和转正', color: '#3f9d63', soft: 'var(--sct-ok-soft)' }
];

const nodesByStage = computed(() => STAGES.map(s => ({ ...s, nodes: DEV_NODES.filter(n => n.stage === s.key) })));

const detailNode = ref<DevNodeDef | null>(null);
const detailShow = ref(false);

function openNode(n: DevNodeDef) {
  detailNode.value = n;
  detailShow.value = true;
}

// ---------------- 学院版可视化蛇形流程图（对齐计算机科学与工程学院党员发展工作程序图 5 阶段 25 步） ----------------
interface AcademyNode {
  id: string;
  no: string;
  stageIndex: number; // 1..5
  rowIndex: number; // 阶段内第几行（1 或 2）
  name: string;
  window: string;
  owner: string;
  note: string;
}

interface AcademyStageMeta {
  index: number;
  title: string;
  color: string;
  soft: string;
  /** 每行的流向：ltr 左→右，rtl 右→左（还原学院流程图蛇形折返） */
  rowDirections: Array<'ltr' | 'rtl'>;
  /** 阶段末尾连接下一阶段的垂直箭头位置 */
  exitSide: 'left' | 'right' | 'none';
}

const ACADEMY_STAGES: AcademyStageMeta[] = [
  {
    index: 1,
    title: '一、申请入党阶段',
    color: '#475569',
    soft: 'rgba(71, 85, 105, 0.10)',
    rowDirections: ['ltr'],
    exitSide: 'right'
  },
  {
    index: 2,
    title: '二、入党积极分子的确定和培养教育',
    color: '#2080f0',
    soft: 'var(--sct-info-soft)',
    rowDirections: ['rtl'],
    exitSide: 'left'
  },
  {
    index: 3,
    title: '三、发展对象的确定和考察',
    color: '#d97706',
    soft: 'var(--sct-warn-soft)',
    rowDirections: ['ltr'],
    exitSide: 'right'
  },
  {
    index: 4,
    title: '四、预备党员的接收',
    color: '#A81C24',
    soft: 'var(--sct-err-soft)',
    rowDirections: ['rtl', 'ltr'],
    exitSide: 'right'
  },
  {
    index: 5,
    title: '五、预备党员的教育考察和转正',
    color: '#3f9d63',
    soft: 'var(--sct-ok-soft)',
    rowDirections: ['rtl', 'ltr'],
    exitSide: 'none'
  }
];

function createDefaultAcademyNodes(): AcademyNode[] {
  return [
    // 一、申请入党阶段（Row 1: 01 -> 02）
    {
      id: 'ac-01',
      no: '01',
      stageIndex: 1,
      rowIndex: 1,
      name: '提交入党申请书',
      window: '随时递交',
      owner: '入党申请人',
      note: '年满18周岁本人手写递交'
    },
    {
      id: 'ac-02',
      no: '02',
      stageIndex: 1,
      rowIndex: 1,
      name: '党组织派人谈话',
      window: '收到申请1个月内',
      owner: '支部书记/委员',
      note: '了解入党动机并作谈话记录'
    },
    // 二、入党积极分子的确定和培养教育（Row 1 RTL: 06 <- 05 <- 04 <- 03）
    {
      id: 'ac-03',
      no: '03',
      stageIndex: 2,
      rowIndex: 1,
      name: '推荐和确定入党积极分子',
      window: '每学期初（3月/9月）',
      owner: '团支部/支委会',
      note: '党员推荐或群团推优，支委会研究决定'
    },
    {
      id: 'ac-04',
      no: '04',
      stageIndex: 2,
      rowIndex: 1,
      name: '学院党委备案',
      window: '确定后及时',
      owner: '组织委员/学院党委',
      note: '报送备案表与积极分子名册'
    },
    {
      id: 'ac-05',
      no: '05',
      stageIndex: 2,
      rowIndex: 1,
      name: '指定培养联系人',
      window: '备案通过后',
      owner: '党支部',
      note: '指定1-2名正式党员作为培养联系人'
    },
    {
      id: 'ac-06',
      no: '06',
      stageIndex: 2,
      rowIndex: 1,
      name: '培养教育考察',
      window: '考察期1年以上',
      owner: '培养联系人/支部',
      note: '每季度思想汇报、每半年考察登记、积极分子党课培训'
    },
    // 三、发展对象的确定和考察（Row 1 LTR: 07 -> 08 -> 09 -> 10 -> 11）
    {
      id: 'ac-07',
      no: '07',
      stageIndex: 3,
      rowIndex: 1,
      name: '确定发展对象',
      window: '4月上旬 / 10月上旬',
      owner: '支委会',
      note: '培养满1年，听取党员群众意见并公示5个工作日'
    },
    {
      id: 'ac-08',
      no: '08',
      stageIndex: 3,
      rowIndex: 1,
      name: '报学院党委备案',
      window: '4月中旬 / 10月中旬',
      owner: '学院党委',
      note: '学院党委审查同意后列为发展对象'
    },
    {
      id: 'ac-09',
      no: '09',
      stageIndex: 3,
      rowIndex: 1,
      name: '确定入党介绍人',
      window: '备案同意后',
      owner: '党支部',
      note: '指定2名正式党员（一般由培养联系人担任）'
    },
    {
      id: 'ac-10',
      no: '10',
      stageIndex: 3,
      rowIndex: 1,
      name: '进行政治审查',
      window: '4月下旬 / 10月下旬',
      owner: '支部/学院党委',
      note: '函调外调、个人自传、综合性政审报告'
    },
    {
      id: 'ac-11',
      no: '11',
      stageIndex: 3,
      rowIndex: 1,
      name: '开展集中培训',
      window: '5月中旬 / 11月中旬',
      owner: '校/院党校',
      note: '不少于3天（24学时）集中培训并考核四件套合格'
    },
    // 四、预备党员的接收（Row 1 RTL: 15 <- 14 <- 13 <- 12；Row 2 LTR: 16 -> 17 -> 18）
    {
      id: 'ac-12',
      no: '12',
      stageIndex: 4,
      rowIndex: 1,
      name: '支部委员会审查',
      window: '5月下旬 / 11月下旬',
      owner: '支委会',
      note: '对发展对象全套材料进行严格初审'
    },
    {
      id: 'ac-13',
      no: '13',
      stageIndex: 4,
      rowIndex: 1,
      name: '学院党委预审',
      window: '5月底 / 11月底',
      owner: '学院党委',
      note: '书面预审合格后发放《入党志愿书》'
    },
    {
      id: 'ac-14',
      no: '14',
      stageIndex: 4,
      rowIndex: 1,
      name: '填写入党志愿书',
      window: '支部大会前',
      owner: '发展对象/介绍人',
      note: '介绍人指导下规范填写，不得涂改'
    },
    {
      id: 'ac-15',
      no: '15',
      stageIndex: 4,
      rowIndex: 1,
      name: '支部大会讨论',
      window: '6月上旬 / 12月上旬',
      owner: '支部党员大会',
      note: '有表决权到会超半数，无记名投票赞成超半数通过'
    },
    {
      id: 'ac-16',
      no: '16',
      stageIndex: 4,
      rowIndex: 2,
      name: '学院党委派人谈话',
      window: '党委审批前',
      owner: '学院党委指派专人',
      note: '作进一步了解并将谈话意见填入志愿书'
    },
    {
      id: 'ac-17',
      no: '17',
      stageIndex: 4,
      rowIndex: 2,
      name: '学院党委审批',
      window: '支部上报3个月内',
      owner: '学院党委会',
      note: '集体讨论表决，注明预备期起止时间'
    },
    {
      id: 'ac-18',
      no: '18',
      stageIndex: 4,
      rowIndex: 2,
      name: '学校党委组织部备案',
      window: '审批通过后',
      owner: '学院党委/校组织部',
      note: '报学校党委组织部备案并核发通知'
    },
    // 五、预备党员的教育考察和转正（Row 1 RTL: 22 <- 21 <- 20 <- 19；Row 2 LTR: 23 -> 24 -> 25）
    {
      id: 'ac-19',
      no: '19',
      stageIndex: 5,
      rowIndex: 1,
      name: '编入党支部和党小组',
      window: '批准为预备党员后',
      owner: '党支部',
      note: '编入支部与党小组并告知党费交纳规定'
    },
    {
      id: 'ac-20',
      no: '20',
      stageIndex: 5,
      rowIndex: 1,
      name: '入党宣誓',
      window: '七一或学期末集中',
      owner: '学院党委/党支部',
      note: '面向党旗举行入党宣誓仪式'
    },
    {
      id: 'ac-21',
      no: '21',
      stageIndex: 5,
      rowIndex: 1,
      name: '继续教育考察',
      window: '预备期1年',
      owner: '党支部/介绍人',
      note: '每季度书面思想汇报、半年考察鉴定'
    },
    {
      id: 'ac-22',
      no: '22',
      stageIndex: 5,
      rowIndex: 1,
      name: '提出转正申请',
      window: '预备期满前1周',
      owner: '预备党员本人',
      note: '书面提出转正申请，支部征求意见并公示5个工作日'
    },
    {
      id: 'ac-23',
      no: '23',
      stageIndex: 5,
      rowIndex: 2,
      name: '支部大会讨论',
      window: '6月中旬 / 12月中旬',
      owner: '支部党员大会',
      note: '讨论转正并无记名投票表决，形成决议'
    },
    {
      id: 'ac-24',
      no: '24',
      stageIndex: 5,
      rowIndex: 2,
      name: '学院党委审批',
      window: '上报后3个月内',
      owner: '学院党委会',
      note: '集体审议审批，书记同本人谈话并宣布结果'
    },
    {
      id: 'ac-25',
      no: '25',
      stageIndex: 5,
      rowIndex: 2,
      name: '材料归档',
      window: '转正审批后',
      owner: '支部/学院辅导员',
      note: '志愿书、申请书、政审、考察及转正材料归入人事档案'
    }
  ];
}

const academyNodes = ref<AcademyNode[]>([]);
const academyLoaded = ref(false);

onMounted(async () => {
  try {
    const { getMeta } = await import('@/db/db');
    const saved = await getMeta<AcademyNode[]>('academy-flow');
    // 若旧缓存为早期 4 条简易表格数据，自动升级为完整 25 步学院可视化流程图数据
    if (saved && saved.length >= 10 && saved[0]?.stageIndex) {
      academyNodes.value = saved;
    } else {
      academyNodes.value = createDefaultAcademyNodes();
    }
  } catch {
    academyNodes.value = createDefaultAcademyNodes();
  } finally {
    academyLoaded.value = true;
  }
});

async function saveAcademy() {
  try {
    const { setMeta } = await import('@/db/db');
    await setMeta('academy-flow', JSON.parse(JSON.stringify(academyNodes.value)));
    window.$message?.success('学院版发展流程已保存');
  } catch (err) {
    window.$message?.error(`保存失败：${(err as Error).message}`);
  }
}

async function resetAcademyDefault() {
  academyNodes.value = createDefaultAcademyNodes();
  await saveAcademy();
  window.$message?.success('已重置为计算机科学与工程学院 25 步标准流程图');
}

/** 按阶段与行组织学院版节点，RTL 行在视觉上反转数组使序号从右向左排列（完全还原学院 PNG 蛇形流向） */
const academyStagesView = computed(() =>
  ACADEMY_STAGES.map(st => {
    const stageNodes = academyNodes.value
      .filter(n => n.stageIndex === st.index)
      .sort((a, b) => Number(a.no) - Number(b.no));

    const rows = st.rowDirections.map((dir, rIdx) => {
      const rowNum = rIdx + 1;
      const list = stageNodes.filter(n => (n.rowIndex || 1) === rowNum);
      const displayNodes = dir === 'rtl' ? [...list].reverse() : list;
      return {
        rowNum,
        dir,
        nodes: displayNodes
      };
    });

    return {
      ...st,
      totalCount: stageNodes.length,
      rows
    };
  })
);

// ---------------- 学院节点弹窗编辑 / 新增 ----------------
const academyModalShow = ref(false);
const isNewAcademyNode = ref(false);
const editingAcademyForm = reactive<AcademyNode>({
  id: '',
  no: '',
  stageIndex: 1,
  rowIndex: 1,
  name: '',
  window: '',
  owner: '',
  note: ''
});

const academyStageOptions = ACADEMY_STAGES.map(s => ({ label: s.title, value: s.index }));

function openEditAcademyNode(node: AcademyNode) {
  isNewAcademyNode.value = false;
  Object.assign(editingAcademyForm, { ...node });
  academyModalShow.value = true;
}

function openAddAcademyNode(stageIndex = 1) {
  isNewAcademyNode.value = true;
  const nextNo = String(academyNodes.value.length + 1).padStart(2, '0');
  Object.assign(editingAcademyForm, {
    id: `ac-${Date.now().toString(36)}`,
    no: nextNo,
    stageIndex,
    rowIndex: 1,
    name: '',
    window: '',
    owner: '',
    note: ''
  });
  academyModalShow.value = true;
}

async function handleSaveAcademyNode() {
  if (!editingAcademyForm.name.trim()) {
    window.$message?.warning('请填写节点名称');
    return;
  }
  const copy: AcademyNode = { ...editingAcademyForm, name: editingAcademyForm.name.trim() };
  if (isNewAcademyNode.value) {
    academyNodes.value.push(copy);
  } else {
    const idx = academyNodes.value.findIndex(n => n.id === copy.id);
    if (idx >= 0) {
      academyNodes.value[idx] = copy;
    }
  }
  academyModalShow.value = false;
  await saveAcademy();
}

async function handleDeleteAcademyNode() {
  academyNodes.value = academyNodes.value.filter(n => n.id !== editingAcademyForm.id);
  academyModalShow.value = false;
  await saveAcademy();
}
</script>

<template>
  <div class="min-h-500px">
    <NCard :bordered="false">
      <template #header>
        <div class="flex items-center gap-12px">
          <span class="text-16px font-bold">{{ bi('组织与流程', 'Organization & Flowcharts') }}</span>
          <span class="text-12px text-gray-400">
            {{
              bi(
                '支部委员会组织架构 · 党员发展五阶段 25 步可视化程序图',
                'Branch Committee Hierarchy · 5-Stage 25-Step Member Development Flowchart'
              )
            }}
          </span>
        </div>
      </template>

      <NTabs v-model:value="flowTab" type="segment" size="small" class="mb-18px w-260px">
        <NTab name="org" :tab="bi('组织架构', 'Org Chart')" />
        <NTab name="flow" :tab="bi('发展流程图', 'Flowcharts')" />
      </NTabs>

      <!-- ============ 1. 组织架构 ============ -->
      <div v-if="flowTab === 'org'">
        <OrgMindmap
          :members="workStore.members"
          :youth-slots="workStore.youthCommitteeSlots"
          :party-group-names="workStore.partyGroupNames"
          @assign="openAssign"
          @clear="clearRole"
          @select-member="handleSelectMember"
          @add-youth="openAddYouthModal"
          @edit-youth="openEditYouthModal"
          @assign-youth="openAssignYouth"
          @clear-youth="clearYouthRole"
          @remove-youth="handleRemoveYouth"
          @add-group="openAddGroupModal"
          @rename-group="openRenameGroupModal"
          @delete-group="handleDeleteGroup"
          @move-member-group="handleMoveMemberGroup"
        />

        <div
          class="mt-14px rounded-10px p-12px text-12px leading-relaxed text-gray-400"
          style="background: var(--sct-soft)"
        >
          {{
            bi(
              '点击支委节点可指派正式党员或添加多名青年委员（实时同步至人员档案）· 下方独立分区展示支部党小组，支持手动增改组名与点击查看成员详情 · 依据《中国共产党支部工作条例（试行）》第二十条',
              'Click committee nodes to assign Full Party Members or add custom Youth Committee roles · Party Groups are displayed independently below with rename support'
            )
          }}
        </div>
      </div>

      <!-- ============ 2. 发展流程图（标准卡片版 & 学院蛇形可视化版） ============ -->
      <div v-if="flowTab === 'flow'">
        <div class="mb-16px flex flex-wrap items-center justify-between gap-12px">
          <NTabs v-model:value="flowMode" type="segment" size="small" class="w-360px">
            <NTab name="standard" :tab="bi('标准流程（细则详情版）', 'Standard Flow (Detailed)')" />
            <NTab name="academy" :tab="bi('学院版（可视化程序图）', 'School Flow (25-Step Snake)')" />
          </NTabs>

          <div v-if="flowMode === 'academy'" class="flex items-center gap-8px">
            <NButton size="small" secondary @click="openAddAcademyNode(1)">
              <template #icon><SvgIcon icon="lucide:plus" /></template>
              {{ bi('添加流程节点', 'Add Step Node') }}
            </NButton>
            <NPopconfirm @positive-click="resetAcademyDefault">
              <template #trigger>
                <NButton size="small" secondary>
                  <template #icon><SvgIcon icon="lucide:rotate-ccw" /></template>
                  {{ bi('重置学院标准 25 步', 'Reset 25-Step Default') }}
                </NButton>
              </template>
              {{
                bi(
                  '确认将学院版发展流程图重置为默认的 25 步标准节点吗？（自定义修改将被覆盖）',
                  'Reset the School Flowchart to the default 25 steps? (Custom edits will be overwritten)'
                )
              }}
            </NPopconfirm>
          </div>
        </div>

        <!-- 2A. 标准流程：五大阶段容器卡 + 每个小阶段独立卡片样式 -->
        <div v-if="flowMode === 'standard'" class="flex flex-col gap-16px">
          <template v-for="(stage, sIdx) in nodesByStage" :key="stage.key">
            <div class="stage-card">
              <div class="stage-card__header" :style="{ background: stage.soft }">
                <div class="flex items-center gap-8px">
                  <span class="inline-block h-14px w-3.5px rounded-full" :style="{ background: stage.color }" />
                  <span class="text-14px font-bold" :style="{ color: stage.color }">{{ stage.label }}</span>
                </div>
                <NTag size="tiny" :bordered="false" round>共 {{ stage.nodes.length }} 个步骤</NTag>
              </div>

              <div class="stage-card__body grid grid-cols-1 gap-12px sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <div v-for="n in stage.nodes" :key="n.no" class="step-node-card" @click="openNode(n)">
                  <div class="flex items-start justify-between gap-8px">
                    <div class="flex items-center gap-8px">
                      <span class="step-node-card__no" :style="{ background: stage.color }">
                        {{ String(n.no).padStart(2, '0') }}
                      </span>
                      <span class="text-13px font-bold text-[var(--sct-ink)]">{{ n.node }}</span>
                    </div>
                    <SvgIcon icon="lucide:chevron-right" class="flex-shrink-0 text-14px text-gray-400" />
                  </div>

                  <div class="mt-8px line-clamp-2 text-12px leading-relaxed text-[var(--sct-muted)]">
                    {{ n.req || n.note }}
                  </div>

                  <div
                    class="mt-10px flex flex-wrap items-center justify-between gap-6px border-t border-[var(--sct-border)] pt-8px"
                  >
                    <span class="text-11px text-gray-400">材料 {{ n.materials.length }} 项</span>
                    <span
                      v-if="n.deadline"
                      class="rounded-full bg-[var(--sct-warn-soft)] px-7px py-1px text-10px font-semibold text-[#d97706]"
                    >
                      ⏱ {{ n.deadline }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="sIdx < nodesByStage.length - 1" class="flex justify-center py-2px">
              <div
                class="inline-flex items-center gap-4px rounded-full bg-[var(--sct-soft)] px-12px py-3px text-11px font-bold text-gray-400"
              >
                <SvgIcon icon="lucide:arrow-down" class="text-13px text-[#A81C24]" />
                进入下一阶段
              </div>
            </div>
          </template>
        </div>

        <!-- 2B. 学院版：还原《计算机科学与工程学院党员发展工作程序（图）》5 阶段 25 步蛇形可视化流程图 -->
        <div v-if="flowMode === 'academy' && academyLoaded" class="academy-flow-wrap">
          <div
            class="mb-14px flex flex-wrap items-center justify-between gap-8px rounded-10px bg-[var(--sct-soft)] px-14px py-10px"
          >
            <div class="flex items-center gap-8px">
              <SvgIcon icon="lucide:workflow" class="text-16px text-[#A81C24]" />
              <span class="text-14px font-bold text-[var(--sct-ink)]">计算机科学与工程学院党员发展工作程序（图）</span>
              <NTag size="tiny" type="error" :bordered="false">蛇形可视化 · 点击任意节点卡片可编辑时间窗与责任人</NTag>
            </div>
            <span class="text-12px text-gray-400">共 5 大阶段 · {{ academyNodes.length }} 个标准步骤</span>
          </div>

          <div class="flex flex-col gap-14px">
            <div v-for="st in academyStagesView" :key="st.index" class="academy-stage-box">
              <!-- 阶段标题牌 + 流向提示 -->
              <div class="academy-stage-box__head">
                <div
                  class="academy-stage-plaque"
                  :style="{ borderColor: st.color, color: st.color, background: st.soft }"
                >
                  {{ st.title }}
                </div>
                <div class="flex items-center gap-8px">
                  <span class="text-11px text-gray-400">
                    流向：{{ st.rowDirections.map(d => (d === 'ltr' ? '左 → 右' : '右 → 左')).join(' ，折返 ') }}
                  </span>
                  <NButton size="tiny" quaternary type="primary" @click="openAddAcademyNode(st.index)">
                    <template #icon><SvgIcon icon="lucide:plus" /></template>
                    本阶段加节点
                  </NButton>
                </div>
              </div>

              <!-- 阶段内蛇形行 -->
              <div class="flex flex-col gap-12px">
                <template v-for="(row, rIdx) in st.rows" :key="row.rowNum">
                  <div class="academy-serpentine-row">
                    <template v-for="(node, nIdx) in row.nodes" :key="node.id">
                      <!-- 节点卡片 -->
                      <div
                        class="academy-node-card"
                        :style="{ borderTop: `3px solid ${st.color}` }"
                        @click="openEditAcademyNode(node)"
                      >
                        <div class="flex items-center justify-between gap-6px">
                          <div class="flex items-center gap-6px">
                            <span class="academy-node-card__no" :style="{ background: st.color }">
                              {{ node.no }}
                            </span>
                            <span class="text-13px font-bold text-[var(--sct-ink)]">{{ node.name }}</span>
                          </div>
                          <SvgIcon icon="lucide:pencil" class="academy-node-card__edit text-12px text-gray-400" />
                        </div>

                        <div class="mt-8px flex flex-wrap items-center gap-6px">
                          <span
                            v-if="node.window"
                            class="inline-flex items-center gap-3px rounded-4px bg-[var(--sct-soft)] px-6px py-2px text-11px text-[var(--sct-ink)]"
                          >
                            <SvgIcon icon="lucide:calendar-clock" class="text-11px text-[#A81C24]" />
                            {{ node.window }}
                          </span>
                          <span
                            v-if="node.owner"
                            class="inline-flex items-center gap-3px rounded-4px bg-[var(--sct-soft)] px-6px py-2px text-11px text-gray-500"
                          >
                            <SvgIcon icon="lucide:user-check" class="text-11px" />
                            {{ node.owner }}
                          </span>
                        </div>

                        <div v-if="node.note" class="mt-6px line-clamp-2 text-11px leading-relaxed text-gray-400">
                          {{ node.note }}
                        </div>
                      </div>

                      <!-- 同行节点之间的水平流向箭头（左→右 或 右←左） -->
                      <div v-if="nIdx < row.nodes.length - 1" class="academy-h-arrow">
                        <SvgIcon
                          :icon="row.dir === 'ltr' ? 'lucide:move-right' : 'lucide:move-left'"
                          class="text-18px"
                          :style="{ color: st.color }"
                        />
                      </div>
                    </template>
                  </div>

                  <!-- 阶段内部双行折返箭头（如阶段四 15→16、阶段五 22→23 从左侧向下折返） -->
                  <div v-if="rIdx < st.rows.length - 1" class="flex justify-start pl-36px">
                    <div
                      class="inline-flex items-center gap-4px rounded-full bg-[var(--sct-soft)] px-10px py-2px text-11px font-semibold"
                      :style="{ color: st.color }"
                    >
                      <SvgIcon icon="lucide:corner-down-right" class="text-14px" />
                      接下一行（{{ row.nodes[0]?.no }} → {{ st.rows[rIdx + 1]?.nodes[0]?.no }}）
                    </div>
                  </div>
                </template>
              </div>

              <!-- 跨阶段蛇形折返向下的连接指示器（严格对齐学院 PNG 左右衔接位） -->
              <div
                v-if="st.exitSide !== 'none'"
                class="mt-10px flex"
                :class="st.exitSide === 'right' ? 'justify-end pr-36px' : 'justify-start pl-36px'"
              >
                <div
                  class="inline-flex items-center gap-5px rounded-full border border-[var(--sct-border)] bg-[var(--sct-soft)] px-12px py-3px text-11px font-bold text-[#A81C24]"
                >
                  <SvgIcon icon="lucide:arrow-down-circle" class="text-14px" />
                  <span>流转至下一阶段</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </NCard>

    <!-- 岗位指派弹窗（label-width="112" 带图标防折行） -->
    <NModal v-model:show="assignState.show" preset="card" :title="`指派岗位：${assignState.role}`" class="w-460px">
      <NForm label-placement="left" label-width="112" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:user-check" class="sct-field-icon" />
              <span>担任成员</span>
            </span>
          </template>
          <NSelect
            v-model:value="assignValue"
            :options="roleOptions"
            :placeholder="bi('选择担任该岗位的正式党员', 'Select a Full Party Member for this role')"
            filterable
          />
        </NFormItem>
      </NForm>
      <div class="mt-4px text-12px text-gray-400">
        {{
          bi(
            '依据《党章》第七条，仅正式党员享有选举权和被选举权（预备党员、发展对象、积极分子已自动过滤）',
            'Per Party Constitution Art. 7, only Full Party Members are eligible for committee roles'
          )
        }}
      </div>
      <template #footer>
        <div class="flex justify-between">
          <NPopconfirm
            v-if="currentAssignOccupied"
            @positive-click="
              assignState.mode === 'youth' && assignState.youthSlotId
                ? clearYouthRole(assignState.youthSlotId)
                : clearRole(assignState.role);
              assignState.show = false;
            "
          >
            <template #trigger>
              <NButton type="error" secondary size="small">
                <template #icon><SvgIcon icon="lucide:user-minus" /></template>
                清空当前岗位
              </NButton>
            </template>
            确认清空「{{ assignState.role }}」岗位的当前任职人员吗？
          </NPopconfirm>
          <span v-else />
          <div class="flex gap-8px">
            <NButton size="small" @click="assignState.show = false">取消</NButton>
            <NButton size="small" type="primary" :disabled="!assignValue" @click="handleAssign">
              <template #icon><SvgIcon icon="lucide:check" /></template>
              确定指派
            </NButton>
          </div>
        </div>
      </template>
    </NModal>

    <!-- 学院版节点编辑弹窗（label-width="112" 带图标严禁换行） -->
    <NModal
      v-model:show="academyModalShow"
      preset="card"
      :title="isNewAcademyNode ? '新增学院流程节点' : `编辑节点：${editingAcademyForm.no} ${editingAcademyForm.name}`"
      class="w-560px"
    >
      <NForm label-placement="left" label-width="112" size="small">
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:hash" class="sct-field-icon" />
              <span>步骤编号</span>
            </span>
          </template>
          <NInput v-model:value="editingAcademyForm.no" placeholder="如 01、02…" />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:layers" class="sct-field-icon" />
              <span>所属阶段</span>
            </span>
          </template>
          <NSelect v-model:value="editingAcademyForm.stageIndex" :options="academyStageOptions" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:rows-2" class="sct-field-icon" />
              <span>阶段内行号</span>
            </span>
          </template>
          <NSelect
            v-model:value="editingAcademyForm.rowIndex"
            :options="[
              { label: '第 1 行', value: 1 },
              { label: '第 2 行（用于四/五阶段双行折返）', value: 2 }
            ]"
          />
        </NFormItem>
        <NFormItem required>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:type" class="sct-field-icon" />
              <span>节点名称</span>
            </span>
          </template>
          <NInput v-model:value="editingAcademyForm.name" placeholder="如：提交入党申请书" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:calendar-clock" class="sct-field-icon" />
              <span>学院时间窗</span>
            </span>
          </template>
          <NInput v-model:value="editingAcademyForm.window" placeholder="如：收到申请1个月内 / 5月中旬" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:user-cog" class="sct-field-icon" />
              <span>责任主体</span>
            </span>
          </template>
          <NInput v-model:value="editingAcademyForm.owner" placeholder="如：支部书记 / 组织委员 / 学院党委" />
        </NFormItem>
        <NFormItem>
          <template #label>
            <span class="sct-field-label">
              <SvgIcon icon="lucide:file-text" class="sct-field-icon" />
              <span>要求与备注</span>
            </span>
          </template>
          <NInput
            v-model:value="editingAcademyForm.note"
            type="textarea"
            :rows="3"
            placeholder="填写本学院细化要求或材料注意事项"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="flex justify-between">
          <NPopconfirm v-if="!isNewAcademyNode" @positive-click="handleDeleteAcademyNode">
            <template #trigger>
              <NButton size="small" type="error" secondary>
                <template #icon><SvgIcon icon="lucide:trash-2" /></template>
                删除此节点
              </NButton>
            </template>
            确认删除流程节点「{{ editingAcademyForm.no }} {{ editingAcademyForm.name }}」吗？
          </NPopconfirm>
          <span v-else />
          <div class="flex gap-8px">
            <NButton size="small" @click="academyModalShow = false">取消</NButton>
            <NButton size="small" type="primary" @click="handleSaveAcademyNode">
              <template #icon><SvgIcon icon="lucide:check" /></template>
              保存节点
            </NButton>
          </div>
        </div>
      </template>
    </NModal>

    <!-- 标准流程节点详情抽屉 -->
    <NDrawer v-model:show="detailShow" :width="440">
      <NDrawerContent v-if="detailNode" :title="`${detailNode.no} ${detailNode.node}`" closable>
        <NSpace vertical size="large">
          <NTag :bordered="false" size="small">{{ detailNode.stage }}</NTag>
          <NDescriptions :column="1" size="small" label-placement="top" bordered>
            <NDescriptionsItem v-if="detailNode.obj" label="对象">{{ detailNode.obj }}</NDescriptionsItem>
            <NDescriptionsItem v-if="detailNode.req" label="要求">
              {{ detailNode.req }}
              <NTag v-if="detailNode.deadline" size="tiny" type="warning" :bordered="false" class="ml-6px">
                {{ detailNode.deadline }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem v-if="detailNode.note" label="说明">{{ detailNode.note }}</NDescriptionsItem>
            <NDescriptionsItem label="所需材料">
              <div class="flex flex-wrap gap-4px">
                <NTag v-for="m in detailNode.materials" :key="m" size="tiny" :bordered="false">{{ m }}</NTag>
              </div>
            </NDescriptionsItem>
          </NDescriptions>
          <div class="text-11px text-gray-400">依据《中国共产党发展党员工作细则》与中央组织部流程图重绘。</div>
        </NSpace>
      </NDrawerContent>
    </NDrawer>

    <!-- 青年委员新增 / 编辑弹窗 -->
    <NModal
      v-model:show="youthModalShow"
      preset="card"
      :title="editingYouthSlotId ? '编辑青年委员岗位' : '添加青年委员岗位'"
      class="w-460px max-w-[92vw]"
    >
      <NForm label-placement="left" label-width="96" size="small">
        <NFormItem label="岗位名称" required>
          <NInput
            v-model:value="youthForm.title"
            placeholder="默认「青年委员」，可备注分工如：青年委员·文体"
            maxlength="20"
          />
        </NFormItem>
        <NFormItem label="职责说明">
          <NInput
            v-model:value="youthForm.duty"
            placeholder="如：联系青年团员 · 组织文体实践与推优入党"
            maxlength="60"
          />
        </NFormItem>
      </NForm>
      <div class="text-11px text-gray-400">
        添加后点击卡片即可指派正式党员担任；支持根据支部规模自由增设多名青年委员。
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="youthModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleSaveYouthModal">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            确定保存
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 党小组新增 / 重命名弹窗 -->
    <NModal
      v-model:show="groupModalShow"
      preset="card"
      :title="groupModalMode === 'add' ? '新增党小组' : `重命名党小组：${groupOldName}`"
      class="w-440px max-w-[92vw]"
    >
      <NForm label-placement="left" label-width="92" size="small">
        <NFormItem label="党小组名称" required>
          <NInput
            v-model:value="groupNewName"
            placeholder="如：第一党小组、第二党小组、研一党小组"
            maxlength="24"
            @keyup.enter="handleSaveGroupModal"
          />
        </NFormItem>
      </NForm>
      <div v-if="groupModalMode === 'rename'" class="text-11px text-gray-400">
        保存后将自动同步更新该党小组下全部成员的「党小组」字段。
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton size="small" @click="groupModalShow = false">取消</NButton>
          <NButton size="small" type="primary" @click="handleSaveGroupModal">
            <template #icon><SvgIcon icon="lucide:check" /></template>
            确定
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 人员详情抽屉（组织架构页仅查阅，不保留编辑入口） -->
    <MemberCard v-model:show="memberCardShow" :member-id="selectedMemberId" :editable="false" />
  </div>
</template>

<style scoped>
/* 标准流程：阶段大卡 + 小步骤卡片 */
.stage-card {
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 12px;
  overflow: hidden;
}

.stage-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--sct-border);
}

.stage-card__body {
  padding: 14px;
  background: var(--sct-soft);
}

.step-node-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}

.step-node-card:hover {
  transform: translateY(-2px);
  border-color: #a81c24;
  box-shadow: 0 6px 16px rgba(168, 28, 36, 0.1);
}

.step-node-card__no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  border-radius: 6px;
}

/* 学院版蛇形流程图 */
.academy-stage-box {
  padding: 16px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 12px;
}

.academy-stage-box__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1.5px solid var(--sct-border);
}

.academy-stage-plaque {
  display: inline-flex;
  align-items: center;
  padding: 5px 14px;
  font-size: 14px;
  font-weight: 800;
  border: 2px solid;
  border-radius: 6px;
}

.academy-serpentine-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 8px;
  overflow-x: auto;
  padding: 4px 2px;
}

.academy-node-card {
  flex: 1 1 0;
  min-width: 175px;
  padding: 12px;
  background: var(--sct-container);
  border: 1px solid var(--sct-border);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}

.academy-node-card:hover {
  transform: translateY(-2px);
  border-color: #a81c24;
  box-shadow: 0 6px 16px rgba(168, 28, 36, 0.12);
}

.academy-node-card__no {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 800;
  color: #fff;
  border-radius: 4px;
}

.academy-node-card__edit {
  opacity: 0.4;
  transition: opacity 0.15s;
}

.academy-node-card:hover .academy-node-card__edit {
  opacity: 1;
  color: #a81c24;
}

.academy-h-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0 2px;
}
</style>
