import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents, inspect } from '../agent.mjs';
import { MockOAAdapter } from '../oa.mjs';
const item = { merchant: '商户', date: '2026-10-08', category: '交通', amount: '0.10', invoiceNumber: '123', attachmentId: 'a' };
test('金额精确到分且拒绝非法输入', () => { assert.equal(cents('0.10') + cents('0.20'), 30); for (const value of ['NaN', '-1', '1.234', '1e3', '']) assert.throws(() => cents(value)); });
test('重复发票、缺少材料和不存在的日期不能通过', () => { assert.equal(inspect([item]).ready, true); assert.equal(inspect([item, item]).ready, false); assert.equal(inspect([{ ...item, attachmentId: '' }]).ready, false); assert.equal(inspect([{ ...item, date: '2026-02-30' }]).ready, false); });
test('OA 查询不自动审批，仅显式推进改变状态', async () => { const oa = new MockOAAdapter(); const record = await oa.submit({ id: '1' }); assert.equal((await oa.query(record)).status, '部门审批中'); const advanced = await oa.advance(record); assert.equal(advanced.status, '财务审核中'); assert.equal((await oa.advance(advanced)).status, '审批通过'); });
