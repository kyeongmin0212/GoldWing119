"""G-J 골든타임 윙 — Orchestrate 도구 6개 (결정적 계산만, 판정·처분은 하지 않음).
대시보드(src/lib/*.ts)와 같은 규칙을 Python 으로 옮긴 것. 좌표·구역은 시연용 개략/가상 값.
업로드: orchestrate tools import -k python -f gjw_tools.py   (접두사는 upload.ps1 이 바꿔 줌)
"""
import json
import math
import re

try:
    from ibm_watsonx_orchestrate.agent_builder.tools import tool
except ImportError:  # 로컬 점검용
    def tool(name=None, description=None):
        return lambda f: f

KM_PER_LAT = 111.0
KM_PER_LNG = 91.2  # 위도 35° 부근
AIRPORT = (35.1264, 126.8089)  # 광주공항 (공개 지도 기준 개략)
CONTROL_ZONE_KM = 9.3  # 관제권 반경 5NM — 금지가 아니라 승인·관제탑 협의 대상
SAFETY_MARGIN_KM = 0.35
DRONE_KMH = 54  # 도크 자동 출동 기체(DJI Dock 3 + Matrice 4D) Normal 모드 상한 15m/s
RUSH_HOURS = [(7, 9), (17, 20)]
DELAY_THRESHOLD_MIN = 3.0
CLUSTER_KM = 1.5
MAX_DRONES = 2


def _dump(o):
    return json.dumps(o, ensure_ascii=False)


def _xy(lat, lng):
    return ((lng - 126.68) * KM_PER_LNG, (35.28 - lat) * KM_PER_LAT)


def _dist(a, b):
    return math.hypot((a[1] - b[1]) * KM_PER_LNG, (a[0] - b[0]) * KM_PER_LAT)


def _corridor(center, bearing_deg, half_len, half_w):
    b = math.radians(bearing_deg)
    ue, un = math.sin(b), math.cos(b)
    ve, vn = math.cos(b), -math.sin(b)

    def pt(l, w):
        return (center[0] + (l * un + w * vn) / KM_PER_LAT, center[1] + (l * ue + w * ve) / KM_PER_LNG)

    return [pt(half_len, half_w), pt(half_len, -half_w), pt(-half_len, -half_w), pt(-half_len, half_w)]


AVOID_ZONES = {
    "활주로 진입·이륙 경로 (가정)": _corridor(AIRPORT, 40, 4.5, 0.8),
    "송전선로 보호구역 (가상)": [(35.082, 126.812), (35.089, 126.812), (35.066, 126.876), (35.059, 126.876)],
    "군사시설 보호구역 (가상)": [(35.2, 126.9), (35.215, 126.925), (35.2, 126.95), (35.185, 126.925)],
}


def _in_poly(p, poly):
    x, y = _xy(*p)
    pts = [_xy(*q) for q in poly]
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = _xy(*p), _xy(*a), _xy(*b)
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _near_poly(p, poly, margin):
    if _in_poly(p, poly):
        return True
    return any(_seg_dist(p, poly[i - 1], poly[i]) < margin for i in range(len(poly)))


@tool(name="gjw_check_flight_route", description="드론 비행 경로(위경도 꼭짓점 JSON)가 회피구역(활주로 회랑·송전선로·군사시설)과 겹치는지, 광주공항 관제권(9.3km, 승인 필요)을 지나는지 계산한다. 비행 허가 여부는 판단하지 않는다.")
def gjw_check_flight_route(waypoints_json: str) -> str:
    """비행 경로를 회피구역·관제권과 대조한다.

    Args:
        waypoints_json (str): [[위도, 경도], ...] JSON 문자열. 예: [[35.142,126.769],[35.138,126.88]]

    Returns:
        str: blocked_by(겹치는 회피구역), in_control_zone, length_km, 안내 문구를 담은 JSON.
    """
    try:
        pts = [tuple(map(float, p)) for p in json.loads(waypoints_json)]
        assert len(pts) >= 2
    except Exception:
        return _dump({"error": "waypoints_json 은 [[위도, 경도], ...] 형식(2개 이상)이어야 합니다."})
    blocked, in_ctr, length = set(), False, 0.0
    for a, b in zip(pts, pts[1:]):
        seg = _dist(a, b)
        length += seg
        n = max(2, math.ceil(seg / 0.1))
        for i in range(n + 1):
            t = i / n
            p = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            for name, poly in AVOID_ZONES.items():
                if _near_poly(p, poly, SAFETY_MARGIN_KM):
                    blocked.add(name)
            if _dist(p, AIRPORT) <= CONTROL_ZONE_KM:
                in_ctr = True
    return _dump({
        "blocked_by": sorted(blocked),
        "needs_detour": bool(blocked),
        "in_control_zone": in_ctr,
        "control_zone_note": "관제권은 금지가 아니라 승인 대상이며 긴급비행 특례도 승인을 면제하지 않음. 지자체 소방드론의 화재·재난 대응 긴급 비행(항공안전법 제131조의2 제2항)은 사전 통보 시 승인 간주(항공안전법 제127조④, 시행규칙 제308조⑧), 비행 후 승인신청서 제출(제308조⑨). 단속 정찰 목적은 교통장애 모니터링(제313조의2①8호) — 출동 연계에 한정" if in_ctr else "",
        "length_km": round(length, 2),
        "safety_margin_km": SAFETY_MARGIN_KM,
    })


@tool(name="gjw_recommend_drone_dispatch", description="신고 시각·예상 지연(분)·경로상 혼잡 지점 목록으로 드론 투입 대수(0~2)를 규칙대로 권고한다. 최종 투입은 관제요원이 승인한다.")
def gjw_recommend_drone_dispatch(reported_at: str, expected_delay_min: float, hotspots_json: str = "[]") -> str:
    """드론 투입 권고 (규칙: 지연 3분 이상 또는 혼잡 지점 포함 → 투입, 1.5km 이내 묶음 1개=1대, 떨어진 묶음 2개 이상=2대).

    Args:
        reported_at (str): 신고 시각 'HH:MM'.
        expected_delay_min (float): 평시 대비 예상 지연(분).
        hotspots_json (str): 경로상 혼잡 지점 [{"name":..,"kind":"상습정체|불법주정차다발","lat":..,"lng":..}] JSON.

    Returns:
        str: recommend(대수), rush_hour, clusters, reasons 를 담은 JSON.
    """
    try:
        hour = int(reported_at.split(":")[0])
        spots = json.loads(hotspots_json or "[]")
    except Exception:
        return _dump({"error": "reported_at 은 'HH:MM', hotspots_json 은 JSON 배열이어야 합니다."})
    rush = any(a <= hour < b for a, b in RUSH_HOURS)
    active = [s for s in spots if s.get("kind") == "불법주정차다발" or rush]
    clusters = []
    for s in active:
        p = (float(s["lat"]), float(s["lng"]))
        for c in clusters:
            if any(_dist(p, q) <= CLUSTER_KM for q in c["pts"]):
                c["pts"].append(p)
                c["names"].append(s["name"])
                break
        else:
            clusters.append({"pts": [p], "names": [s["name"]]})
    if not clusters and float(expected_delay_min) >= DELAY_THRESHOLD_MIN:
        clusters.append({"pts": [], "names": ["지연이 가장 큰 구간"]})
    n = min(MAX_DRONES, len(clusters))
    reasons = [
        f"신고 시각 {reported_at} — {'출퇴근 시간대' if rush else '평시 시간대'}",
        f"예상 지연 {float(expected_delay_min):.1f}분 (기준 {DELAY_THRESHOLD_MIN:.0f}분)",
        f"활성 혼잡 지점 {len(active)}곳" + (" (상습정체는 출퇴근 시간대에만 활성)" if not rush and spots else ""),
        "투입 불필요 — 소방차만 출동" if n == 0 else f"혼잡 묶음 {len(clusters)}개 → 드론 {n}대 (1건당 최대 {MAX_DRONES}대)",
    ]
    return _dump({"recommend": n, "rush_hour": rush, "clusters": [c["names"] for c in clusters], "reasons": reasons,
                  "final_decision": "관제요원 [드론 투입 승인] 필요"})


@tool(name="gjw_compare_eta", description="소방차 도로 거리·평균 속도와 드론 비행 거리(우회 포함)로 도착 시간을 비교해 드론 선행 시간을 계산한다.")
def gjw_compare_eta(road_km: float, road_speed_kmh: float, air_km: float, launch_prep_sec: int = 25) -> str:
    """소방차 vs 드론 도착 시간 비교.

    Args:
        road_km (float): 소방차 도로 거리(km).
        road_speed_kmh (float): 소방차 예상 평균 속도(km/h).
        air_km (float): 드론 비행 거리(km, 회피 우회 포함).
        launch_prep_sec (int): 이륙 준비 시간(초).

    Returns:
        str: truck_min, drone_min, lead_min 을 담은 JSON.
    """
    try:
        truck = float(road_km) / float(road_speed_kmh) * 60
        drone = float(air_km) / DRONE_KMH * 60 + int(launch_prep_sec) / 60
    except (ValueError, ZeroDivisionError):
        return _dump({"error": "숫자 값을 확인하세요 (속도는 0보다 커야 함)."})
    return _dump({"truck_min": round(truck, 1), "drone_min": round(drone, 1), "lead_min": round(truck - drone, 1),
                  "drone_speed_kmh": DRONE_KMH, "note": "시뮬레이션 가정값"})


PLATE_RE = re.compile(r"^(\d{2,3})([가-힣])\s?(\d{4})$")
USE_PRIVATE = set("가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주")
USE_RENTAL = set("하허호")
USE_BUSINESS = set("아바사자배")


@tool(name="gjw_validate_plate", description="OCR로 읽은 번호판 문자열이 형식(숫자 2~3자리 + 한글 1자 + 숫자 4자리)에 맞는지, 앞자리로 차종(승용·승합·화물·특수), 한글로 용도(자가용·렌터카·사업용)를 알려준다. 형식이 안 맞으면 사람 확인 필요. 소유자 조회는 하지 않는다.")
def gjw_validate_plate(plate: str) -> str:
    """번호판 형식 검증 (국토교통부 자동차 등록번호판 기준 고시의 차종 분류기호 범위).

    Args:
        plate (str): 예: '12가 3456'

    Returns:
        str: valid, vehicle_class, normalized 를 담은 JSON.
    """
    m = PLATE_RE.match(plate.strip())
    if not m:
        return _dump({"valid": False, "reason": "형식 불일치 — 사람 확인 필요", "plate": plate})
    num = int(m.group(1))
    two = num if num < 100 else num // 10
    if 1 <= two <= 69:
        cls = "승용"
    elif 70 <= two <= 79:
        cls = "승합"
    elif 80 <= two <= 97:
        cls = "화물"
    elif 98 <= two <= 99:
        cls = "특수"
    else:
        cls = "확인 필요"
    ch = m.group(2)
    use = "자가용" if ch in USE_PRIVATE else "렌터카" if ch in USE_RENTAL else "사업용" if ch in USE_BUSINESS else "확인 필요"
    return _dump({"valid": True, "normalized": f"{m.group(1)}{ch} {m.group(3)}", "vehicle_class": cls, "use": use,
                  "note": "형식 검증만 함. 실제 차량 정보 조회 없음"})


# 전남광주통합특별시(2026-07-01 출범): 시·군·구 명칭과 관할 유지, 광역 명칭만 변경. 코드: 옛 광주 29xxx / 옛 전남 46xxx (통합 후 코드 변경 여부 확인 필요)
CITY = "전남광주통합특별시"
CODES = {"동구": "29110", "서구": "29140", "남구": "29155", "북구": "29170", "광산구": "29200",
         "나주시": "46170", "담양군": "46710", "화순군": "46790", "장성군": "46880"}


def _jurisdiction_short(lat, lng):
    if lat >= 35.24 and lng < 126.85:
        return "장성군", "장성군청 교통행정과"
    if lat >= 35.24 and lng >= 126.93:
        return "담양군", "담양군청 건설교통과"
    if lat < 35.07 and lng < 126.9:
        return "나주시", "나주시청 교통행정과"
    if lng >= 126.94 and lat < 35.12:
        return "화순군", "화순군청 건설교통과"
    if lng < 126.84:
        return "광산구", "광산구청 교통지도과"
    if lat >= 35.165:
        return "북구", "북구청 교통행정과"
    if lng >= 126.91 and lat >= 35.12:
        return "동구", "동구청 교통과"
    if lat < 35.135 and lng >= 126.84:
        return "남구", "남구청 교통과"
    return "서구", "서구청 교통과"


def _jurisdiction(lat, lng):
    """(공식 관할 이름, 공식 기관명, 짧은 이름) — 예: ('전남광주통합특별시 남구', '전남광주통합특별시 남구청 교통과', '남구')"""
    short, agency = _jurisdiction_short(lat, lng)
    return f"{CITY} {short}", f"{CITY} {agency}", short


@tool(name="gjw_map_jurisdiction", description="위경도로 전남광주통합특별시 관할 시·군·구(옛 광주 5개 구, 옛 전남 나주·담양·화순·장성)와 담당 부서를 개략 매핑한다. 시연용 바운딩박스이며 실제 행정경계가 아니다.")
def gjw_map_jurisdiction(lat: float, lng: float) -> str:
    """관할 지자체 개략 매핑.

    Args:
        lat (float): 위도
        lng (float): 경도

    Returns:
        str: jurisdiction, agency 를 담은 JSON.
    """
    j, a, short = _jurisdiction(float(lat), float(lng))
    code = CODES.get(short, "확인 필요")
    return _dump({"jurisdiction": j, "short": short, "code": code, "former": "옛 광주" if code.startswith("29") else "옛 전남",
                  "agency": a, "note": "개략 매핑 — 경계 지역은 담당자 확인"})


# 국가법령정보센터 현행본 기준 (2026-11-20 확인). 과태료 금액은 넣지 않음(판단은 담당자)
LEGAL = [
    ("소화전", "도로교통법 제32조 제6호 — 소방용수시설·비상소화장치 5m 이내 정차·주차 금지"),
    ("전용구역", "소방기본법 제21조의2 제2항 — 소방자동차 전용구역 주차·진입 방해 금지"),
    ("진로 방해", "소방기본법 제21조 제3항 — 출동 중인 소방자동차의 진로 양보 거부·끼어들기·가로막기 등 출동 방해 금지"),
    ("긴급차량", "소방기본법 제21조 제3항 — 출동 중인 소방자동차의 진로 양보 거부·끼어들기·가로막기 등 출동 방해 금지"),
    ("진로 방해", "도로교통법 제29조 제4·5항 — 긴급자동차 접근 시 일시정지·진로 양보"),
    ("긴급차량", "도로교통법 제29조 제4·5항 — 긴급자동차 접근 시 일시정지·진로 양보"),
    ("모퉁이", "도로교통법 제32조 제2호 — 교차로 가장자리·도로 모퉁이 5m 이내 정차·주차 금지"),
]


@tool(name="gjw_build_report_draft", description="탐지 결과(번호판·사유·위치·시각)로 관할 지자체 통보용 초안 JSON을 만든다(소방 출동 연계 자료, 주민신고 아님). 위반 확정·과태료·견인 결정은 하지 않는다.")
def gjw_build_report_draft(plate: str, reason: str, location: str, lat: float, lng: float, detected_at: str) -> str:
    """신고서 초안 생성.

    Args:
        plate (str): 번호판(가상)
        reason (str): 위반 의심 사유
        location (str): 위치 설명
        lat (float): 위도
        lng (float): 경도
        detected_at (str): 탐지 시각

    Returns:
        str: 신고서 초안 필드를 담은 JSON.
    """
    j, a, short = _jurisdiction(float(lat), float(lng))
    basis = sorted({b for k, b in LEGAL if k in reason}) or ["문서에서 확인할 수 없음 — 담당자 확인 필요"]
    return _dump({
        "title": f"[긴급출동 진로방해 차량 — 관할 지자체 통보] {plate} (가상)",
        "jurisdiction": j,
        "jurisdiction_code": CODES.get(short, "확인 필요"),
        "agency": a,
        "plate": plate,
        "location": location,
        "coords": f"{float(lat):.5f}, {float(lng):.5f}",
        "detected_at": detected_at,
        "violation": reason,
        "legal_basis": basis,
        "requested_action": "과태료 부과 검토, 필요 시 소방기본법 제25조 제4항에 따른 견인차량·인력 지원 요청 (견인 필요 여부는 현장 지휘관, 처분은 관할 지자체 담당자 판단)",
        "evidence": ["같은 위치·각도 1분 간격 사진 2장", "GPS 좌표", "타임스탬프", "원본 파일 해시(SHA-256)", "얼굴 자동 블러 처리본"],
        "privacy": "번호판 OCR 결과는 통보 전까지 최소 보관, 촬영 고지(개인정보 보호법 제25조의2)",
        "status": "초안 — 관제요원 승인 대기",
    })


if __name__ == "__main__":  # 로컬 점검: py -3.12 -I gjw_tools.py
    print(gjw_check_flight_route("[[35.142,126.769],[35.138,126.88]]"))
    print(gjw_check_flight_route("[[35.02,126.79],[35.055,126.825]]"))
    print(gjw_recommend_drone_dispatch("08:12", 17.5, json.dumps([
        {"name": "백운광장 교차로 상습정체", "kind": "상습정체", "lat": 35.133, "lng": 126.896},
        {"name": "봉선동 이면도로 불법주정차 다발", "kind": "불법주정차다발", "lat": 35.129, "lng": 126.905}], ensure_ascii=False)))
    print(gjw_recommend_drone_dispatch("18:07", 20.0, json.dumps([
        {"name": "국도1호선 진입 병목", "kind": "상습정체", "lat": 35.07, "lng": 126.84},
        {"name": "효천지구 이면도로", "kind": "불법주정차다발", "lat": 35.092, "lng": 126.865}], ensure_ascii=False)))
    print(gjw_recommend_drone_dispatch("02:40", 0.0, "[]"))
    print(gjw_compare_eta(8.4, 30, 11.9))
    print(gjw_validate_plate("75나 7712"), gjw_validate_plate("812다 4518"), gjw_validate_plate("12가 345"))
    print(gjw_map_jurisdiction(35.1302, 126.9027))
    print(gjw_build_report_draft("12가 3456", "긴급차량 진로 방해 / 소화전 5m 이내 주정차", "전남광주통합특별시 남구 봉선동 이면도로 (가상)", 35.1302, 126.9027, "2026-11-21 08:30"))
