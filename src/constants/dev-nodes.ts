/**
 * 党员发展五阶段 25 节点材料库（依据《中国共产党发展党员工作细则》梳理，
 * 编号沿用学院"27 项材料"体系的常见编号习惯，见 docs/research/domain-party-knowledge.md §2）
 */

export interface DevNodeDef {
  no: string;
  stage: '申请人' | '入党积极分子' | '发展对象' | '预备党员' | '正式党员';
  node: string;
  materials: string[];
  /** 硬性时限说明（用于倒计时提醒） */
  deadline?: string;
}

export const DEV_NODES: DevNodeDef[] = [
  { no: '1', stage: '申请人', node: '递交入党申请书', materials: ['入党申请书（本人手写）'] },
  { no: '2', stage: '申请人', node: '党组织派人谈话', materials: ['入党申请谈话通知书', '入党申请人谈话记录'], deadline: '收到申请书后 1 个月内' },
  { no: '3', stage: '入党积极分子', node: '推荐并确定积极分子', materials: ['党员推荐/群团推优材料', '支委会（或支部大会）记录'] },
  { no: '4', stage: '入党积极分子', node: '上级党委备案', materials: ['积极分子备案表', '本人简历及家庭主要成员情况'] },
  { no: '5', stage: '入党积极分子', node: '指定培养联系人', materials: ['培养联系人指定记录（1-2 名正式党员）'] },
  { no: '6', stage: '入党积极分子', node: '培养教育考察', materials: ['入党积极分子考察登记表（每半年一次）', '思想汇报（每季度）', '校级党课结业证书'], deadline: '考察期 1 年以上' },
  { no: '7', stage: '发展对象', node: '确定发展对象', materials: ['征求意见记录', '确定为发展对象公示', '支委会讨论记录'] },
  { no: '8', stage: '发展对象', node: '报上级党委备案', materials: ['发展对象备案报告', '确定为发展对象批复'] },
  { no: '9', stage: '发展对象', node: '确定入党介绍人', materials: ['入党介绍人指定记录（2 名正式党员）'] },
  { no: '10', stage: '发展对象', node: '政治审查', materials: ['综合性政审报告', '函调/外调材料', '个人自传', '与本人谈话记录'], deadline: '未政审或不合格不得发展' },
  { no: '11', stage: '发展对象', node: '短期集中培训', materials: ['培训通知/名单/考勤', '结业证书'], deadline: '不少于 3 天（或 24 学时）' },
  { no: '12', stage: '发展对象', node: '发展对象考核四件套', materials: ['集中考试', '志愿时长核验', '谈心谈话', '个人答辩'] },
  { no: '13', stage: '发展对象', node: '支委会拟接收审查+党委预审', materials: ['支委会拟接收预备党员审查会议记录', '党委预审批复'] },
  { no: '14', stage: '发展对象', node: '领取并填写《入党志愿书》', materials: ['入党志愿书（钢笔/毛笔，不得涂改）'] },
  { no: '15', stage: '预备党员', node: '支部大会讨论接收表决', materials: ['支部大会会议记录', '表决票决结果', '志愿书决议页'], deadline: '到会有表决权人数须超过应到会半数' },
  { no: '16', stage: '预备党员', node: '上级党委派人谈话', materials: ['谈话人意见（填入志愿书）'] },
  { no: '17', stage: '预备党员', node: '上级党委审批', materials: ['党委审批意见', '接收预备党员批复'], deadline: '党委 3 个月内审批' },
  { no: '18', stage: '预备党员', node: '宣布与材料报送', materials: ['宣布记录', '审批请示与备案材料'] },
  { no: '19', stage: '预备党员', node: '编入党小组/告知党费规定', materials: ['支部安排记录'] },
  { no: '20', stage: '预备党员', node: '入党宣誓', materials: ['宣誓仪式记录/照片'] },
  { no: '21', stage: '预备党员', node: '预备期教育考察', materials: ['预备党员考察表', '预备期思想汇报（每季度）'], deadline: '预备期 1 年（自支部大会通过之日算）' },
  { no: '22', stage: '预备党员', node: '转正申请与公示审查', materials: ['转正申请书（预备期满前一周递交）', '支部考察报告', '公示记录'], deadline: '预备期满前本人书面提出' },
  { no: '23', stage: '预备党员', node: '支部大会讨论转正表决', materials: ['支部大会会议记录', '票决结果', '公示情况'] },
  { no: '24', stage: '预备党员', node: '转正前征求意见', materials: ['征求党内外群众意见谈话记录'], deadline: '转正大会前' },
  { no: '25', stage: '正式党员', node: '材料归档', materials: ['入党志愿书', '入党申请书', '政审材料', '转正申请书', '培养教育考察材料'], deadline: '转正后存入人事档案' }
];

/** 五阶段顺序（泳道展示顺序） */
export const DEV_STAGE_ORDER: Array<'申请人' | '入党积极分子' | '发展对象' | '预备党员' | '正式党员'> = [
  '申请人',
  '入党积极分子',
  '发展对象',
  '预备党员',
  '正式党员'
];

/** 下一阶段 */
export function nextStage(stage: string): (typeof DEV_STAGE_ORDER)[number] | null {
  const idx = DEV_STAGE_ORDER.indexOf(stage as (typeof DEV_STAGE_ORDER)[number]);
  if (idx < 0 || idx >= DEV_STAGE_ORDER.length - 1) return null;
  return DEV_STAGE_ORDER[idx + 1];
}

/** 该阶段的节点清单 */
export function nodesOfStage(stage: string): DevNodeDef[] {
  return DEV_NODES.filter(n => n.stage === stage);
}
