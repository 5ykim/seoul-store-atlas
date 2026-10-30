const $ = (id) => document.getElementById(id);
const fmt = (n, digits = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#136552', '#db806b', '#789dad', '#d7ddd5'];
const NAMES = ['밀도 높음 · 다양성 높음', '밀도 높음 · 다양성 낮음', '밀도 낮음 · 다양성 높음', '밀도 낮음 · 다양성 낮음'];
const SCALE = ['#e5eed9', '#bdcfaa', '#87ad8a', '#4b8a70', '#136552'];
const state = { quarter: 'annual', district: 'all', selected: 0, mode: 'type', type: 1 };
const QUARTERS = ['20251', '20252', '20253', '20254'];
const CHANGE_COLORS = ['#b85436', '#e8b89a', '#e3e5dd', '#8dc5b3', '#136552'];
let playback = null;
let data;
let geo;
let pathNodes = [];
let mapPaths = [];

const quarter = () => state.quarter === 'annual' ? data.annual : data.quarters[state.quarter];
const row = (i) => ({ ...data.dongs[i], ...quarter().rows[i] });
const visible = (i) => state.district === 'all' || data.dongs[i].district === state.district;
const periodLabel = () => state.quarter === 'annual' ? '2025년 연간 대표값 (분기 평균)' : `2025년 ${state.quarter.at(-1)}분기`;
const countFormat = (n) => fmt(n, state.quarter === 'annual' ? 2 : 0);

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
  renderChanges();
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
  // 시점마다 경계를 바꾸면 같은 색의 뜻이 달라집니다. 네 분기 전체로 고정합니다.
  const values = QUARTERS.flatMap((key) => data.quarters[key].rows.map((d) => d[metric])).sort((a, b) => a - b);
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
    : `<span>${state.mode === 'density' ? '점포 밀도(개/㎢)' : '업종 다양성'}</span>` + SCALE.map((color, k) => `<span class="legend-item"><i class="swatch" style="background:${color}"></i>${k === 0 ? `${fmt(thresholds[0], 4)} 이하` : k === 4 ? `${fmt(thresholds[3], 4)} 초과` : `${fmt(thresholds[k-1], 4)} 초과~${fmt(thresholds[k], 4)} 이하`}</span>`).join('') + '<span>네 분기 전체 기준 고정 5분위 구간 · 진할수록 높은 값</span>';
}

function renderDetail() {
  const d = row(state.selected), topName = data.industries[d.top][1];
  $('selected-name').textContent = `${d.district} ${d.name}`;
  $('selected-type').textContent = NAMES[d.type];
  $('selected-type').style.background = `${COLORS[d.type]}25`;
  $('selected-density').textContent = fmt(d.density, 1);
  $('selected-entropy').textContent = fmt(d.entropy, 3);
  $('selected-total').textContent = `${countFormat(d.total)}개${state.quarter === 'annual' ? ' (분기 평균)' : ''}`;
  $('selected-area').textContent = `${fmt(d.area, 3)}㎢`;
  $('selected-active').textContent = `${d.active} / 100개`;
  $('selected-top').textContent = topName;
  $('selected-share').textContent = `${fmt(d.topShare * 100, 1)}%`;
  $('selected-lq').textContent = fmt(d.topLq, 2);
  const denseText = d.density >= quarter().medianDensity ? '높고' : '낮고';
  const diverseText = d.entropy >= quarter().medianEntropy ? '높습니다' : '낮습니다';
  $('selected-reading').textContent = `서울 중앙값보다 밀도는 ${denseText}, 다양성은 ${diverseText}. 가장 큰 업종은 ${topName}(${fmt(d.topShare * 100, 1)}%)입니다.`;
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
  $('industry-bars').innerHTML = items.map((item) => `<div class="industry-row"><div class="industry-label"><span>${esc(item.name)}</span><b>${countFormat(item.count)}개 · ${fmt(item.count / d.total * 100, 1)}%</b></div><div class="industry-track"><div class="industry-fill" style="width:${item.count / max * 100}%"></div></div></div>`).join('');
  $('industry-reading').textContent = `상위 8개 업종 비중 ${fmt((d.total - other) / d.total * 100, 1)}% · 다양성은 전체 100개 업종으로 계산합니다.${state.quarter === 'annual' ? ' 점포 수는 분기 평균입니다.' : ''}`;
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
    return `<tr class="${i === state.selected ? 'is-selected' : ''}"><td><button data-i="${i}">${esc(d.name)}<small>${esc(d.district)}</small></button></td><td>${countFormat(d.total)}</td><td>${fmt(d.density, 1)}</td><td>${fmt(d.entropy, 3)}</td><td>${esc(data.industries[d.top][1])}</td><td>${fmt(d.topShare * 100, 1)}%</td></tr>`;
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
  $('example-copy').textContent = `${periodLabel()} · 점포 밀도 1위. ${data.industries[example.top][1]} 업종 비중이 ${fmt(example.topShare * 100, 1)}%입니다.`;
  $('example-select').onclick = () => { state.district = 'all'; $('district').value = 'all'; fillDongSelect(); choose(example.i); $('explorer').scrollIntoView({ behavior: 'smooth' }); };
  $('reference-note').textContent = `${periodLabel()} · 서울 전체 ${countFormat(q.total)}개 점포 · 높음/낮음 기준: 밀도 ${fmt(q.medianDensity, 1)}개/㎢, 다양성 ${fmt(q.medianEntropy, 3)} (서울 중앙값)`;
  $('correlation-note').textContent = `서울 전체 · 값의 선형 관계(피어슨) ${fmt(q.pearson, 3)} · 순위 관계(스피어만) ${fmt(q.spearman, 3)}. 값과 순위의 관계가 다르게 나타납니다. 일부 극단값의 영향도 함께 살펴보세요. 상관관계는 원인을 뜻하지 않습니다.`;
  const diverse = [...all].sort((a, b) => b.entropy - a.entropy)[0];
  $('findings-text').innerHTML = `<article><h3>밀도 1위와 다양성 1위는 다른 동네</h3><p>${periodLabel()} 기준, 점포 밀도 1위는 ${esc(example.district)} ${esc(example.name)}(${fmt(example.density,1)}개/㎢), 다양성 1위는 ${esc(diverse.district)} ${esc(diverse.name)}(${fmt(diverse.entropy,3)})입니다.</p></article><article><h3>점포는 빽빽하지만 업종은 집중된 ${q.typeCounts[1]}개 동</h3><p>서울 중앙값보다 밀도는 높고 다양성은 낮은 동네입니다. ${esc(example.name)}은 ${esc(data.industries[example.top][1])} 비중이 ${fmt(example.topShare*100,1)}%로, 이 업종의 LQ는 ${fmt(example.topLq,2)}입니다.</p></article><article><h3>낮은 다양성은 전문상권의 특징일 수도</h3><p>한 업종이 모인 상권도 고유한 강점이 있을 수 있어요. 지표는 상권의 구성을 보여주며, 매출이나 창업 성공을 판단하는 기준은 아닙니다.</p></article>`;
}

const delta = (i) => data.quarters['20254'].rows[i].entropy - data.quarters['20251'].rows[i].entropy;
const signed = (n, digits = 4) => `${n > 0 ? '+' : ''}${fmt(n, digits)}`;

function renderAnnual() {
  const a = data.annual;
  const cards = [
    ['분기 평균 점포 수', `${fmt(a.total, 2)}개`, '서울 전체 · 네 분기 평균'],
    ['점포 밀도 중앙값', `${fmt(a.medianDensity, 1)}`, '개/㎢ · 행정동 425개 기준'],
    ['업종 다양성 중앙값', fmt(a.medianEntropy, 3), '0~1 · 높을수록 고른 업종 구성'],
    ['높은 밀도 · 낮은 다양성', `${a.typeCounts[1]}개 동`, '연간 대표값의 서울 중앙값 기준']
  ];
  $('annual-cards').innerHTML = cards.map(([label, value, note]) => `<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
}

function renderChanges() {
  // 극단적인 한 동 때문에 작은 변화가 묻히지 않도록 ±0.005에서 색을 나눕니다.
  // 표시용 구간이며 통계적 유의성 기준이 아닙니다.
  const limit = 0.01;
  const changeColor = (v) => CHANGE_COLORS[v < -limit / 2 ? 0 : v < -0.00000001 ? 1 : v > limit / 2 ? 4 : v > 0.00000001 ? 3 : 2];
  const changeMap = $('change-map');
  if (!changeMap.children.length) {
    changeMap.innerHTML = mapPaths.map(({ i, path }) => `<path class="dong-path" d="${path}" fill-rule="evenodd" data-i="${i}" tabindex="0" role="button"><title></title></path>`).join('');
    changeMap.querySelectorAll('path').forEach((path) => {
      const select = () => { if (visible(Number(path.dataset.i))) choose(path.dataset.i); };
      path.addEventListener('click', select);
      path.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    });
  }
  changeMap.querySelectorAll('path').forEach((path) => {
    const i = Number(path.dataset.i), dong = data.dongs[i];
    const label = `${dong.district} ${dong.name}, 다양성 변화 ${signed(delta(i))}`;
    path.setAttribute('fill', changeColor(delta(i)));
    path.classList.toggle('faded', !visible(i));
    path.classList.toggle('selected', i === state.selected);
    path.setAttribute('tabindex', visible(i) ? '0' : '-1');
    path.setAttribute('aria-label', label);
    path.setAttribute('aria-pressed', String(i === state.selected));
    path.querySelector('title').textContent = label;
  });
  const selected = changeMap.querySelector(`[data-i="${state.selected}"]`);
  if (selected) changeMap.appendChild(selected);
  const half = fmt(limit / 2, 4);
  $('change-legend').innerHTML = [`−${half} 미만`, `−${half} 이상~0 미만`, '변화 없음', `0 초과~+${half} 이하`, `+${half} 초과`].map((label, i) => `<span class="legend-item"><i class="swatch" style="background:${CHANGE_COLORS[i]}"></i>${label}</span>`).join('');
  const i = state.selected, dong = data.dongs[i];
  $('trend-title').textContent = `${dong.district} ${dong.name} · 분기별 변화`;
  $('trend-charts').innerHTML = [['total', '점포 수', '개', 0], ['density', '점포 밀도', '개/㎢', 1], ['entropy', '업종 다양성', '', 4]].map(([metric, title, unit, digits]) => {
    const values = QUARTERS.map((q) => data.quarters[q].rows[i][metric]);
    const min = Math.min(...values), max = Math.max(...values), pad = (max - min || Math.abs(max) * 0.01 || 1) * 0.3;
    const low = Math.max(0, min - pad), high = max + pad;
    const y = (v) => 76 - (v - low) / (high - low) * 44;
    const x = (k) => 52 + k * 88;
    return `<article class="trend-card"><div><b>${title}</b><span>${signed(values[3]-values[0], digits)}${unit} <small>1→4분기</small></span></div><svg viewBox="0 0 370 106" role="img" aria-label="${esc(title)} ${values.map((v,k) => `${k+1}분기 ${fmt(v,digits)}${unit}`).join(', ')}"><line class="chart-grid" x1="30" x2="340" y1="82" y2="82"/><polyline points="${values.map((v,k) => `${x(k)},${y(v)}`).join(' ')}" fill="none" stroke="#136552" stroke-width="2.5"/>${values.map((v,k) => `<circle cx="${x(k)}" cy="${y(v)}" r="4" fill="#136552"/><text x="${x(k)}" y="${y(v)-11}" text-anchor="middle" class="trend-value">${fmt(v,digits)}</text><text x="${x(k)}" y="100" text-anchor="middle" class="chart-axis">${k+1}분기</text>`).join('')}</svg></article>`;
  }).join('');
  const first = data.quarters['20251'].rows[i], last = data.quarters['20254'].rows[i];
  $('trend-reading').textContent = `다양성 ${fmt(first.entropy,4)} → ${fmt(last.entropy,4)} (${signed(delta(i))}). 점포 수 ${fmt(first.total)}개 → ${fmt(last.total)}개. 최다 업종은 ${data.industries[first.top][1]}(${fmt(first.topShare*100,1)}%) → ${data.industries[last.top][1]}(${fmt(last.topShare*100,1)}%)입니다.`;
  const ids = allVisible().sort((a,b) => delta(b)-delta(a));
  for (const [id, list] of [['rising-list', ids.filter((i) => delta(i) > 0).slice(0,5)], ['falling-list', [...ids].reverse().filter((i) => delta(i) < 0).slice(0,5)]]) {
    $(id).innerHTML = list.length ? list.map((i, rank) => `<button class="change-rank" data-i="${i}"><span>${rank+1}. ${esc(data.dongs[i].district)} ${esc(data.dongs[i].name)}</span><b class="${delta(i)>0 ? 'rise' : 'fall'}">${signed(delta(i))}</b></button>`).join('') : '<p class="chart-sub">해당 방향의 변화가 있는 동네가 없습니다.</p>';
    $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => choose(b.dataset.i)));
  }
}

function stopPlayback() {
  clearInterval(playback); playback = null;
  $('play').textContent = '▶ 분기 변화 재생';
  $('play').setAttribute('aria-pressed', 'false');
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
}

function renderAll() {
  $('quarter').value = state.quarter;
  $('timeline-label').textContent = periodLabel();
  $('quarter-slider').value = state.quarter === 'annual' ? '3' : String(QUARTERS.indexOf(state.quarter));
  $('quarter-slider').setAttribute('aria-valuetext', state.quarter === 'annual' ? '연간 대표값 표시 중. 조절하면 분기별 지도로 전환합니다.' : periodLabel());
  renderMap(); renderDetail(); renderScatter(); renderIndustry(); renderRanking(); renderStory(); renderChanges();
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
  $('quarter').innerHTML = '<option value="annual">2025년 연간 대표값</option>' + Object.keys(data.quarters).sort().map((q) => `<option value="${q}">${q.slice(0, 4)}년 ${q.at(-1)}분기</option>`).join('');
  $('quarter').value = state.quarter;
  $('district').innerHTML = '<option value="all">서울 전체</option>' + [...new Set(data.dongs.map((d) => d.district))].sort((a, b) => a.localeCompare(b, 'ko')).map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  fillDongSelect(); prepareMap(); renderAnnual(); renderAll();
  for (const id of ['quarter', 'district', 'dong', 'play', 'quarter-slider']) $(id).disabled = false;
  $('quarter').addEventListener('change', (e) => { stopPlayback(); state.quarter = e.target.value; renderAll(); });
  $('quarter-slider').addEventListener('input', (e) => { stopPlayback(); setMode('entropy'); state.quarter = QUARTERS[Number(e.target.value)]; renderAll(); });
  $('play').addEventListener('click', () => {
    if (playback) { stopPlayback(); return; }
    setMode('entropy'); state.quarter = QUARTERS[0]; renderAll();
    $('play').textContent = 'Ⅱ 일시 정지'; $('play').setAttribute('aria-pressed', 'true');
    playback = setInterval(() => {
      const next = QUARTERS.indexOf(state.quarter) + 1;
      if (next >= QUARTERS.length) { stopPlayback(); return; }
      state.quarter = QUARTERS[next]; renderAll();
    }, 1600);
  });
  $('district').addEventListener('change', (e) => { state.district = e.target.value; fillDongSelect(); renderAll(); });
  $('dong').addEventListener('change', (e) => choose(e.target.value));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    stopPlayback(); setMode(b.dataset.mode);
    renderMap();
  }));
  $('reset').addEventListener('click', () => { state.district = 'all'; $('district').value = 'all'; fillDongSelect(); renderAll(); });
  window.__atlasReady = true;
}

main().catch((error) => { $('error').textContent = error.message; $('error').hidden = false; });
