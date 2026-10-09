import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effective, searchPolicies, shanghaiDay } from '../policy.mjs';
const policy = { title: '差旅制度', content: '住宿需发票', tags: '差旅', status: 'published', startsOn: '2026-10-01', endsOn: '2026-10-31' };
test('仅已发布且日期有效的制度可检索', () => { assert.equal(effective(policy, '2026-10-09'), true); for (const day of ['2026-09-30', '2026-11-01']) assert.equal(effective(policy, day), false); assert.equal(searchPolicies([{ ...policy, status: 'draft' }, { ...policy, status: 'withdrawn' }], '', '2026-10-09').length, 0); assert.equal(searchPolicies([policy], '住宿', '2026-10-09').length, 1); assert.equal(searchPolicies([policy], '餐饮', '2026-10-09').length, 0); });
test('生效日期按上海时区计算', () => { assert.equal(shanghaiDay(new Date('2026-10-08T16:01:00Z')), '2026-10-09'); });
