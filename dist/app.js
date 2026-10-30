const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#136552', '#db806b', '#789dad', '#d7ddd5'];
const NAMES = ['고밀도·고다양성', '고밀도·저다양성', '저밀도·고다양성', '저밀도·저다양성'];
const SCALE = ['#e5eed9', '#bdcfaa', '#87ad8a', '#4b8a70', '#136552'];
const state = { quarter: '20254', district: 'all', selected: 0, mode: 'type', type: 1 };
let data;
let geo;
let pathNodes = [];
let mapPaths = [];

const quarter = () => data.quarters[state.quarter];
const row = (i) => ({ ...data.dongs[i], ...quarter().rows[i] });
const visible = (i) => state.district === 'all' || data.dongs[i].district === state.district;
const periodLabel = () => `${state.quarter.slice(0, 4)}년 ${state.quarter.at(-1)}분기`;

function allVisible() {
  return data.dongs.map((_, i) => i).filter(visible);
}

function choose(i) {
  state.selected = Number(i);
  $('dong').value = String(i);
  renderMap();
  renderDetail();
  renderScatter();
  renderIndustry();
  renderRanking();
}

function fillDongSelect() {
  const ids = allVisible().sort((a, b) => `${data.dongs[a].district} ${data.dongs[a].name}`.localeCompare(`${data.dongs[b].district} ${data.dongs[b].name}`, 'ko'));
  $('dong').innerHTML = ids.map((i) => `<option value="${i}">${esc(data.dongs[i].district)} ${esc(data.dongs[i].name)}</option>`).join('');
  if (!visible(state.selected)) state.selected = ids[0];
  $('dong').value = String(state.selected);
}

// 위경도를 메르카토르 평면에 옮긴 다음 SVG 크기에 맞춥니다.
function project([lon, lat]) {
  return [lon * Math.PI / 180, -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}

function prepareMap() {
  const rings = geo.features.flatMap((f) => f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat());
  const points = rings.flat().map(project);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(780 / (maxX - minX), 580 / (maxY - minY));
  const ox = (850 - (maxX - minX) * scale) / 2;
  const oy = (650 - (maxY - minY) * scale) / 2;
  const toPath = (ring) => ring.map((coordinate, j) => {
    const p = project(coordinate);
    return `${j ? 'L' : 'M'}${((p[0] - minX) * scale + ox).toFixed(2)},${((p[1] - minY) * scale + oy).toFixed(2)}`;
  }).join('') + 'Z';
  const index = new Map(data.dongs.map((d, i) => [d.code, i]));
  mapPaths = geo.features.map((f) => ({
    i: index.get(f.properties.code),
    path: (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat()).map(toPath).join('')
  }));
  $('map').innerHTML = mapPaths.map(({ i, path }) => `<path class="dong-path" d="${path}" fill-rule="evenodd" data-i="${i}" tabindex="0" role="button"><title>${esc(data.dongs[i].district)} ${esc(data.dongs[i].name)}</title></path>`).join('');
  pathNodes = [...$('map').querySelectorAll('path')];
  pathNodes.forEach((path) => {
    const i = Number(path.dataset.i);
    path.addEventListener('click', () => { if (visible(i)) choose(i); });
    path.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && visible(i)) { event.preventDefault(); choose(i); }
    });
    path.addEventListener('pointermove', (event) => {
      const d = row(i);
      $('tooltip').innerHTML = `${esc(d.district)} ${esc(d.name)}<br>밀도 ${fmt(d.density, 1)}개/㎢ · 다양성 ${fmt(d.entropy, 3)}`;
      const box = $('map').getBoundingClientRect();
      $('tooltip').style.left = `${Math.max(8, Math.min(event.clientX - box.left + 12, box.width - 220))}px`;
      $('tooltip').style.top = `${Math.max(8, event.clientY - box.top - 65)}px`;
      $('tooltip').hidden = false;
    });
    path.addEventListener('pointerleave', () => { $('tooltip').hidden = true; });
  });
}

function breaks(metric) {
  const values = quarter().rows.map((d) => d[metric]).sort((a, b) => a - b);
  return [0.2, 0.4, 0.6, 0.8].map((p) => values[Math.floor((values.length - 1) * p)]);
}

function renderMap() {
  const thresholds = state.mode === 'type' ? [] : breaks(state.mode);
  pathNodes.forEach((path) => {
    const i = Number(path.dataset.i), d = row(i);
    const colorIndex = thresholds.filter((b) => d[state.mode] > b).length;
    path.setAttribute('fill', state.mode === 'type' ? COLORS[d.type] : SCALE[colorIndex]);
    path.classList.toggle('selected', i === state.selected);
    path.classList.toggle('faded', !visible(i));
    path.setAttribute('aria-label', `${d.district} ${d.name}, ${NAMES[d.type]}, 밀도 ${fmt(d.density, 1)}, 다양성 ${fmt(d.entropy, 3)}`);
    path.setAttribute('tabindex', visible(i) ? '0' : '-1');
    path.setAttribute('aria-pressed', String(i === state.selected));
  });
  const selected = pathNodes.find((p) => Number(p.dataset.i) === state.selected);
  if (selected) $('map').appendChild(selected);
  $('legend').innerHTML = state.mode === 'type'
    ? NAMES.map((name, k) => `<span class="legend-item"><i class="swatch" style="background:${COLORS[k]}"></i>${name}</span>`).join('')
    : `<span>${state.mode === 'density' ? '점포 밀도(개/㎢)' : '업종 다양성'}</span>` + SCALE.map((color, k) => `<span class="legend-item"><i class="swatch" style="background:${color}"></i>${k ? `${fmt(thresholds[k - 1], state.mode === 'density' ? 0 : 3)} 초과` : `${fmt(thresholds[0], state.mode === 'density' ? 0 : 3)} 이하`}</span>`).join('') + '<span>서울 전체 5분위 구간</span>';
}

function renderDetail() {
  const d = row(state.selected), topName = data.industries[d.top][1];
  $('selected-name').textContent = `${d.district} ${d.name}`;
  $('selected-type').textContent = NAMES[d.type];
  $('selected-type').style.background = `${COLORS[d.type]}25`;
  $('selected-density').textContent = fmt(d.density, 1);
  $('selected-entropy').textContent = fmt(d.entropy, 3);
  $('selected-total').textContent = `${fmt(d.total)}개`;
  $('selected-area').textContent = `${fmt(d.area, 3)}㎢`;
  $('selected-active').textContent = `${d.active} / 100개`;
  $('selected-top').textContent = topName;
  $('selected-share').textContent = `${fmt(d.topShare * 100, 1)}%`;
  $('selected-lq').textContent = fmt(d.topLq, 2);
  const denseText = d.density >= quarter().medianDensity ? '높고' : '낮고';
  const diverseText = d.entropy >= quarter().medianEntropy ? '높습니다' : '낮습니다';
  $('selected-reading').textContent = `서울 전체 중앙값보다 밀도는 ${denseText}, 다양성은 ${diverseText}. 가장 많은 업종은 ${topName}이며 전체의 ${fmt(d.topShare * 100, 1)}%입니다. 업종 구성까지 함께 봐야 이 동네의 특징을 읽을 수 있습니다.`;
}

function renderScatter() {
  const ids = allVisible();
  const left = 62, right = 738, top = 23, bottom = 405;
  const maxDensity = Math.max(...quarter().rows.map((r) => r.density));
  const minDensity = Math.min(...quarter().rows.map((r) => r.density));
  const lo = Math.floor(Math.log10(minDensity)), hi = Math.log10(maxDensity) + 0.08;
  const x = (value) => left + (Math.log10(value) - lo) / (hi - lo) * (right - left);
  const y = (value) => bottom - value * (bottom - top);
  let html = '';
  for (const v of [0, 0.2, 0.4, 0.6, 0.8, 1]) html += `<line class="chart-grid" x1="${left}" y1="${y(v)}" x2="${right}" y2="${y(v)}"/><text class="chart-axis" x="${left - 12}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  for (const v of [10, 30, 100, 300, 1000, 3000, 10000, 30000]) if (Math.log10(v) >= lo && v <= maxDensity * 1.2) html += `<text class="chart-axis" x="${x(v)}" y="${bottom + 23}" text-anchor="middle">${fmt(v)}</text>`;
  html += `<line class="median-line" x1="${x(quarter().medianDensity)}" x2="${x(quarter().medianDensity)}" y1="${top}" y2="${bottom}"/><line class="median-line" x1="${left}" x2="${right}" y1="${y(quarter().medianEntropy)}" y2="${y(quarter().medianEntropy)}"/>`;
  html += `<text class="chart-axis" x="${left}" y="13">업종 다양성</text><text class="chart-axis" x="400" y="460" text-anchor="middle">점포 밀도(개/㎢) · 로그 눈금</text>`;
  // 선택한 점은 마지막에 그려 다른 점 위에 표시합니다.
  ids.sort((a, b) => (a === state.selected) - (b === state.selected));
  html += ids.map((i) => {
    const d = row(i);
    return `<circle class="scatter-point${i === state.selected ? ' selected' : ''}" cx="${x(d.density)}" cy="${y(d.entropy)}" r="${i === state.selected ? 7 : 4.5}" fill="${COLORS[d.type]}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(d.district)} ${esc(d.name)}"><title>${esc(d.district)} ${esc(d.name)}: ${fmt(d.density, 1)}개/㎢, 다양성 ${fmt(d.entropy, 3)}</title></circle>`;
  }).join('');
  $('scatter').innerHTML = html;
  $('scatter').querySelectorAll('circle').forEach((point) => {
    point.addEventListener('click', () => choose(point.dataset.i));
    point.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(point.dataset.i); } });
  });
}

function renderIndustry() {
  const d = row(state.selected), counts = quarter().counts[state.selected];
  const sorted = counts.map((n, i) => ({ count: n, name: data.industries[i][1] })).sort((a, b) => b.count - a.count);
  const items = sorted.slice(0, 8);
  const other = sorted.slice(8).reduce((s, r) => s + r.count, 0);
  if (other) items.push({ count: other, name: '기타 업종 합계' });
  const max = Math.max(...items.map((i) => i.count));
  $('industry-title').textContent = `${d.name}의 상위 업종`;
  $('industry-bars').innerHTML = items.map((item) => `<div class="industry-row"><div class="industry-label"><span>${esc(item.name)}</span><b>${fmt(item.count)}개 · ${fmt(item.count / d.total * 100, 1)}%</b></div><div class="industry-track"><div class="industry-fill" style="width:${item.count / max * 100}%"></div></div></div>`).join('');
  $('industry-reading').textContent = `상위 8개 업종이 전체의 ${fmt((d.total - other) / d.total * 100, 1)}%를 차지합니다. 다양성 계산에는 상위 8개뿐 아니라 전체 100개 업종을 사용했습니다.`;
}

function renderRanking() {
  const ids = allVisible();
  const counts = NAMES.map((_, k) => ids.filter((i) => row(i).type === k).length);
  $('type-tabs').innerHTML = NAMES.map((name, k) => `<button class="type-tab${state.type === k ? ' active' : ''}" data-type="${k}" aria-pressed="${state.type === k}"><i class="swatch" style="background:${COLORS[k]}"></i>${name}<b>${counts[k]}개 동</b></button>`).join('');
  $('type-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.type = Number(b.dataset.type); renderRanking(); }));
  const matching = ids.filter((i) => row(i).type === state.type).sort((a, b) => row(b).density - row(a).density);
  $('ranking-note').textContent = `${periodLabel()} · ${state.district === 'all' ? '서울 전체' : state.district} · ${NAMES[state.type]} ${matching.length}개 동 중 밀도 상위 ${Math.min(10, matching.length)}개`;
  $('ranking').innerHTML = matching.length ? matching.slice(0, 10).map((i) => {
    const d = row(i);
    return `<tr class="${i === state.selected ? 'is-selected' : ''}"><td><button data-i="${i}">${esc(d.name)}<small>${esc(d.district)}</small></button></td><td>${fmt(d.total)}</td><td>${fmt(d.density, 1)}</td><td>${fmt(d.entropy, 3)}</td><td>${esc(data.industries[d.top][1])}</td><td>${fmt(d.topShare * 100, 1)}%</td></tr>`;
  }).join('') : '<tr><td colspan="6">현재 선택한 자치구에는 이 유형의 동이 없습니다. 다른 유형을 선택해 보세요.</td></tr>';
  $('ranking').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { choose(b.dataset.i); $('explorer').scrollIntoView({ behavior: 'smooth' }); }));
}

function renderStory() {
  const q = quarter();
  const all = q.rows.map((r, i) => ({ ...data.dongs[i], ...r, i }));
  const example = [...all].sort((a, b) => b.density - a.density)[0];
  $('example-name').textContent = `${example.district} ${example.name}`;
  $('example-density').textContent = fmt(example.density, 0);
  $('example-entropy').textContent = fmt(example.entropy, 3);
  $('example-copy').textContent = `${periodLabel()}, 밀도가 가장 높은 동입니다. ${data.industries[example.top][1]} 업종이 ${fmt(example.topShare * 100, 1)}%를 차지합니다. 점포 수만 보면 보이지 않는 구성입니다.`;
  $('example-select').onclick = () => { state.district = 'all'; $('district').value = 'all'; fillDongSelect(); choose(example.i); $('explorer').scrollIntoView({ behavior: 'smooth' }); };
  $('reference-note').textContent = `${periodLabel()} · 서울 전체 ${fmt(q.total)}개 점포 · 분류 기준: 밀도 ${fmt(q.medianDensity, 1)}개/㎢, 다양성 ${fmt(q.medianEntropy, 3)} (서울 중앙값)`;
  $('correlation-note').textContent = `서울 전체 기준 · 피어슨 상관계수 ${fmt(q.pearson, 3)} (원래 밀도값), 스피어만 순위 상관계수 ${fmt(q.spearman, 3)}. 두 값이 다른 이유를 산점도의 극단값과 업종 구성에서 살펴보세요. 자치구 필터와 관계없이 서울 전체 결과를 표시합니다.`;
  const diverse = [...all].sort((a, b) => b.entropy - a.entropy)[0];
  $('findings-text').innerHTML = `<article><h3>01. 밀도가 가장 높은 곳과 가장 다양한 곳</h3><p>${esc(example.district)} ${esc(example.name)}의 밀도는 ${fmt(example.density, 1)}개/㎢입니다. 다양성이 가장 높은 곳은 ${esc(diverse.district)} ${esc(diverse.name)}(${fmt(diverse.entropy, 3)})입니다. 밀도는 양의 집중을, 다양성은 업종 구성의 고른 정도를 보여줍니다.</p></article><article><h3>02. 높은 밀도와 낮은 다양성이 만나는 곳</h3><p>${periodLabel()}에는 ${q.typeCounts[1]}개 동이 고밀도·저다양성으로 분류됩니다. 대표적으로 ${esc(example.name)}은 ${esc(data.industries[example.top][1])} 비율이 ${fmt(example.topShare * 100, 1)}%이며, 이 업종의 LQ는 ${fmt(example.topLq, 2)}입니다. 특정 기능이 모인 전문상권의 특성으로 해석할 여지가 있습니다. 정확한 입지 원인은 현장과 토지이용을 추가로 확인해야 합니다.</p></article><article><h3>03. 낮은 다양성이 곧 나쁜 상권은 아닙니다</h3><p>전문화된 상권은 한 업종의 수요를 모으는 장점이 있을 수 있습니다. 반대로 넓은 동의 낮은 밀도는 산지·수면의 영향일 수도 있습니다. 이 분석은 상권의 형태를 설명하며, 창업 성공이나 공급 부족을 판단하지 않습니다.</p></article>`;
}

function renderAll() {
  renderMap(); renderDetail(); renderScatter(); renderIndustry(); renderRanking(); renderStory();
}

async function main() {
  if (location.protocol === 'file:') throw new Error('파일을 직접 열면 분석 자료를 불러올 수 없습니다. 공개 앱 주소 또는 로컬 미리보기 주소로 접속해 주세요.');
  const responses = await Promise.all(['data/analysis.json', 'data/dongs.geojson'].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`분석 자료를 불러오지 못했습니다 (${response.status}). 새로고침해 주세요.`);
    return response.json();
  }));
  [data, geo] = responses;
  state.selected = data.dongs.findIndex((d) => d.district === '중구' && d.name === '신당동');
  if (state.selected < 0) state.selected = 0;
  $('quarter').innerHTML = Object.keys(data.quarters).sort().reverse().map((q) => `<option value="${q}">${q.slice(0, 4)}년 ${q.at(-1)}분기</option>`).join('');
  $('quarter').value = state.quarter;
  $('district').innerHTML = '<option value="all">서울 전체</option>' + [...new Set(data.dongs.map((d) => d.district))].sort((a, b) => a.localeCompare(b, 'ko')).map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  fillDongSelect(); prepareMap(); renderAll();
  for (const id of ['quarter', 'district', 'dong']) $(id).disabled = false;
  $('quarter').addEventListener('change', (e) => { state.quarter = e.target.value; renderAll(); });
  $('district').addEventListener('change', (e) => { state.district = e.target.value; fillDongSelect(); renderAll(); });
  $('dong').addEventListener('change', (e) => choose(e.target.value));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((button) => { button.classList.toggle('active', button === b); button.setAttribute('aria-pressed', String(button === b)); });
    renderMap();
  }));
  $('reset').addEventListener('click', () => { state.district = 'all'; $('district').value = 'all'; fillDongSelect(); renderAll(); });
  window.__atlasReady = true;
}

main().catch((error) => { $('error').textContent = error.message; $('error').hidden = false; });
