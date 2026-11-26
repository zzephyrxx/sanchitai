/**
 * 组织关系转接与转入档案核查文档/报表生成工具（v0.3.0）
 *
 * - 导出《组织关系转接登记表》Excel（支持脱敏公示版 / 全量报送版）
 * - 一键生成《毕业生党员档案自提申请书》（.doc / .md）
 * - 一键生成《商请核实党员档案材料的函》（.doc / .md）
 */
import dayjs from 'dayjs';
import { INCOMING_AUDIT_ITEMS } from '@/constants/workspace-presets';
import { formatIdCardForExport, formatPhoneForExport, privacyModeFileSuffix } from '@/utils/privacy-export';
import { saveFileWithPicker } from '@/utils/save-file';

/** 导出《组织关系转接登记表》Excel（对齐基层党组织常见报送列，支持隐私分级） */
export async function exportTransferRegistryExcel(opts: {
  branchName: string;
  records: ReadonlyArray<{ transfer: Sct.TransferRecord; member?: Sct.Member }>;
  privacyMode: Sct.ExportPrivacyMode;
}): Promise<'saved' | 'cancelled'> {
  const XLSX = await import('xlsx');
  const { branchName, records, privacyMode } = opts;

  const rows = records.map(({ transfer, member }, idx) => ({
    序号: idx + 1,
    姓名: member?.name ?? transfer.member_name_snapshot ?? transfer.member_id,
    政治面貌: member?.type ?? '',
    性别: member?.gender ?? '',
    民族: member?.ethnicity ?? '',
    '班级/部门': member?.class_name || member?.department || '',
    原所在支部: member?.branch_name || branchName,
    身份证号: formatIdCardForExport(member?.id_card, privacyMode),
    联系电话: formatPhoneForExport(member?.phone, privacyMode),
    转接方式: transfer.transfer_mode ?? '线上系统转接',
    接收单位上级组织部门: transfer.target_committee ?? '',
    组织关系接收单位具体支部: transfer.target_branch ?? '',
    介绍信编号: transfer.letter_no ?? '',
    党费交至年月: transfer.fee_paid_until ?? '',
    发起转出日期: transfer.initiated_date ?? '',
    是否内部调转: transfer.is_internal ? '是' : '否',
    党员档案去向: transfer.archive_dest ?? '',
    回执状态: transfer.receipt_received ? `已收回(${transfer.receipt_date || ''})` : '待收回',
    办理状态: transfer.status,
    备注: transfer.note ?? ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 提示: '暂无组织关系转接记录' }]);
  XLSX.utils.book_append_sheet(wb, ws, '组织关系转接登记表');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const res = await saveFileWithPicker(blob, {
    suggestedName: `${branchName}_组织关系转接登记表${privacyModeFileSuffix(privacyMode)}_${dayjs().format('YYYYMMDD')}.xlsx`,
    types: [
      {
        description: 'Excel 工作簿',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extensions: ['.xlsx']
      }
    ]
  });
  return res.status === 'saved' ? 'saved' : 'cancelled';
}

/** 生成《党员档案自提申请书》文本 */
export function buildSelfPickupApplicationText(opts: {
  branchName: string;
  member: Sct.Member;
  transfer: Sct.TransferRecord;
}): string {
  const { branchName, member, transfer } = opts;
  const today = dayjs().format('YYYY年MM月DD日');
  return [
    '党员档案自提申请书',
    '',
    `尊敬的上级党组织及 ${branchName}：`,
    '',
    `    本人 ${member.name}（${member.type}${member.student_id ? `，学号/工号：${member.student_id}` : ''}），因毕业/工作变动需办理党员组织关系转出。`,
    `    本次拟将党员组织关系转往：${transfer.target_committee || '＿＿＿＿＿＿＿＿'} — ${transfer.target_branch || '＿＿＿＿＿＿＿＿'}。`,
    '    因接收单位要求本人现场递交密封党员档案材料，特申请由本人亲自提取并妥善转交密封完整的党员档案袋。',
    '    本人郑重承诺：自提后绝不私自拆封、涂改或遗失档案材料，将在规定时限内及时移交接收党组织并反馈接收回执；若因个人保管不善造成档案损毁或遗失，由本人承担全部责任。',
    '',
    `    党费交至：${transfer.fee_paid_until || '＿＿＿＿年＿＿月'}`,
    `    联系电话：${member.phone || '＿＿＿＿＿＿＿＿＿＿＿'}`,
    '',
    '                                        申请人（签字）：＿＿＿＿＿＿＿＿',
    `                                        申请日期：${today}`,
    '',
    '--------------------------------------------------------------------',
    '党支部审核意见：情况属实，同意办理档案密封自提手续。',
    '党支部书记签字：＿＿＿＿＿＿＿＿    日期：＿＿＿＿年＿＿月＿＿日'
  ].join('\n');
}

/** 生成《关于商请核实党员档案材料的函》文本（自动汇总缺失与存疑项） */
export function buildArchiveVerifyLetterText(opts: {
  branchName: string;
  member: Sct.Member;
  transfer: Sct.TransferRecord;
}): string {
  const { branchName, member, transfer } = opts;
  const today = dayjs().format('YYYY年MM月DD日');
  const auditItems = transfer.audit_items ?? {};
  const auditNotes = transfer.audit_notes ?? {};

  const issueLines: string[] = [];
  for (const item of INCOMING_AUDIT_ITEMS) {
    const st = auditItems[item.key];
    if (st === 'missing' || st === 'doubt') {
      const tag = st === 'missing' ? '【缺失】' : '【存疑】';
      const note = auditNotes[item.key]?.trim();
      issueLines.push(`  - ${tag}${item.fullLabel}${note ? `（说明：${note}）` : ''}`);
    }
  }

  return [
    `关于商请核实 ${member.name} 同志党员档案材料的函`,
    '',
    `${transfer.source_org || '相关基层党组织'}：`,
    '',
    `    ${member.name} 同志（当前身份：${member.type}${member.join_date ? `，入党时间：${member.join_date}` : ''}）近期申请将党员组织关系转入我支部（${branchName}）。`,
    '    按照《中国共产党发展党员工作细则》及党员档案管理有关规定，我支部在接收审查其党员纸质档案材料过程中，发现以下材料尚需贵组织予以协助核实或补充：',
    '',
    ...(issueLines.length ? issueLines : ['  - （当前暂未勾选具体缺失/存疑项，请按实际核查情况补充填写）']),
    '',
    '    为确保党员身份认定与组织关系接转严谨规范，恳请贵组织协助核查上述情况，并出具加盖基层党委（或党总支）公章的情况说明或补充对应材料。',
    '    感谢贵组织对基层党建工作的大力支持！',
    '',
    `                                        ${branchName}`,
    `                                        ${today}`
  ].join('\n');
}

/** 导出公文为 Word (.doc) 兼容格式 */
export async function downloadTextAsDoc(
  filename: string,
  title: string,
  plainText: string
): Promise<'saved' | 'cancelled'> {
  const escapedHtml = plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  const docHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:"FangSong","仿宋","Songti SC",serif;font-size:15pt;line-height:1.9;padding:36px 48px;color:#111;}</style>
  </head><body><div>${escapedHtml}</div></body></html>`;

  const blob = new Blob([docHtml], { type: 'application/msword;charset=utf-8' });
  const res = await saveFileWithPicker(blob, {
    suggestedName: filename.endsWith('.doc') ? filename : `${filename}.doc`,
    types: [{ description: 'Word 文档 (.doc)', mime: 'application/msword', extensions: ['.doc'] }]
  });
  return res.status === 'saved' ? 'saved' : 'cancelled';
}
