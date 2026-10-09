// Adapter boundary: replace this class with the enterprise OA implementation.
export class MockOAAdapter {
  async submit(claim) {
    return { id: `OA-DEMO-${claim.id}`, status: '部门审批中', stage: 0, submittedAt: new Date().toISOString() };
  }
  async query(record) { return { ...record }; }
  async advance(record) {
    const statuses = ['部门审批中', '财务审核中', '审批通过'];
    const stage = Math.min(record.stage + 1, statuses.length - 1);
    return { ...record, stage, status: statuses[stage] };
  }
}
