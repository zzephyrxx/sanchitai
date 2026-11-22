/**
 * 预备党员转正大会自动候选（A12）
 *
 * 预备期满日（key_dates.probation_end）前 7 天内，台历自动出现
 * 「预备党员转正大会（候选）」事项；同一成员同一期满日只生成一次。
 */
import dayjs from 'dayjs';
import { resolveEffectiveFullDate } from '@/utils/member-status';
import { db } from './db';

export async function ensureProbationCandidates(): Promise<void> {
  const today = dayjs();
  const probationers = await db.members.where('type').equals('预备党员').toArray();

  for (const m of probationers) {
    const end = resolveEffectiveFullDate(m.join_date, m.full_date, m.key_dates?.probation_end);
    if (!end) continue;

    const endD = dayjs(end);
    if (!endD.isValid()) continue;

    // 期满前 7 天 ~ 期满后 2 天 之内提示
    const diff = endD.diff(today, 'day');
    if (diff > 7 || diff < -2) continue;

    const candidateId = `probation-${m.id}-${end}`;
    const exists = await db.calEvents.get(candidateId);
    if (exists) continue;

    await db.calEvents.put({
      id: candidateId,
      title: `预备党员转正大会（候选·${m.name}）`,
      date: endD.subtract(1, 'day').format('YYYY-MM-DD'),
      start_time: '16:30',
      end_time: '18:00',
      location: '教六1115',
      category: '发展党员',
      kind: '党员大会',
      agenda: ['宣读转正申请书', '党内外群众意见汇报', '无记名投票表决', '公示安排（5 个工作日）'],
      recurrence: null,
      status: '计划',
      note: `固定时间会议：预备期满 ${end}，期满一年一两天内召开（自动生成候选，可调整）`,
      identity: 'secretary'
    });
  }
}
