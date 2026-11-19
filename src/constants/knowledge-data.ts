/**
 * 知识库内置条目（图解教程电子化，图片经压缩打包于 src/assets/knowledge/）
 * 内容源：支部工作教程（图解）——仅供个人学习使用
 */
export interface KnowledgeItem {
  id: string;
  file: string;
  title: string;
  category: string;
}

export const KNOWLEDGE_CATEGORIES = ['发展党员', '三会一课', '组织生活与评议', '谈心谈话', '综合'];

export const KNOWLEDGE_ITEMS: KnowledgeItem[] = [
  { id: 'k01', file: 'k01', title: '什么是“三会一课”', category: '三会一课' },
  { id: 'k02', file: 'k02', title: '党务工作者职责有哪些', category: '综合' },
  { id: 'k03', file: 'k03', title: '党支部党员大会怎么开', category: '三会一课' },
  { id: 'k04', file: 'k04', title: '入党介绍人的条件及主要任务', category: '发展党员' },
  { id: 'k05', file: 'k05', title: '关于民主评议党员的几个问题', category: '组织生活与评议' },
  { id: 'k06', file: 'k06', title: '召开接收预备党员的支部大会应注意的问题', category: '发展党员' },
  { id: 'k07', file: 'k07', title: '召开接收预备党员的支部大会的主要程序', category: '发展党员' },
  { id: 'k08', file: 'k08', title: '如何对预备党员进行教育考察', category: '综合' },
  { id: 'k09', file: 'k09', title: '如何开好组织生活会', category: '组织生活与评议' },
  { id: 'k10', file: 'k10', title: '如何开展批评和自我批评', category: '组织生活与评议' },
  { id: 'k11', file: 'k11', title: '如何开展谈心谈话', category: '谈心谈话' },
  { id: 'k12', file: 'k12', title: '如何讲党课', category: '三会一课' },
  { id: 'k13', file: 'k13', title: '开展谈心谈话应注意哪些问题', category: '谈心谈话' },
  { id: 'k14', file: 'k14', title: '思想汇报应该怎么写', category: '发展党员' },
  { id: 'k15', file: 'k15', title: '民主评议党员的实施步骤', category: '组织生活与评议' },
  { id: 'k16', file: 'k16', title: '高校党组织的主要职责', category: '综合' },
  { id: 'k17', file: 'k17', title: '《中国共产党发展党员工作细则》新旧对照表', category: '发展党员' },
  { id: 'k18', file: 'k18', title: '中国共产党发展党员工作流程图', category: '发展党员' },
  { id: 'k19', file: 'k19', title: '发展党员工作流程图（非官方）', category: '发展党员' },
  { id: 'k20', file: 'k20', title: '如何开展组织生活', category: '组织生活与评议' },
  { id: 'k21', file: 'k21', title: '如何组织好主题党日活动', category: '三会一课' },
];
