"""과제 3: 원본 ZIP에서 행정동별 점포 밀도·다양성을 계산합니다.

실행: python scripts/build_analysis.py
원자료는 source_data/에 보존하고, 웹용 결과만 dist/data/에 저장합니다.
"""
from pathlib import Path
from hashlib import sha256
import json
import math
import zipfile
import io

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
COUNT = "유사_업종_점포_수"
KEYS = ["기준_년분기_코드", "행정동_코드", "서비스_업종_코드"]
SOURCE_URL = "https://data.seoul.go.kr/dataList/OA-22172/S/1/datasetView.do"
BOUNDARY_URL = "https://data.seoul.go.kr/dataList/OA-22160/S/1/datasetView.do"
TYPE_NAMES = ["고밀도·고다양성", "고밀도·저다양성", "저밀도·고다양성", "저밀도·저다양성"]


def diversity(counts):
    """업종 수 K를 모든 동에 동일하게 고정한 정규화 Entropy."""
    total = sum(counts)
    if total == 0:
        return None
    # 점포가 없는 업종의 p log(p)는 0으로 처리합니다.
    entropy = -sum((n / total) * math.log(n / total) for n in counts if n > 0)
    return entropy / math.log(len(counts))


def read_sources():
    stores_path = ROOT / "source_data/stores-2025.zip"
    with zipfile.ZipFile(stores_path) as archive:
        csv_name = next(name for name in archive.namelist() if name.endswith(".csv"))
        stores = pd.read_csv(io.BytesIO(archive.read(csv_name)), encoding="cp949")
    for column in ["행정동_코드", "서비스_업종_코드"]:
        stores[column] = stores[column].astype(str)
    if stores.duplicated(KEYS).any():
        raise ValueError("분기·행정동·업종 조합이 중복되었습니다.")
    if stores[COUNT].isna().any() or (stores[COUNT] < 0).any():
        raise ValueError("점포 수에 결측 또는 음수가 있습니다.")
    identity = stores[COUNT] == stores["점포_수"] + stores["프랜차이즈_점포_수"]
    if not identity.all():
        raise ValueError("전체=일반+프랜차이즈 관계를 확인할 수 없습니다.")
    boundary = gpd.read_file(io.BytesIO((ROOT / "source_data/seoul-commercial-dongs.zip").read_bytes()))
    boundary["ADSTRD_CD"] = boundary["ADSTRD_CD"].astype(str)
    if boundary.crs.to_epsg() != 5181:
        boundary = boundary.to_crs(5181)
    if not boundary.geometry.is_valid.all():
        raise ValueError("경계 도형에 오류가 있습니다.")
    if set(stores["행정동_코드"]) != set(boundary["ADSTRD_CD"]):
        raise ValueError("상권과 지도 행정동 코드가 일치하지 않습니다.")
    # 지도 단순화 전, 미터 단위 투영좌표계로 면적을 계산합니다.
    boundary["area_km2"] = boundary.geometry.area / 1_000_000
    return stores, boundary


def analyze(stores, boundary):
    industries = stores[["서비스_업종_코드", "서비스_업종_코드_명"]].drop_duplicates()
    industries = industries.sort_values("서비스_업종_코드")
    industry_codes = industries["서비스_업종_코드"].tolist()
    codes = sorted(boundary["ADSTRD_CD"].tolist())
    regions = boundary.set_index("ADSTRD_CD")
    names = stores.drop_duplicates("행정동_코드").set_index("행정동_코드")["행정동_코드_명"]
    # 자치구 코드는 행정동 8자리 코드의 앞 5자리입니다.
    district_names = {
        "11110":"종로구", "11140":"중구", "11170":"용산구", "11200":"성동구",
        "11215":"광진구", "11230":"동대문구", "11260":"중랑구", "11290":"성북구",
        "11305":"강북구", "11320":"도봉구", "11350":"노원구", "11380":"은평구",
        "11410":"서대문구", "11440":"마포구", "11470":"양천구", "11500":"강서구",
        "11530":"구로구", "11545":"금천구", "11560":"영등포구", "11590":"동작구",
        "11620":"관악구", "11650":"서초구", "11680":"강남구", "11710":"송파구", "11740":"강동구"
    }
    dongs = [{"code": code, "name": names[code], "district": district_names[code[:5]],
              "area": round(float(regions.loc[code, "area_km2"]), 6)} for code in codes]
    output = {"industries": industries.values.tolist(), "dongs": dongs, "quarters": {}}
    results = []
    matrices = []
    for quarter, group in stores.groupby("기준_년분기_코드"):
        matrix = group.pivot(index="행정동_코드", columns="서비스_업종_코드", values=COUNT)
        # 원본에 행이 없는 업종은 0으로 채우고, 행정동 전체 누락은 오류로 처리합니다.
        if set(matrix.index) != set(codes):
            raise ValueError(f"{quarter}에 행정동 전체가 누락되었습니다.")
        matrix = matrix.reindex(index=codes, columns=industry_codes).fillna(0).astype(int)
        matrices.append((str(quarter), matrix.to_numpy()))
    if [key for key, _ in matrices] != ['20251', '20252', '20253', '20254']:
        raise ValueError("연간 대표값에는 2025년 네 분기가 모두 필요합니다.")
    # 같은 점포가 분기마다 관측될 수 있으므로 합계 대신 업종별 평균을 구합니다.
    # 다양성은 분기별 지수의 평균이 아니라, 평균 점포 구성에서 새로 계산합니다.
    annual_counts = np.mean([counts for _, counts in matrices], axis=0)
    for period, counts in [*matrices, ('annual', annual_counts)]:
        annual = period == 'annual'
        totals = counts.sum(axis=1)
        densities = np.array([totals[i] / regions.loc[code, "area_km2"] for i, code in enumerate(codes)])
        entropies = np.array([diversity(row.tolist()) for row in counts], dtype=float)
        median_density = float(np.median(densities))
        median_entropy = float(np.median(entropies))
        city_industry = counts.sum(axis=0)
        city_total = float(city_industry.sum()) if annual else int(city_industry.sum())
        rows = []
        for i, code in enumerate(codes):
            dense = densities[i] >= median_density
            diverse = entropies[i] >= median_entropy
            kind = (0 if dense else 2) + (0 if diverse else 1)
            top = int(np.argmax(counts[i]))
            share = float(counts[i, top] / totals[i]) if totals[i] else None
            lq = share / (city_industry[top] / city_total) if share is not None else None
            row = {"total":float(totals[i]) if annual else int(totals[i]), "density":round(float(densities[i]), 6),
                   "entropy":round(float(entropies[i]), 8), "type":kind,
                   "active":int((counts[i] > 0).sum()), "top":top,
                   "topShare":round(share, 8), "topLq":round(lq, 6)}
            rows.append(row)
            results.append({"quarter":period, **dongs[i], **row})
        summary = {
            "rows":rows, "counts":counts.tolist(), "total":city_total,
            "medianDensity":median_density, "medianEntropy":median_entropy,
            "industryTotals":city_industry.tolist(),
            "typeCounts":[sum(row["type"] == k for row in rows) for k in range(4)],
            "pearson":float(np.corrcoef(densities, entropies)[0, 1]),
            "spearman":float(pd.Series(densities).rank().corr(pd.Series(entropies).rank()))
        }
        if annual:
            output['annual'] = summary
        else:
            output['quarters'][period] = summary
    output['annual']['label'] = '2025년 연간 대표값 (분기 평균)'
    output['annual']['method'] = '행정동·업종별 1~4분기 점포 수의 산술평균으로 밀도·Entropy·LQ 재계산'
    return output, pd.DataFrame(results)


def build_report(data):
    q = data["quarters"]["20254"]
    combined = [{**dong, **row} for dong, row in zip(data["dongs"], q["rows"])]
    dense = max(combined, key=lambda d:d["density"])
    diverse = max(combined, key=lambda d:d["entropy"])
    target = sorted([d for d in combined if d["type"] == 1], key=lambda d:d["density"], reverse=True)[:5]
    examples = "\n".join(f"- {d['district']} {d['name']}: {d['total']:,}개, {d['density']:,.1f}개/㎢, 다양성 {d['entropy']:.3f}. 최다 업종은 {data['industries'][d['top']][1]}({d['topShare']:.1%}), 해당 업종 LQ {d['topLq']:.2f}." for d in target)
    annual = data['annual']
    changes = sorted(range(len(data['dongs'])), key=lambda i: q['rows'][i]['entropy'] - data['quarters']['20251']['rows'][i]['entropy'])
    def change_example(i):
        dong = data['dongs'][i]
        first = data['quarters']['20251']['rows'][i]['entropy']
        last = q['rows'][i]['entropy']
        return f"{dong['district']} {dong['name']}: {first:.4f} → {last:.4f} ({last-first:+.4f})"
    return f"""# 서울 동네별 점포 밀도와 업종 다양성
가게가 많은 동네, 업종도 다양할까?

## 2025년 연간 대표 분석
행정동·업종별 1~4분기 점포 수의 산술평균을 구한 뒤 밀도·Entropy·LQ를 다시 계산했다. 분기별 점포 수를 더하거나 분기별 다양성 지수를 평균한 값이 아니다. 소수점 점포 수는 분기 평균값이다. 연중 영업한 고유 점포 수를 의미하지 않는다.
서울의 분기 평균 점포 수는 {annual['total']:,.2f}개, 연간 대표 밀도 중앙값은 {annual['medianDensity']:,.1f}개/㎢, 다양성 중앙값은 {annual['medianEntropy']:.4f}이다.
밀도와 다양성의 피어슨 상관계수는 {annual['pearson']:.3f}, 스피어만 순위 상관계수는 {annual['spearman']:.3f}이다.
연간 대표 고밀도·저다양성 동은 {annual['typeCounts'][1]}개다. 연간 대표값과 분기별 결과를 별도로 제공한다.

## 분기별 변화
지도 재생은 네 분기를 합친 서울 전체 값의 고정 5분위 구간으로 색을 정해 비교한다. 네 유형 구분은 각 분석 시점의 중앙값에 따른 상대 분류이므로 변화 확인에는 다양성 수치와 고정 색상을 사용한다.
변화 지도는 4분기 다양성에서 1분기 다양성을 뺀 절대 지수 차이를 표시한다. 이는 퍼센트 변화가 아니다.
가장 크게 상승: {change_example(changes[-1])}
가장 크게 하락: {change_example(changes[0])}
동네별 추이에는 네 분기의 점포 수·밀도·다양성을 함께 표시한다. 업종 구성이 바뀐 이유나 동일 점포의 개·폐업을 직접 확인한 결과는 아니다.

## 연구 질문과 범위
2025년 4분기 서울의 상권자료 기준 425개 행정동에서 점포 밀도가 높은 곳은 업종 구성도 다양한가? 두 지표가 엇갈리는 지역의 산업적 특징은 무엇인가?
기본 비교는 같은 분기·같은 업종 100개·같은 공간 단위로 수행한다. 웹앱에서 1~4분기를 각각 선택할 수 있으며, 분기별 점포 재고를 합산하지 않는다.

## 자료와 전처리
- 서울 열린데이터광장 점포-행정동 2025년 공식 ZIP, {SOURCE_URL}
- 서울 열린데이터광장 영역-행정동 공식 ZIP, {BOUNDARY_URL}
- 원본 {data['audit']['rawRows']:,}행. 분기·행정동·업종 중복 0행, 점포수 결측 0행, 음수 0행.
- `유사_업종_점포_수`를 전체 점포 수로 사용한다. 원본 모든 행에서 `점포_수 + 프랜차이즈_점포_수`와 일치한다. 중복 합산하지 않는다.
- 관측되지 않은 동×업종 조합은 점포 0개로 채우되, 행정동 자체가 누락되면 계산을 중단한다. 100개 업종 분류를 모든 지역·분기에 고정한다.
- 상권 자료의 8자리 행정동 코드를 공식 경계 `ADSTRD_CD`와 연결했다. 425개 모두 대응한다. 현행 행정동과 달리 상일동·일원2동 등 원본 기준을 유지한다.
- 경계의 원래 투영좌표계 EPSG:5181에서 도형 면적을 계산했다. 지도 표시용 도형 단순화는 면적 계산 이후 적용했다. 면적에는 산지·하천 등이 포함된다.

## 지표 정의
1. 점포 밀도 Dᵢ = Nᵢ / Aᵢ. N은 100개 업종의 전체 점포 수(개), A는 행정동 면적(㎢). 값이 높으면 단위 면적당 점포가 조밀하다.
2. 정규화 Entropy Hᵢ = −Σ(pᵢₖ ln pᵢₖ) / ln(100). p는 동 전체 점포에서 업종 k가 차지하는 비율이다. 0인 항은 0으로 처리한다. 0은 단일 업종 집중, 1은 100개 업종이 동일한 비중인 상태다. 점포가 전혀 없으면 미정의로 처리한다.
3. 보조지표 LQᵢₖ = (nᵢₖ/Nᵢ) / (Σᵢnᵢₖ/ΣᵢNᵢ). 선택한 동의 최다 업종이 서울 전체보다 얼마나 특화됐는지 해석한다. 1보다 크면 해당 업종 비율이 서울보다 높다.
네 유형은 해당 분기 서울 전체 425개 동의 밀도 중앙값 {q['medianDensity']:,.1f}개/㎢, 다양성 중앙값 {q['medianEntropy']:.3f}로 구분한다. 중앙값 이상은 상대적으로 높음, 미만은 상대적으로 낮음으로 처리한다. 이 기준은 정책적 적정기준이 아니다.

## 주요 결과
2025년 4분기 분석 대상 전체 점포는 {q['total']:,}개이다. 밀도와 다양성의 피어슨 상관계수는 {q['pearson']:.3f}, 순위를 비교한 스피어만 상관계수는 {q['spearman']:.3f}이다. 상관은 원인을 입증하지 않는다.
밀도가 가장 높은 동은 {dense['district']} {dense['name']}({dense['density']:,.1f}개/㎢), 다양성이 가장 높은 동은 {diverse['district']} {diverse['name']}({diverse['entropy']:.3f})이다.
고밀도·저다양성은 {q['typeCounts'][1]}개 동에서 관측됐다. 다음은 그중 밀도 상위 사례다.
{examples}

## 공간적 해석
밀도는 점포의 양을 면적으로 보정하고, 다양성은 그 점포가 업종별로 얼마나 고르게 구성되는지 측정한다. 따라서 점포가 조밀해도 특정 판매·서비스 기능에 집중된 지역이면 다양성은 낮을 수 있다. 이 차이는 단순한 점포 수 순위로는 드러나지 않는 상권의 특화와 구성 차이를 보여준다. 실제 원인은 상위 업종 구성, 주변 토지이용과 현장 조사 등을 추가로 확인해야 한다.
고밀도·저다양성을 상권이 나쁘거나 상점이 부족하다는 뜻으로 해석하지 않는다. 전문상권의 집적은 수요를 끌어들이는 장점도 있을 수 있다. 저밀도 지역 역시 산지·수면이 포함된 넓은 행정동일 수 있어 공급 부족을 단정할 수 없다.

## 시각화
- 공간 시각화: 425개 행정동의 네 유형 지도, 밀도·다양성 지도 전환.
- 비공간 시각화: 밀도(로그축)와 다양성 산점도, 선택 동의 업종 구성 막대그래프.
- 지도·산점도의 중앙값 기준은 자치구 필터를 바꿔도 서울 전체 기준으로 고정한다.

## 한계
1. 생활밀접 100개 업종 자료의 구성이다. 모든 산업과 모든 물리적 매장을 포괄하지 않으며 전자상거래업도 포함돼 실제 보행 선택지와 다를 수 있다.
2. 점포별 정확한 위치·면적·매출·품질·영업시간이 없어 개인의 실제 선택권이나 접근성을 직접 측정하지 않는다.
3. 행정동 총면적을 분모로 사용해 산지·하천의 영향을 받는다. 가용 상업용지 기준 밀도는 후속 분석 대상이다.
4. 상권 서비스가 사용하는 경계·명칭을 기준으로 하며 현재의 행정동 경계와 완전히 같지 않다.
5. 분기별 현황 간 비교이며, 동일 점포의 개별 변화를 추적하지 않는다. 업종 분류를 바꾸면 다양성과 순위가 달라질 수 있다.

## 재현
`pip install -r requirements.txt` 후 `python scripts/build_analysis.py`로 계산한다. 웹앱은 dist/의 정적 파일만 제공하므로 API 키가 필요 없다.
"""


def main():
    stores, boundary = read_sources()
    data, table = analyze(stores, boundary)
    data["audit"] = {"rawRows":len(stores), "duplicateRows":0, "missingCounts":0,
                     "mappedDongs":len(boundary), "industryCount":100,
                     "source":SOURCE_URL, "boundarySource":BOUNDARY_URL,
                     "sourceSha256":sha256((ROOT / "source_data/stores-2025.zip").read_bytes()).hexdigest(),
                     "boundarySha256":sha256((ROOT / "source_data/seoul-commercial-dongs.zip").read_bytes()).hexdigest()}
    target = ROOT / "dist/data"
    target.mkdir(parents=True, exist_ok=True)
    (ROOT / "docs").mkdir(exist_ok=True)
    (target / "analysis.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",",":"), allow_nan=False), encoding="utf-8")
    table.to_csv(target / "dong-metrics.csv", index=False, encoding="utf-8-sig")
    # 표시용 경계만 12m로 단순화합니다. 면적값은 원본 도형에서 이미 계산했습니다.
    display = boundary[["ADSTRD_CD", "ADSTRD_NM", "geometry"]].copy()
    display.geometry = display.geometry.simplify(12, preserve_topology=True)
    display = display.to_crs(4326)
    features = json.loads(display.to_json())
    for feature in features["features"]:
        feature["properties"] = {"code":feature["properties"]["ADSTRD_CD"]}
        feature.pop("id", None)
    (target / "dongs.geojson").write_text(json.dumps(features, ensure_ascii=False, separators=(",",":")), encoding="utf-8")
    report = build_report(data)
    (ROOT / "docs/analysis-report.md").write_text(report, encoding="utf-8")
    # 다운로드용 본문과 저장소 문서가 같은 결과를 사용합니다.
    (target / "analysis-report.txt").write_text(report, encoding="utf-8")
    print(json.dumps({"audit":data["audit"], "q4":{k:v for k,v in data['quarters']['20254'].items() if k not in ['rows','counts','industryTotals']}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
