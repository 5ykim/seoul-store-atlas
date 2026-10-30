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
