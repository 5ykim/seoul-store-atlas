import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const data = JSON.parse(await readFile(new URL('../dist/data/analysis.json', import.meta.url), 'utf8'));
const geo = JSON.parse(await readFile(new URL('../dist/data/dongs.geojson', import.meta.url), 'utf8'));

test('원본 행정동 425개와 지도 425개가 중복·누락 없이 연결된다', () => {
  assert.equal(data.dongs.length, 425);
  assert.equal(data.industries.length, 100);
  assert.equal(geo.features.length, 425);
  assert.equal(new Set(data.dongs.map((d) => d.code)).size, 425);
  assert.deepEqual(new Set(data.dongs.map((d) => d.code)), new Set(geo.features.map((f) => f.properties.code)));
  assert.equal(data.audit.rawRows, 141218);
});

for (const [key, q] of Object.entries(data.quarters)) {
  test(`${key}: 업종별 수를 다시 합산하고 밀도·Entropy·LQ를 독립 계산한다`, () => {
    assert.equal(q.rows.length, 425);
    assert.equal(q.counts.length, 425);
    assert.equal(q.typeCounts.reduce((a, b) => a + b, 0), 425);
    let total = 0;
    const columns = Array(100).fill(0);
    q.rows.forEach((row, i) => {
      const counts = q.counts[i];
      assert.equal(counts.length, 100);
      assert.ok(counts.every((n) => Number.isInteger(n) && n >= 0));
      const n = counts.reduce((a, b) => a + b, 0);
      counts.forEach((v, k) => { columns[k] += v; });
      total += n;
      assert.equal(row.total, n);
      assert.ok(data.dongs[i].area > 0);
      assert.ok(Math.abs(row.density - n / data.dongs[i].area) < 0.05);
      const entropy = counts.reduce((sum, v) => v ? sum - (v / n) * Math.log(v / n) : sum, 0) / Math.log(100);
      assert.ok(Math.abs(row.entropy - entropy) < 1e-7);
      assert.ok(row.entropy >= 0 && row.entropy <= 1);
      assert.equal(counts[row.top], Math.max(...counts));
      assert.ok(Math.abs(row.topShare - counts[row.top] / n) < 1e-7);
      const lq = (counts[row.top] / n) / (q.industryTotals[row.top] / q.total);
      assert.ok(Math.abs(row.topLq - lq) < 1e-6);
    });
    assert.equal(total, q.total);
    assert.deepEqual(columns, q.industryTotals);
  });
}

test('4분기 전체 점포 수와 전문상권 사례가 원본 집계와 일치한다', () => {
  const q = data.quarters['20254'];
  assert.equal(q.total, 632830);
  const index = data.dongs.findIndex((d) => d.district === '중구' && d.name === '신당동');
  assert.equal(q.rows[index].total, 10107);
  assert.equal(data.industries[q.rows[index].top][1], '일반의류');
  assert.equal(q.rows[index].type, 1);
  assert.ok(q.rows[index].topShare > 0.86);
});

test('연간값은 업종별 분기 평균에서 재계산하며 분기별 다양성을 평균하지 않는다', () => {
  const a = data.annual;
  const quarters = Object.values(data.quarters);
  let sawNonlinearDifference = false;
  a.counts.forEach((counts, i) => {
    const expected = Array.from({length:100}, (_, k) => quarters.reduce((sum,q) => sum+q.counts[i][k], 0)/4);
    assert.deepEqual(counts, expected);
    const total = expected.reduce((sum,n) => sum+n,0);
    assert.equal(a.rows[i].total, total);
    const entropy = -expected.reduce((s,n) => n ? s+n/total*Math.log(n/total) : s,0)/Math.log(100);
    assert.ok(Math.abs(a.rows[i].entropy-entropy)<1e-7);
    assert.ok(Math.abs(a.rows[i].density-total/data.dongs[i].area)<0.05);
    const top = a.rows[i].top;
    const cityIndustry = a.counts.reduce((s,row)=>s+row[top],0);
    const lq = (counts[top]/total)/(cityIndustry/a.total);
    assert.ok(Math.abs(a.rows[i].topLq-lq)<1e-6);
    const averagedIndex = quarters.reduce((s,q)=>s+q.rows[i].entropy,0)/4;
    if (Math.abs(entropy-averagedIndex)>0.0001) sawNonlinearDifference = true;
  });
  assert.ok(sawNonlinearDifference);
  assert.equal(a.total, quarters.reduce((s,q)=>s+q.total,0)/4);
  assert.equal(a.total,636753.75);
  assert.equal(a.rows.reduce((s,r)=>s+r.total,0),a.total);
  assert.equal(a.typeCounts.reduce((s,n)=>s+n,0),425);
});
