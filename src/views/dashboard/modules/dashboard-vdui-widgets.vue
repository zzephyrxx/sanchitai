<script setup lang="ts">
/**
 * 统计总览创意可视化组件集（v0.2.7 精修大尺寸版）
 * - 使用项目内置 ECharts（按需 Canvas 渲染）+ 轻量原生 SVG/CSS，零额外重型图表包、无 ResizeObserver 循环卡顿
 * - 适配 2 列宽幅卡片布局（xl:col-span-3），图表尺寸饱满清晰
 * - 统一响应「墨韵 / KONTUR 电子纸」双皮肤与「深 / 浅」四态配色
 * - 6 套组件：
 *   1. healthRadar      : 支部党建健康五维雷达（ECharts Radar + 指标清单）
 *   2. pointsGauge      : 党员积分 60+40 仪表盘（ECharts Gauge + 四档与履职均分）
 *   3. volunteerDonut   : 志愿服务时长来源环（ECharts Donut + 来源占比 & 志愿之星 Top 3）
 *   4. lifecycleWaffle  : 成员全生命周期 10×10 交互方格矩阵（原生响应式 Waffle + 悬停联动）
 *   5. talksThermometer : 年度谈心谈话覆盖温度计（高精 SVG 水银柱 + 待谈提醒）
 *   6. groupOnion       : 党小组综合活力同心环（ECharts Polar Rings + 三维明细排行）
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import VChart from 'vue-echarts';
import dayjs from 'dayjs';
import { getMemberLifecycle } from '@/constants/workspace-presets';
import { computeMemberYearPoints, formatScore, roundScore } from '@/utils/party-points';
import { roundHours } from '@/utils/volunteer';
import { setupEcharts } from '@/plugins/echarts';
import { useThemeStore } from '@/store/modules/theme';
import { useWorkDataStore } from '@/store/modules/work-data';
import { useSctI18n } from '@/hooks/common/sct-i18n';

defineOptions({ name: 'DashboardVduiWidgets' });

export type VduiWidgetId =
  | 'healthRadar'
  | 'pointsGauge'
  | 'volunteerDonut'
  | 'lifecycleWaffle'
  | 'talksThermometer'
  | 'groupOnion';

defineProps<{
  widgetId: VduiWidgetId;
}>();

setupEcharts();

const router = useRouter();
const workStore = useWorkDataStore();
const themeStore = useThemeStore();
const { bi } = useSctI18n();

const currentYear = dayjs().year();
const yearStr = String(currentYear);
const yearPrefix = `${yearStr}-`;

// ---------------- 主题感知配色（兼容墨韵/电子纸 × 深/浅四态） ----------------
const isDark = computed(() => themeStore.darkMode);
const isEpaper = computed(() => themeStore.themePreset === 'crm-frosted-glass');

const palette = computed(() => {
  const dark = isDark.value;
  const epaper = isEpaper.value;
  const accent = epaper ? (dark ? '#34B37E' : '#1E6B4B') : dark ? '#E0555D' : '#A81C24';
  const accentFill = epaper
    ? dark
      ? 'rgba(52, 179, 126, 0.28)'
      : 'rgba(30, 107, 75, 0.20)'
    : dark
      ? 'rgba(224, 85, 93, 0.28)'
      : 'rgba(168, 28, 36, 0.18)';
  const secondary = dark ? '#60A5FA' : epaper ? '#1D4ED8' : '#2563EB';
  const emerald = dark ? '#34D399' : '#16A34A';
  const teal = dark ? '#2DD4BF' : '#0F766E';
  const amber = dark ? '#FBBF24' : '#D97706';
  const crimson = dark ? '#F87171' : '#DC2626';
  const slate = dark ? '#94A3B8' : '#64748B';
  return {
    ink: dark ? '#E5E3DE' : '#2B2926',
    muted: dark ? '#9CA3AF' : '#6B7280',
    grid: dark ? '#323846' : '#E2DED6',
    track: dark ? '#232834' : '#EEECE6',
    surface: dark ? '#181C26' : '#FFFFFF',
    accent,
    accentFill,
    secondary,
    emerald,
    teal,
    amber,
    crimson,
    slate,
    series: [accent, secondary, emerald, amber, teal, '#8B5CF6']
  };
});

// ---------------- 基础聚合数据（仅统计在册口径，防归档脏数据） ----------------
const activePartyMembers = computed(() =>
  workStore.activeMembers.filter(m => m.type === '正式党员' || m.type === '预备党员')
);

const yearPointSummaries = computed(() => {
  const scheme = workStore.activePointScheme;
  const vetoMap = new Map(workStore.pointVetoes.filter(v => v.year === currentYear).map(v => [v.member_id, v]));
  const recMap = new Map<string, Sct.PointRecord[]>();
  for (const r of workStore.pointRecords) {
    if (r.year !== currentYear) continue;
    const arr = recMap.get(r.member_id);
    if (arr) arr.push(r);
    else recMap.set(r.member_id, [r]);
  }
  return activePartyMembers.value.map(m =>
    computeMemberYearPoints(m, currentYear, recMap.get(m.id) ?? [], vetoMap.get(m.id), scheme)
  );
});

const attendanceRatePct = computed(() => {
  const yearEventIds = new Set(
    workStore.calEvents.filter(e => e.date.startsWith(yearPrefix) && e.status !== '已取消').map(e => e.id)
  );
  const rows = workStore.attendance.filter(a => yearEventIds.has(a.event_id));
  if (!rows.length) return 100;
  const present = rows.filter(a => a.status === '到会' || a.status === '迟到').length;
  return Math.round((present / rows.length) * 100);
});

const feeOnTimeRatePct = computed(() => {
  const activeIds = new Set(workStore.inBranchRosterMembers.map(m => m.id));
  const rows = workStore.feeRecords.filter(
    f => f.year_month.startsWith(yearPrefix) && f.status !== '未在校' && activeIds.has(f.member_id)
  );
  if (!rows.length) return 100;
  const ok = rows.filter(f => f.status === '已缴' || f.status === '减免').length;
  return Math.round((ok / rows.length) * 100);
});

const talksCoverageStats = computed(() => {
  const coveredSet = new Set(workStore.talks.filter(t => t.date.startsWith(yearPrefix)).flatMap(t => t.member_ids));
  const total = activePartyMembers.value.length;
  const uncovered = activePartyMembers.value.filter(m => !coveredSet.has(m.id));
  const covered = total - uncovered.length;
  const pct = total ? Math.round((covered / total) * 100) : 0;
  return { total, covered, uncovered, pct };
});

const volunteerStats = computed(() => {
  const verifiedActs = workStore.volunteerActivities.filter(
    a => a.status === '已认定' && a.date.startsWith(yearPrefix)
  );
  const bySource = new Map<Sct.VolunteerSource, number>();
  const byMember = new Map<string, { name: string; hours: number; count: number }>();
  let totalHours = 0;

  for (const act of verifiedActs) {
    let actHours = 0;
    for (const p of act.participants) {
      const h = Number(p.hours) || 0;
      actHours += h;
      const cur = byMember.get(p.member_id) ?? { name: p.name_snapshot, hours: 0, count: 0 };
      cur.hours = roundHours(cur.hours + h);
      cur.count += 1;
      byMember.set(p.member_id, cur);
    }
    totalHours = roundHours(totalHours + actHours);
    bySource.set(act.source, roundHours((bySource.get(act.source) ?? 0) + actHours));
  }

  const activeIds = new Set(workStore.activeMembers.map(m => m.id));
  const activeParticipantCount = [...byMember.keys()].filter(id => activeIds.has(id)).length;
  const participationPct = workStore.activeMembers.length
    ? Math.round((activeParticipantCount / workStore.activeMembers.length) * 100)
    : 0;

  const topMembers = [...byMember.entries()]
    .map(([id, stat]) => ({ id, ...stat }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 3);

  const sourceList: Array<{ key: Sct.VolunteerSource; hours: number; pct: number; color: string }> = (
    [
      { key: '支部内部', color: palette.value.accent },
      { key: '校院活动', color: palette.value.emerald },
      { key: '社会公益', color: palette.value.secondary },
      { key: '其他', color: palette.value.amber }
    ] as const
  )
    .map(item => {
      const hours = bySource.get(item.key) ?? 0;
      return {
        key: item.key,
        hours,
        pct: totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0,
        color: item.color
      };
    })
    .filter(item => item.hours > 0);

  return {
    activityCount: verifiedActs.length,
    totalHours,
    sourceList,
    topMembers,
    participationPct
  };
});

const pointsStats = computed(() => {
  const list = yearPointSummaries.value;
  if (!list.length) {
    return {
      avg: 0,
      passRate: 100,
      excellent: 0,
      good: 0,
      pass: 0,
      warn: 0,
      avgStudy: 0,
      avgPractice: 0,
      avgVol: 0
    };
  }
  const avg = roundScore(list.reduce((acc, s) => acc + s.totalScore, 0) / list.length);
  const warn = list.filter(s => s.isWarning).length;
  const excellent = list.filter(s => !s.isWarning && s.totalScore >= 85).length;
  const good = list.filter(s => !s.isWarning && s.totalScore >= 75 && s.totalScore < 85).length;
  const pass = list.filter(s => !s.isWarning && s.totalScore < 75).length;
  const passRate = Math.round(((list.length - warn) / list.length) * 100);
  const avgStudy = roundScore(list.reduce((acc, s) => acc + s.dutyStudyScore, 0) / list.length);
  const avgPractice = roundScore(list.reduce((acc, s) => acc + s.dutyPracticeScore, 0) / list.length);
  const avgVol = roundScore(list.reduce((acc, s) => acc + s.dutyVolunteerScore, 0) / list.length);
  return { avg, passRate, excellent, good, pass, warn, avgStudy, avgPractice, avgVol };
});

// ---------------- 1. 支部党建健康五维雷达（ECharts Radar） ----------------
const healthMetrics = computed(() => [
  { key: 'attend', label: bi('会议出勤', 'Attend'), value: attendanceRatePct.value, color: palette.value.accent },
  { key: 'fee', label: bi('党费按期', 'Dues'), value: feeOnTimeRatePct.value, color: palette.value.emerald },
  { key: 'talks', label: bi('谈话覆盖', 'Talks'), value: talksCoverageStats.value.pct, color: palette.value.teal },
  {
    key: 'vol',
    label: bi('志愿参与', 'Volunteer'),
    value: volunteerStats.value.participationPct,
    color: palette.value.secondary
  },
  { key: 'points', label: bi('积分合格', 'Points'), value: pointsStats.value.passRate, color: palette.value.amber }
]);

const healthCompositeIndex = computed(() => {
  const list = healthMetrics.value;
  return Math.round(list.reduce((acc, m) => acc + m.value, 0) / list.length);
});

const radarOption = computed(() => {
  const p = palette.value;
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: p.surface,
      borderColor: p.grid,
      textStyle: { color: p.ink, fontSize: 12 }
    },
    radar: {
      radius: '68%',
      center: ['50%', '52%'],
      splitNumber: 4,
      indicator: healthMetrics.value.map(m => ({ name: m.label, max: 100 })),
      axisName: {
        color: p.ink,
        fontSize: 12,
        fontWeight: 600
      },
      axisLine: { lineStyle: { color: p.grid } },
      splitLine: { lineStyle: { color: p.grid } },
      splitArea: {
        areaStyle: {
          color: isDark.value
            ? ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.035)']
            : ['rgba(0,0,0,0.01)', 'rgba(0,0,0,0.028)']
        }
      }
    },
    series: [
      {
        name: bi('支部党建健康指数', 'Branch Health Index'),
        type: 'radar',
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: p.accent, width: 2.2 },
        itemStyle: { color: p.accent, borderColor: p.surface, borderWidth: 1.5 },
        areaStyle: { color: p.accentFill },
        data: [
          {
            value: healthMetrics.value.map(m => m.value),
            name: `${yearStr} 年度五维指数`
          }
        ]
      }
    ]
  };
});

// ---------------- 2. 党员积分 60+40 仪表盘（ECharts Gauge） ----------------
const gaugeLevelMeta = computed(() => {
  const avg = pointsStats.value.avg;
  if (avg < 60) return { label: '低于及格线', color: palette.value.crimson };
  if (avg < 75) return { label: '基础合格', color: palette.value.amber };
  if (avg < 85) return { label: '支部良好', color: palette.value.secondary };
  return { label: '支部优秀', color: palette.value.emerald };
});

const gaugeOption = computed(() => {
  const p = palette.value;
  const val = Math.min(100, Math.max(0, pointsStats.value.avg));
  return {
    series: [
      {
        type: 'gauge',
        startAngle: 205,
        endAngle: -25,
        min: 0,
        max: 100,
        splitNumber: 5,
        radius: '94%',
        center: ['50%', '62%'],
        axisLine: {
          lineStyle: {
            width: 16,
            color: [
              [0.6, p.crimson],
              [0.75, p.amber],
              [0.85, p.secondary],
              [1, p.emerald]
            ]
          }
        },
        pointer: {
          icon: 'path://M-3,0 L0,-76 L3,0 Z',
          length: '66%',
          width: 7,
          offsetCenter: [0, '-6%'],
          itemStyle: { color: p.ink }
        },
        anchor: {
          show: true,
          showAbove: true,
          size: 12,
          itemStyle: { color: p.surface, borderColor: p.ink, borderWidth: 3 }
        },
        axisTick: {
          distance: -16,
          length: 5,
          lineStyle: { color: p.surface, width: 1.5 }
        },
        splitLine: {
          distance: -16,
          length: 16,
          lineStyle: { color: p.surface, width: 2 }
        },
        axisLabel: {
          color: p.muted,
          distance: 22,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace'
        },
        title: {
          show: true,
          offsetCenter: [0, '38%'],
          color: p.muted,
          fontSize: 11.5
        },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '18%'],
          fontSize: 28,
          fontWeight: 800,
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          color: gaugeLevelMeta.value.color,
          formatter: (v: number) => `${v.toFixed(1)} 分`
        },
        data: [{ value: val, name: `支部均分 · ${gaugeLevelMeta.value.label}` }]
      }
    ]
  };
});

// ---------------- 3. 志愿服务时长来源环（ECharts Donut） ----------------
const volunteerDonutOption = computed(() => {
  const p = palette.value;
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: p.surface,
      borderColor: p.grid,
      textStyle: { color: p.ink, fontSize: 12 },
      formatter: '{b}：{c} h（{d}%）'
    },
    series: [
      {
        name: '志愿时长来源',
        type: 'pie',
        radius: ['56%', '84%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: isEpaper.value ? 0 : 5,
          borderColor: p.surface,
          borderWidth: 2
        },
        label: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 5
        },
        data: volunteerStats.value.sourceList.map(s => ({
          name: s.key,
          value: s.hours,
          itemStyle: { color: s.color }
        }))
      }
    ]
  };
});

// ---------------- 4. 成员全生命周期 10×10 交互方格矩阵（原生 Waffle） ----------------
const hoveredLifecycleKey = ref<string | null>(null);

const lifecycleItems = computed(() => {
  const counts = {
    activeNormal: 0,
    transferringOut: 0,
    incomingAudit: 0,
    floating: 0,
    archived: 0
  };
  for (const m of workStore.members) {
    const st = getMemberLifecycle(m);
    if (st === '在册正常') counts.activeNormal += 1;
    else if (st === '转出办理中') counts.transferringOut += 1;
    else if (st === '转入待核查') counts.incomingAudit += 1;
    else if (st === '流出党员' || st === '流入党员') counts.floating += 1;
    else counts.archived += 1;
  }
  const total = workStore.members.length;
  const defs = [
    { key: 'activeNormal', label: '在册正常', count: counts.activeNormal, color: palette.value.emerald },
    { key: 'transferringOut', label: '转出办理中', count: counts.transferringOut, color: palette.value.crimson },
    { key: 'incomingAudit', label: '转入待核查', count: counts.incomingAudit, color: palette.value.amber },
    { key: 'floating', label: '流动党员', count: counts.floating, color: palette.value.secondary },
    { key: 'archived', label: '历史归档', count: counts.archived, color: palette.value.slate }
  ];
  return {
    total,
    counts,
    defs: defs.map(d => ({
      ...d,
      pct: total > 0 ? Math.round((d.count / total) * 100) : 0
    }))
  };
});

/** 精确分配 100 个方格（确保非零状态至少占 1 格且合计严格为 100 格） */
const waffleCells = computed(() => {
  const { total, defs } = lifecycleItems.value;
  if (!total) return [];
  const activeDefs = defs.filter(d => d.count > 0);
  const rawAlloc = activeDefs.map(d => {
    const exact = (d.count / total) * 100;
    const base = Math.max(1, Math.floor(exact));
    return { ...d, cells: base, remainder: exact - Math.floor(exact) };
  });
  let sum = rawAlloc.reduce((acc, r) => acc + r.cells, 0);
  while (sum < 100) {
    rawAlloc.sort((a, b) => b.remainder - a.remainder);
    rawAlloc[0].cells += 1;
    rawAlloc[0].remainder = -1;
    sum += 1;
  }
  while (sum > 100) {
    const largest = rawAlloc.filter(r => r.cells > 1).sort((a, b) => b.cells - a.cells)[0];
    if (!largest) break;
    largest.cells -= 1;
    sum -= 1;
  }
  const orderMap = new Map(defs.map((d, i) => [d.key, i]));
  rawAlloc.sort((a, b) => (orderMap.get(a.key) ?? 0) - (orderMap.get(b.key) ?? 0));

  const cells: Array<{ key: string; label: string; color: string }> = [];
  for (const item of rawAlloc) {
    for (let i = 0; i < item.cells; i += 1) {
      cells.push({ key: item.key, label: `${item.label}：${item.count}人 (${item.pct}%)`, color: item.color });
    }
  }
  return cells;
});

// ---------------- 5. 年度谈心谈话覆盖温度计（高精原生 SVG 水银柱） ----------------
const thermoLiquidHeight = computed(() => {
  const pct = Math.min(100, Math.max(0, talksCoverageStats.value.pct));
  // 玻璃管有效刻度区间：y=26（100%）到 y=172（0%），高度 146
  return Math.round((pct / 100) * 146);
});
const thermoLiquidY = computed(() => 172 - thermoLiquidHeight.value);
const thermoTicks = [100, 75, 50, 25, 0];

// ---------------- 6. 党小组综合活力同心环（ECharts Polar Rings） ----------------
const groupVitalityList = computed(() => {
  const yearEvents = new Set(
    workStore.calEvents.filter(e => e.date.startsWith(yearPrefix) && e.status !== '已取消').map(e => e.id)
  );
  const volHoursByMember = new Map<string, number>();
  for (const act of workStore.volunteerActivities) {
    if (act.status !== '已认定' || !act.date.startsWith(yearPrefix)) continue;
    for (const p of act.participants) {
      volHoursByMember.set(p.member_id, (volHoursByMember.get(p.member_id) ?? 0) + (Number(p.hours) || 0));
    }
  }
  const talkedSet = new Set(workStore.talks.filter(t => t.date.startsWith(yearPrefix)).flatMap(t => t.member_ids));

  const nonEmptyGroups = workStore.partyGroupNames
    .map(groupName => ({
      groupName,
      members: workStore.activeMembers.filter(m => (m.group ?? '').trim() === groupName)
    }))
    .filter(g => g.members.length > 0)
    .slice(0, 5);

  return nonEmptyGroups
    .map(({ groupName, members }, idx) => {
      const memberIds = new Set(members.map(m => m.id));
      const attRows = workStore.attendance.filter(a => yearEvents.has(a.event_id) && memberIds.has(a.member_id));
      const attRate = attRows.length
        ? Math.round((attRows.filter(a => a.status === '到会' || a.status === '迟到').length / attRows.length) * 100)
        : 80;
      const talkedRate = Math.round((members.filter(m => talkedSet.has(m.id)).length / members.length) * 100);
      const volRate = Math.round(
        (members.filter(m => (volHoursByMember.get(m.id) ?? 0) > 0).length / members.length) * 100
      );
      const composite = Math.min(100, Math.max(0, Math.round(attRate * 0.4 + talkedRate * 0.3 + volRate * 0.3)));

      return {
        name: groupName,
        memberCount: members.length,
        attRate,
        talkedRate,
        volRate,
        score: composite,
        color: palette.value.series[idx % palette.value.series.length]
      };
    })
    .sort((a, b) => b.score - a.score);
});

const groupOnionOption = computed(() => {
  const p = palette.value;
  // 由内向外排布，让最高活力组占据最外圈主视觉
  const ringOrder = [...groupVitalityList.value].reverse();
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: p.surface,
      borderColor: p.grid,
      textStyle: { color: p.ink, fontSize: 12 },
      formatter: (params: { dataIndex: number }) => {
        const g = ringOrder[params.dataIndex];
        if (!g) return '';
        return `<b>${g.name}</b>（${g.memberCount}人）<br/>综合活力：<b>${g.score} 分</b><br/>出勤 ${g.attRate}% · 谈话 ${g.talkedRate}% · 志愿 ${g.volRate}%`;
      }
    },
    polar: {
      radius: ['22%', '90%'],
      center: ['50%', '50%']
    },
    angleAxis: {
      max: 100,
      startAngle: 90,
      show: false
    },
    radiusAxis: {
      type: 'category',
      data: ringOrder.map(g => g.name),
      show: false
    },
    series: [
      {
        type: 'bar',
        coordinateSystem: 'polar',
        roundCap: !isEpaper.value,
        barWidth: ringOrder.length <= 3 ? 16 : 12,
        showBackground: true,
        backgroundStyle: { color: p.track },
        data: ringOrder.map(g => ({
          value: g.score,
          itemStyle: { color: g.color }
        }))
      }
    ]
  };
});
</script>

<template>
  <!-- 1. 支部党建健康五维雷达 -->
  <NCard v-if="widgetId === 'healthRadar'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:radar" class="text-16px text-[var(--sct-accent)]" />
        <span>{{ bi('支部党建健康五维雷达', 'Branch Health Radar') }}</span>
      </div>
    </template>
    <template #header-extra>
      <div class="flex items-center gap-6px">
        <span class="text-11px text-[var(--sct-muted)]">{{ yearStr }} 综合指数</span>
        <span class="font-mono text-14px font-extrabold text-[var(--sct-accent)]">{{ healthCompositeIndex }}</span>
      </div>
    </template>
    <div class="grid grid-cols-1 items-center gap-14px sm:grid-cols-12">
      <div class="sm:col-span-7">
        <VChart :option="radarOption" autoresize class="h-255px w-full" />
      </div>
      <div class="flex flex-col gap-10px sm:col-span-5">
        <div v-for="m in healthMetrics" :key="m.key" class="flex flex-col gap-4px">
          <div class="flex items-center justify-between text-12px">
            <span class="flex items-center gap-6px font-medium text-[var(--sct-ink)]">
              <span class="inline-block size-7px rounded-full" :style="{ background: m.color }" />
              {{ m.label }}
            </span>
            <span class="font-mono text-12.5px font-bold text-[var(--sct-ink)]">{{ m.value }}%</span>
          </div>
          <div class="h-6px w-full overflow-hidden rounded-full bg-[var(--sct-soft)]">
            <div
              class="h-full transition-all duration-500"
              :style="{ width: `${m.value}%`, backgroundColor: m.color }"
            />
          </div>
        </div>
      </div>
    </div>
  </NCard>

  <!-- 2. 党员积分 60+40 仪表盘 -->
  <NCard v-else-if="widgetId === 'pointsGauge'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:gauge" class="text-16px text-[#d97706]" />
        <span>{{ bi('党员积分 60+40 仪表盘', 'Party Points Gauge') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/points')">积分台账 →</NButton>
    </template>
    <div class="grid grid-cols-1 items-center gap-14px sm:grid-cols-12">
      <div class="sm:col-span-7">
        <VChart :option="gaugeOption" autoresize class="h-255px w-full" />
      </div>
      <div class="flex flex-col gap-12px sm:col-span-5">
        <div class="grid grid-cols-2 gap-8px text-center">
          <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] py-8px">
            <div class="text-11px text-[var(--sct-muted)]">优秀 (≥85)</div>
            <div class="mt-2px font-mono text-18px font-extrabold text-[#16a34a]">{{ pointsStats.excellent }}</div>
          </div>
          <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] py-8px">
            <div class="text-11px text-[var(--sct-muted)]">良好 (75~84)</div>
            <div class="mt-2px font-mono text-18px font-extrabold text-[#2563eb]">{{ pointsStats.good }}</div>
          </div>
          <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] py-8px">
            <div class="text-11px text-[var(--sct-muted)]">合格 (60~74)</div>
            <div class="mt-2px font-mono text-18px font-extrabold text-[#d97706]">{{ pointsStats.pass }}</div>
          </div>
          <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-soft)] py-8px">
            <div class="text-11px text-[var(--sct-muted)]">预警 (&lt;60)</div>
            <div class="mt-2px font-mono text-18px font-extrabold text-[#dc2626]">{{ pointsStats.warn }}</div>
          </div>
        </div>
        <div class="rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] px-10px py-8px">
          <div class="mb-6px text-11px font-semibold text-[var(--sct-muted)]">履职分三项支部均分</div>
          <div class="flex flex-col gap-5px font-mono text-12px">
            <div class="flex items-center justify-between">
              <span class="text-[var(--sct-muted)]">专业学习</span>
              <span class="font-bold text-[var(--sct-ink)]">
                {{ formatScore(pointsStats.avgStudy) }}
                <span class="text-10.5px font-normal text-[var(--sct-muted)]">/ 15</span>
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[var(--sct-muted)]">实践活动</span>
              <span class="font-bold text-[var(--sct-ink)]">
                {{ formatScore(pointsStats.avgPractice) }}
                <span class="text-10.5px font-normal text-[var(--sct-muted)]">/ 10</span>
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[var(--sct-muted)]">志愿服务</span>
              <span class="font-bold text-[var(--sct-ink)]">
                {{ formatScore(pointsStats.avgVol) }}
                <span class="text-10.5px font-normal text-[var(--sct-muted)]">/ 15</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </NCard>

  <!-- 3. 志愿服务时长统计卡 -->
  <NCard v-else-if="widgetId === 'volunteerDonut'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:heart-handshake" class="text-16px text-[#16a34a]" />
        <span>{{ bi('志愿服务时长统计', 'Volunteer Hours') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/volunteer')">志愿台账 →</NButton>
    </template>
    <div v-if="volunteerStats.sourceList.length" class="grid grid-cols-1 items-center gap-16px sm:grid-cols-12">
      <div class="relative sm:col-span-6">
        <VChart :option="volunteerDonutOption" autoresize class="h-245px w-full" />
        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-11px text-[var(--sct-muted)]">{{ yearStr }} 总时长</span>
          <span class="mt-2px font-mono text-24px font-black leading-none text-[var(--sct-ink)]">
            {{ volunteerStats.totalHours }}
            <span class="text-13px font-semibold text-[var(--sct-muted)]">h</span>
          </span>
          <span class="mt-3px text-11px text-[var(--sct-muted)]">已认定 {{ volunteerStats.activityCount }} 场</span>
        </div>
      </div>

      <div class="flex flex-col gap-12px sm:col-span-6">
        <div class="flex flex-col gap-6px">
          <div class="text-11.5px font-semibold text-[var(--sct-muted)]">活动来源占比</div>
          <div
            v-for="src in volunteerStats.sourceList"
            :key="src.key"
            class="flex items-center justify-between text-12px"
          >
            <span class="flex items-center gap-7px text-[var(--sct-ink)]">
              <span class="inline-block size-8px rounded-2px" :style="{ backgroundColor: src.color }" />
              <span>{{ src.key }}</span>
            </span>
            <span class="font-mono text-12px font-semibold text-[var(--sct-ink)]">
              {{ src.hours }}h
              <span class="ml-3px text-11px font-normal text-[var(--sct-muted)]">({{ src.pct }}%)</span>
            </span>
          </div>
        </div>

        <div v-if="volunteerStats.topMembers.length" class="border-t border-dashed border-[var(--sct-border)] pt-10px">
          <div class="mb-6px flex items-center justify-between text-11.5px text-[var(--sct-muted)]">
            <span class="font-semibold">本年志愿之星 Top {{ volunteerStats.topMembers.length }}</span>
            <span class="font-mono">参与率 {{ volunteerStats.participationPct }}%</span>
          </div>
          <div class="flex flex-col gap-6px">
            <div
              v-for="(m, idx) in volunteerStats.topMembers"
              :key="m.id"
              class="flex items-center justify-between rounded-6px bg-[var(--sct-soft)] px-8px py-5px text-12px"
            >
              <span class="flex items-center gap-6px truncate">
                <span class="w-18px text-center font-mono text-11px font-extrabold text-[#16a34a]">#{{ idx + 1 }}</span>
                <span class="font-semibold text-[var(--sct-ink)]">{{ m.name }}</span>
              </span>
              <span class="font-mono text-12px font-bold text-[#16a34a]">{{ m.hours }}h · {{ m.count }}次</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="flex h-245px flex-col items-center justify-center gap-8px text-12.5px text-[var(--sct-muted)]">
      <SvgIcon icon="lucide:heart-handshake" class="text-32px opacity-35" />
      <span>{{ yearStr }} 年度暂无已认定志愿活动</span>
      <NButton size="small" secondary type="primary" @click="router.push('/ledger/volunteer')">去登记首场活动</NButton>
    </div>
  </NCard>

  <!-- 4. 成员全生命周期 10×10 交互方格矩阵 -->
  <NCard v-else-if="widgetId === 'lifecycleWaffle'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:grid-3x3" class="text-16px text-[#2563eb]" />
        <span>{{ bi('成员全生命周期矩阵', 'Lifecycle Matrix') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/members')">花名册 →</NButton>
    </template>
    <div v-if="waffleCells.length" class="grid grid-cols-1 items-center gap-18px sm:grid-cols-12">
      <div class="flex justify-center sm:col-span-6">
        <div
          class="grid grid-cols-10 gap-4px p-4px"
          style="width: 224px; height: 224px"
          @mouseleave="hoveredLifecycleKey = null"
        >
          <div
            v-for="(cell, idx) in waffleCells"
            :key="idx"
            :title="cell.label"
            class="transition-all duration-150"
            :class="isEpaper ? 'rounded-0' : 'rounded-3px'"
            :style="{
              backgroundColor: cell.color,
              opacity: hoveredLifecycleKey && hoveredLifecycleKey !== cell.key ? 0.22 : 1,
              transform: hoveredLifecycleKey === cell.key ? 'scale(1.06)' : 'scale(1)'
            }"
            @mouseenter="hoveredLifecycleKey = cell.key"
          />
        </div>
      </div>

      <div class="flex flex-col gap-8px sm:col-span-6">
        <div class="text-11.5px text-[var(--sct-muted)]">
          每格 ≈ 1%，悬停聚焦状态 · 共
          <b class="font-mono text-[var(--sct-ink)]">{{ lifecycleItems.total }}</b>
          条档案
        </div>
        <div class="flex flex-col gap-6px">
          <div
            v-for="item in lifecycleItems.defs"
            :key="item.key"
            class="flex cursor-default items-center justify-between rounded-6px border border-transparent px-8px py-5px text-12.5px transition-colors"
            :class="hoveredLifecycleKey === item.key ? 'border-[var(--sct-border)] bg-[var(--sct-soft)]' : ''"
            @mouseenter="item.count > 0 && (hoveredLifecycleKey = item.key)"
            @mouseleave="hoveredLifecycleKey = null"
          >
            <span class="flex items-center gap-8px text-[var(--sct-ink)]">
              <span
                class="inline-block size-9px shrink-0"
                :class="isEpaper ? 'rounded-0' : 'rounded-2px'"
                :style="{ backgroundColor: item.color }"
              />
              <span class="font-medium">{{ item.label }}</span>
            </span>
            <span class="font-mono font-bold text-[var(--sct-ink)]">
              {{ item.count }} 人
              <span class="ml-4px text-11px font-normal text-[var(--sct-muted)]">{{ item.pct }}%</span>
            </span>
          </div>
        </div>
        <div class="pt-2px">
          <NTag
            v-if="!lifecycleItems.counts.transferringOut && !lifecycleItems.counts.incomingAudit"
            size="small"
            type="success"
            :bordered="false"
          >
            无待办转接积压
          </NTag>
          <div v-else class="flex flex-wrap gap-6px">
            <NTag v-if="lifecycleItems.counts.transferringOut > 0" size="small" type="error" :bordered="false">
              转出办理中 {{ lifecycleItems.counts.transferringOut }}
            </NTag>
            <NTag v-if="lifecycleItems.counts.incomingAudit > 0" size="small" type="warning" :bordered="false">
              转入待核查 {{ lifecycleItems.counts.incomingAudit }}
            </NTag>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="flex h-240px items-center justify-center text-12.5px text-[var(--sct-muted)]">暂无人员数据</div>
  </NCard>

  <!-- 5. 年度谈心谈话覆盖温度计 -->
  <NCard v-else-if="widgetId === 'talksThermometer'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:thermometer" class="text-16px text-[#0f766e]" />
        <span>{{ bi('年度谈话覆盖温度计', 'Talks Coverage Meter') }}</span>
      </div>
    </template>
    <template #header-extra>
      <NButton size="tiny" quaternary type="primary" @click="router.push('/ledger/talks')">去谈话 →</NButton>
    </template>
    <div class="flex flex-col items-center gap-16px sm:flex-row sm:items-stretch">
      <!-- 高精原生 SVG 温度计 -->
      <div class="flex shrink-0 items-center justify-center px-6px">
        <svg
          width="118"
          height="240"
          viewBox="0 0 118 240"
          role="img"
          :aria-label="`谈话覆盖率 ${talksCoverageStats.pct}%`"
        >
          <defs>
            <linearGradient id="sctThermoFill" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" :stop-color="palette.accent" />
              <stop offset="100%" :stop-color="palette.emerald" />
            </linearGradient>
            <clipPath id="sctThermoTubeClip">
              <rect x="44" y="18" width="24" height="162" rx="12" />
            </clipPath>
          </defs>
          <!-- 左侧刻度线与标签 -->
          <g v-for="t in thermoTicks" :key="t">
            <line
              x1="31"
              :y1="172 - (t / 100) * 146"
              x2="40"
              :y2="172 - (t / 100) * 146"
              :stroke="palette.grid"
              stroke-width="1.4"
            />
            <text
              x="27"
              :y="176 - (t / 100) * 146"
              text-anchor="end"
              font-size="10"
              font-family="ui-monospace, SFMono-Regular, monospace"
              :fill="palette.muted"
            >
              {{ t }}%
            </text>
          </g>
          <!-- 外玻璃管背景 -->
          <rect
            x="40"
            y="14"
            width="32"
            height="170"
            rx="16"
            :fill="palette.track"
            :stroke="palette.grid"
            stroke-width="1.5"
          />
          <!-- 底部玻璃球外框 -->
          <circle cx="56" cy="200" r="24" :fill="palette.track" :stroke="palette.grid" stroke-width="1.5" />
          <!-- 内部水银柱 -->
          <g clip-path="url(#sctThermoTubeClip)">
            <rect
              x="44"
              :y="thermoLiquidY"
              width="24"
              :height="thermoLiquidHeight + 24"
              fill="url(#sctThermoFill)"
              class="transition-all duration-500"
            />
          </g>
          <!-- 底部水银球 -->
          <circle cx="56" cy="200" r="18" :fill="palette.accent" />
          <!-- 玻璃高光 -->
          <rect x="48" y="24" width="4" height="142" rx="2" fill="rgba(255,255,255,0.28)" />
          <circle cx="49" cy="193" r="4.5" fill="rgba(255,255,255,0.34)" />
          <!-- 当前液面指示游标 -->
          <line x1="74" :y1="thermoLiquidY" x2="83" :y2="thermoLiquidY" :stroke="palette.ink" stroke-width="1.5" />
          <text
            x="86"
            :y="thermoLiquidY + 4"
            font-size="12"
            font-weight="800"
            font-family="ui-monospace, SFMono-Regular, monospace"
            :fill="palette.ink"
          >
            {{ talksCoverageStats.pct }}%
          </text>
        </svg>
      </div>

      <div class="min-w-0 flex-1 flex flex-col justify-between gap-12px py-4px">
        <div class="rounded-10px border border-[var(--sct-border)] bg-[var(--sct-soft)] px-14px py-12px">
          <div class="flex items-center justify-between text-12px text-[var(--sct-muted)]">
            <span>{{ yearStr }} 年在册党员谈话进度</span>
            <span class="font-mono font-bold text-[var(--sct-ink)]">{{ talksCoverageStats.pct }}%</span>
          </div>
          <div class="mt-4px flex items-baseline gap-6px font-mono">
            <span class="text-28px font-black leading-none text-[var(--sct-ink)]">
              {{ talksCoverageStats.covered }}
            </span>
            <span class="text-13px text-[var(--sct-muted)]">/ {{ talksCoverageStats.total }} 人已谈话</span>
          </div>
          <div class="mt-10px h-7px w-full overflow-hidden rounded-full bg-[var(--sct-container)]">
            <div
              class="h-full transition-all duration-500"
              :style="{
                width: `${talksCoverageStats.pct}%`,
                background: `linear-gradient(90deg, ${palette.accent}, ${palette.emerald})`
              }"
            />
          </div>
        </div>

        <div v-if="talksCoverageStats.uncovered.length" class="flex-1">
          <div class="mb-6px text-12px font-medium text-[var(--sct-muted)]">
            待安排谈话（{{ talksCoverageStats.uncovered.length }} 人）：
          </div>
          <div class="flex flex-wrap gap-6px">
            <NTag
              v-for="m in talksCoverageStats.uncovered.slice(0, 10)"
              :key="m.id"
              size="small"
              :bordered="false"
              type="warning"
            >
              {{ m.name }}
            </NTag>
            <span
              v-if="talksCoverageStats.uncovered.length > 10"
              class="self-center text-11.5px text-[var(--sct-muted)]"
            >
              +{{ talksCoverageStats.uncovered.length - 10 }} 人
            </span>
          </div>
        </div>
        <div
          v-else-if="talksCoverageStats.total > 0"
          class="flex items-center gap-6px rounded-8px bg-[var(--sct-ok-soft)] px-12px py-10px text-12.5px font-medium text-[#16a34a]"
        >
          <SvgIcon icon="lucide:check-circle-2" class="text-16px" />
          <span>本年度在册党员已全部完成谈话覆盖</span>
        </div>
        <div v-else class="text-12.5px text-[var(--sct-muted)]">暂无在册正式/预备党员</div>
      </div>
    </div>
  </NCard>

  <!-- 6. 党小组综合活力同心环 -->
  <NCard v-else-if="widgetId === 'groupOnion'" :bordered="false" class="h-full rounded-16px">
    <template #header>
      <div class="flex items-center gap-7px">
        <SvgIcon icon="lucide:orbit" class="text-16px text-[#7c5cd6]" />
        <span>{{ bi('党小组活力同心环', 'Party Group Vitality') }}</span>
      </div>
    </template>
    <template #header-extra>
      <span class="text-11.5px text-[var(--sct-muted)]">出勤 40% · 谈话 30% · 志愿 30%</span>
    </template>
    <div v-if="groupVitalityList.length" class="grid grid-cols-1 items-center gap-14px sm:grid-cols-12">
      <div class="sm:col-span-6">
        <VChart :option="groupOnionOption" autoresize class="h-245px w-full" />
      </div>
      <div class="flex flex-col gap-8px sm:col-span-6">
        <div
          v-for="g in groupVitalityList"
          :key="g.name"
          class="flex flex-col gap-3px rounded-8px border border-[var(--sct-border)] bg-[var(--sct-page)] px-10px py-7px"
        >
          <div class="flex items-center justify-between text-12.5px">
            <span class="flex items-center gap-7px truncate">
              <span class="inline-block size-8px shrink-0 rounded-full" :style="{ backgroundColor: g.color }" />
              <span class="truncate font-semibold text-[var(--sct-ink)]">{{ g.name }}</span>
              <span class="text-11px text-[var(--sct-muted)]">({{ g.memberCount }}人)</span>
            </span>
            <span class="shrink-0 font-mono text-13.5px font-extrabold" :style="{ color: g.color }">
              {{ g.score }} 分
            </span>
          </div>
          <div class="flex items-center gap-10px font-mono text-11px text-[var(--sct-muted)]">
            <span>勤 {{ g.attRate }}%</span>
            <span>谈 {{ g.talkedRate }}%</span>
            <span>志 {{ g.volRate }}%</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="flex h-240px items-center justify-center text-12.5px text-[var(--sct-muted)]">
      暂无党小组数据，可在「组织与流程」分组
    </div>
  </NCard>
</template>
