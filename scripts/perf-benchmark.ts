/**
 * 三尺台大规模数据压测脚本（独立运行，绝不污染真实种子数据或本地数据库）
 *
 * 覆盖 50 人 / 200 人 / 500 人 三档规模，实测：
 * 1. 党员积分年度汇总（对比旧 O(M×R) vs 新 O(M+R) 分组索引）
 * 2. 谈心谈话年度覆盖矩阵（仅覆盖预备/正式党员，O(T)+O(M) 建索引）
 * 3. 党员发展五阶段泳道单次分组 + next_node 重算 + 材料清单解析
 * 4. 党费收缴 6 个月人×月矩阵 Map 构建与全月批量标记已缴计算
 * 5. .sctpack 二进制 Gzip + AES-256-GCM 加密打包体积与加密/解密耗时（免口令 & 口令模式）
 * 6. 同步信封 JSON 体积与 64MB 桌面桥接上限余量检验
 */
import { performance } from 'node:perf_hooks';
import dayjs from 'dayjs';
import { DEV_STAGE_ORDER, computeNextDevNode, nodesOfStage, resolveNodeMaterials } from '../src/constants/dev-nodes';
import { computeMemberYearPoints } from '../src/utils/party-points';
import { encodeSctPackBytes, inspectImportBytes } from '../src/utils/sctpack';
import type { SctPackPayload } from '../src/utils/sctpack';

const MEMBER_TYPES = ['正式党员', '预备党员', '发展对象', '入党积极分子', '申请人'] as const;
const GROUPS = ['第一党小组', '第二党小组', '第三党小组', '第四党小组', '第五党小组', '第六党小组'];

function generateSyntheticDataset(memberCount: number) {
  const year = dayjs().year();
  const months: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    months.push(dayjs().subtract(i, 'month').format('YYYY-MM'));
  }

  const members: Sct.Member[] = [];
  const devStages: Sct.DevStage[] = [];
  const feeRecords: Sct.FeeRecord[] = [];
  const talks: Sct.Talk[] = [];
  const pointRecords: Sct.PointRecord[] = [];
  const calEvents: Sct.CalEvent[] = [];

  for (let i = 0; i < memberCount; i += 1) {
    const id = `BENCH_${String(i + 1).padStart(4, '0')}`;
    // 约 55% 正式党员, 15% 预备党员, 10% 发展对象, 12% 积极分子, 8% 申请人
    const r = i % 20;
    const type =
      r < 11
        ? MEMBER_TYPES[0]
        : r < 14
          ? MEMBER_TYPES[1]
          : r < 16
            ? MEMBER_TYPES[2]
            : r < 18
              ? MEMBER_TYPES[3]
              : MEMBER_TYPES[4];
    const joinDate =
      type === '正式党员'
        ? `${year - 2}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`
        : type === '预备党员'
          ? `${year}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`
          : '';

    members.push({
      id,
      code: `ZS${String(i + 1).padStart(3, '0')}`,
      name: `测试党员${i + 1}`,
      type,
      group: GROUPS[i % GROUPS.length],
      grade: '2024级',
      major: '计算机科学与技术',
      student_id: `2024${String(10000 + i)}`,
      join_date: joinDate,
      full_date: type === '正式党员' ? `${year - 1}-06-15` : '',
      fee_category: i % 10 === 0 ? '在职党员' : '学生党员',
      fee_monthly: i % 10 === 0 ? 35 : 0.2,
      identity: 'secretary'
    });

    const stageNodes = nodesOfStage(type);
    const materials: Sct.DevMaterial[] = stageNodes.flatMap((n, nIdx) =>
      n.materials.map((matName, mIdx) => ({
        no: `${n.no}.${mIdx + 1}`,
        name: matName,
        status: type === '正式党员' ? '已归档' : nIdx === 0 ? '已归档' : '未开始',
        date: type === '正式党员' || nIdx === 0 ? `${year}-05-10` : ''
      }))
    );

    devStages.push({
      member_id: id,
      stage: type,
      stage_date: `${year}-01-15`,
      next_node: type === '正式党员' ? '材料归档' : (stageNodes[stageNodes.length - 1]?.node ?? ''),
      next_due: type === '预备党员' ? `${year + 1}-01-15` : undefined,
      materials,
      timeline: [{ node: `确定为${type}`, date: `${year}-01-15`, note: '压测生成' }],
      identity: 'secretary'
    });

    if (type === '正式党员' || type === '预备党员') {
      // 每名党员生成 6 个月党费记录
      for (const ym of months) {
        feeRecords.push({
          member_id: id,
          year_month: ym,
          amount: i % 10 === 0 ? 35 : 0.2,
          status: ym === months[5] && i % 5 === 0 ? '欠缴' : '已缴',
          paid_date: ym === months[5] && i % 5 === 0 ? undefined : `${ym}-08`,
          identity: 'secretary'
        });
      }
      // 每名党员生成 8 条年度积分流水
      for (let p = 0; p < 8; p += 1) {
        pointRecords.push({
          id: `pt-${id}-${p}`,
          member_id: id,
          year,
          date: `${year}-${String((p % 10) + 1).padStart(2, '0')}-12`,
          category: p === 0 ? 'bonus' : p === 7 ? 'base' : 'duty',
          sub_category:
            p === 0
              ? 'bonus'
              : p === 7
                ? 'base_discipline_meeting'
                : p % 3 === 0
                  ? 'duty_study'
                  : p % 3 === 1
                    ? 'duty_practice'
                    : 'duty_volunteer',
          rule_id: `rule-${p}`,
          rule_label: `压测规则项 ${p + 1}`,
          content: `测试党员${i + 1}年度积分记录明细 #${p + 1}`,
          score: p === 7 ? -1 : 2,
          status: p === 6 ? '待核实' : '已认定',
          created_at: `${year}-05-01`,
          identity: 'secretary'
        });
      }
    }

    // 每 2 人生成 1 条谈心谈话记录
    if (i % 2 === 0) {
      talks.push({
        id: `tk-${i}`,
        date: `${year}-${String((i % 10) + 1).padStart(2, '0')}-15`,
        type: '日常谈话',
        member_ids: [id],
        initiator: 'BENCH_0001',
        recorder: 'BENCH_0001',
        content: `与测试党员${i + 1}开展季度思想交流与学业帮扶谈心谈话。`,
        identity: 'secretary'
      });
    }
  }

  // 生成 60 条全年台历/三会一课记录
  for (let e = 0; e < 60; e += 1) {
    calEvents.push({
      id: `ev-${e}`,
      title: `第 ${e + 1} 次支部组织生活与主题党日`,
      date: `${year}-${String((e % 12) + 1).padStart(2, '0')}-${String((e % 25) + 1).padStart(2, '0')}`,
      category: '三会一课',
      kind: '支委会',
      status: '已完成',
      identity: 'secretary'
    });
  }

  return { year, months, members, devStages, feeRecords, talks, pointRecords, calEvents };
}

async function runTier(memberCount: number) {
  const ds = generateSyntheticDataset(memberCount);
  const memberMap = new Map(ds.members.map(m => [m.id, m]));
  const partyMembers = ds.members.filter(m => m.type === '正式党员' || m.type === '预备党员');

  // 1. 党员积分汇总对比（旧 O(M×R) vs 新 O(M+R)）
  const tOldPts0 = performance.now();
  for (const m of partyMembers) {
    computeMemberYearPoints(m, ds.year, ds.pointRecords, undefined);
  }
  const oldPointsMs = performance.now() - tOldPts0;

  const tNewPts0 = performance.now();
  const byMember = new Map<string, Sct.PointRecord[]>();
  for (const r of ds.pointRecords) {
    if (r.year !== ds.year) continue;
    const arr = byMember.get(r.member_id);
    if (arr) arr.push(r);
    else byMember.set(r.member_id, [r]);
  }
  const summaries = partyMembers.map(m => computeMemberYearPoints(m, ds.year, byMember.get(m.id) ?? [], undefined));
  const newPointsMs = performance.now() - tNewPts0;

  // 2. 谈心谈话覆盖矩阵（仅覆盖预备/正式党员，O(T)+O(M)）
  const tTalk0 = performance.now();
  const yearPrefix = String(ds.year);
  const latestTalk = new Map<string, Sct.Talk>();
  for (const t of ds.talks) {
    if (!t.date.startsWith(yearPrefix)) continue;
    for (const mid of t.member_ids) {
      const prev = latestTalk.get(mid);
      if (!prev || t.date > prev.date) latestTalk.set(mid, t);
    }
  }
  const talkCoverage = partyMembers.map(m => ({ member: m, latest: latestTalk.get(m.id) }));
  const talksMs = performance.now() - tTalk0;

  // 3. 党员发展泳道分组 + next_node 重算 + 材料解析
  const tDev0 = performance.now();
  const grouped = new Map<string, Sct.DevStage[]>();
  for (const s of DEV_STAGE_ORDER) grouped.set(s, []);
  let completedFormalCount = 0;
  for (const d of ds.devStages) {
    const m = memberMap.get(d.member_id);
    if (!m) continue;
    const nextNode = computeNextDevNode(d.stage, d.materials);
    if (d.stage === '正式党员' && nextNode === '') completedFormalCount += 1;
    grouped.get(d.stage)?.push(d);
  }
  // 额外模拟抽屉打开解析全部节点材料
  const sampleNodes = nodesOfStage('发展对象');
  for (const n of sampleNodes) resolveNodeMaterials(n, ds.devStages[0]?.materials);
  const devMs = performance.now() - tDev0;

  // 4. 党费收缴矩阵 Map + 单月批量标记已缴计算
  const tFee0 = performance.now();
  const recMap = new Map<string, Sct.FeeRecord>();
  for (const f of ds.feeRecords) recMap.set(`${f.member_id}|${f.year_month}`, f);
  const latestYm = ds.months[5];
  const batchToMark = partyMembers.filter(m => {
    const st = recMap.get(`${m.id}|${latestYm}`)?.status;
    return !st || st === '欠缴';
  });
  const feeMs = performance.now() - tFee0;

  // 5. .sctpack 封装加密 & 解包校验 + 同步体积测量
  const payload: SctPackPayload = {
    format: 'sctpack',
    packVersion: 1,
    schemaVersion: 5,
    appVersion: 'v0.2.6',
    exported_at: new Date().toISOString(),
    branch_name: '压测党支部',
    categories: ['core', 'library'],
    backup: {
      schemaVersion: 5,
      app_version: 'v0.2.6',
      exported_at: new Date().toISOString(),
      branch_name: '压测党支部',
      members: ds.members,
      seat_maps: [],
      cal_events: ds.calEvents,
      dev_stages: ds.devStages,
      fee_records: ds.feeRecords,
      talks: ds.talks,
      doc_templates: [],
      docs: [],
      attendance: [],
      point_records: ds.pointRecords,
      point_vetoes: []
    }
  };
  const rawJsonBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');

  const tEnc0 = performance.now();
  const packedBytes = await encodeSctPackBytes(payload);
  const encMs = performance.now() - tEnc0;

  const tDec0 = performance.now();
  const inspected = await inspectImportBytes(packedBytes);
  const decMs = performance.now() - tDec0;

  if (inspected.status !== 'ready') {
    throw new Error(`解包校验失败: ${JSON.stringify(inspected)}`);
  }

  return {
    memberCount,
    partyCount: partyMembers.length,
    feeRecordCount: ds.feeRecords.length,
    pointRecordCount: ds.pointRecords.length,
    talkCount: ds.talks.length,
    oldPointsMs: Number(oldPointsMs.toFixed(2)),
    newPointsMs: Number(newPointsMs.toFixed(2)),
    speedup: `${(oldPointsMs / Math.max(0.01, newPointsMs)).toFixed(1)}x`,
    talksMs: Number(talksMs.toFixed(2)),
    talkCovered: talkCoverage.filter(c => Boolean(c.latest)).length,
    devMs: Number(devMs.toFixed(2)),
    completedFormalCount,
    feeMs: Number(feeMs.toFixed(2)),
    batchUnpaidCount: batchToMark.length,
    rawJsonKB: Number((rawJsonBytes / 1024).toFixed(1)),
    sctpackKB: Number((packedBytes.byteLength / 1024).toFixed(1)),
    compressionPct: `${((1 - packedBytes.byteLength / rawJsonBytes) * 100).toFixed(1)}%`,
    encMs: Number(encMs.toFixed(1)),
    decMs: Number(decMs.toFixed(1)),
    summariesCount: summaries.length
  };
}

async function main() {
  console.log('=== 三尺台 v0.2.6 大规模人数性能压测（50 / 200 / 500 人） ===\n');
  const results = [];
  for (const tier of [50, 200, 500]) {
    results.push(await runTier(tier));
  }
  console.table(
    results.map(r => ({
      规模: `${r.memberCount}人 (党员${r.partyCount})`,
      积分旧耗时ms: r.oldPointsMs,
      积分新耗时ms: r.newPointsMs,
      提速倍数: r.speedup,
      谈话覆盖ms: r.talksMs,
      发展泳道ms: r.devMs,
      党费矩阵ms: r.feeMs,
      明文KB: r.rawJsonKB,
      sctpackKB: r.sctpackKB,
      压缩率: r.compressionPct,
      加密ms: r.encMs,
      解密ms: r.decMs
    }))
  );
  console.log('\n详细校验：');
  for (const r of results) {
    console.log(
      `- [${r.memberCount}人] 正式党员全部归档自动清零待办=${r.completedFormalCount}人 | 党费记录=${r.feeRecordCount}条 | 积分流水=${r.pointRecordCount}条 | 同步体积占比=${((r.rawJsonKB / (64 * 1024)) * 100).toFixed(2)}% (64MB上限)`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
