// 비행기 한 대의 생애. 순수 함수 — three.js 도 DOM 도 쓰지 않는다.
// 그래서 node 로 시각을 주입해 새벽 3시 화면까지 테스트로 재현할 수 있다.
//
// 시계가 기본이고 remark(stc) 는 명백한 모순만 바로잡는다. API 는 10분마다
// 갱신되지만 데이터에 ±6시간이 들어 있으므로 그 사이는 시계가 메운다.

// ---------------------------------------------------------------------------
// 구간 길이 (est 기준 오프셋, 시뮬 초. 음수는 예정시각 이전)
//
// 접지(TOUCH=0)와 이륙(0)은 언제나 실제 예정·변경시각 그대로다. 조절하는 것은
// '보여주는 구간' 이지 그 순간이 아니다.
//
// 처음에 접근을 25분으로 뒀더니 15km 를 25분에 걸쳐 오게 되어(실제의 1/7 속도)
// 초당 화면의 0.2% 만 움직였고 사람 눈에는 멈춰 있었다. 그래서 2.5분으로 줄였다.
//
// 그런데 그러면 하늘이 빈다. 인천은 실제로 평균 80초에 한 번 뜨거나 내린다.
// 동시에 하늘에 있는 대수 = 운항률 × 구간길이 이므로, 구간을 줄이면 반드시 빈다.
//
// 배속이 그 둘을 동시에 푼다. 화면에서 보이는 속도는 경로길이 × 배속 / 구간길이 다.
// 구간을 배속에 비례해 늘리면 보이는 속도는 그대로면서 하늘의 대수만 늘어난다.
//   1배속  접근 2.5분   (정직하지만 한산)
//   4배속  접근 10분    (같은 속도로 보이는데 하늘은 4배)
//   8배속  접근 20분
// ---------------------------------------------------------------------------
export function spans(speed = 1) {
  const k = Math.max(1, speed);
  return {
    A: { APPROACH: -150 * k, TOUCH: 0, ROLLOUT: 60 * k, TAXI: 260 * k, PARK: 1500 + 260 * k },
    // 출발은 순서가 뒤집히면 안 된다. SHOW 는 PUSH 보다 반드시 앞이어야 한다.
    D: { SHOW: -(600 * k + 1500), PUSH: -600 * k, TAXI: -430 * k,
         LINEUP: -80 * k, ROLL: -32 * k, GONE: 150 * k },
  };
}

// 1배속 값. 테스트와 기본 호출이 쓴다.
export const A = spans(1).A;
export const D = spans(1).D;

// 프레임마다 40대 × 2회 불리므로 매번 객체를 만들지 않는다.
let _k = 1, _s = spans(1);
function at(speed) {
  if (speed !== _k) { _k = speed; _s = spans(speed); }
  return _s;
}

/**
 * @param speed 배속. 구간 길이가 이만큼 늘어난다(화면에서 보이는 속도는 그대로).
 * @returns {{k:string,p:number}|null}  null 이면 화면에 없다.
 *   p 는 그 구간 안의 진행률 0..1.
 */
export function phase(f, now, speed = 1) {
  const { A, D } = at(speed);
  const dt = now - f.est;

  // 결항은 시각이 예정시각 복사본이라 그대로 믿으면 유령 비행기가 뜬다.
  if (f.stc === 'CANCELLED') return null;

  if (f.dir === 'A') {
    if (dt < A.APPROACH || dt > A.PARK) return null;
    // '도착' 이 이미 찍혔는데 시계가 아직이면 시계를 믿지 않는다.
    if (f.stc === 'ARRIVED' && dt < A.TAXI) return { k: 'park', p: 1 };
    if (dt < A.TOUCH)   return { k: 'approach', p: (dt - A.APPROACH) / (A.TOUCH - A.APPROACH) };
    if (dt < A.ROLLOUT) return { k: 'rollout',  p: (dt - A.TOUCH) / (A.ROLLOUT - A.TOUCH) };
    if (dt < A.TAXI)    return { k: 'taxiIn',   p: (dt - A.ROLLOUT) / (A.TAXI - A.ROLLOUT) };
    return { k: 'park', p: 1 };
  }

  if (dt < D.SHOW || dt > D.GONE) return null;
  // '출발' 이 찍혔는데 시계가 아직 게이트면 이미 떠난 것이다.
  if (f.stc === 'DEPARTED' && dt < D.LINEUP) return { k: 'climb', p: 0.3 };
  if (dt < D.PUSH)    return { k: 'park',    p: 0 };
  if (dt < D.TAXI)    return { k: 'push',    p: (dt - D.PUSH) / (D.TAXI - D.PUSH) };
  if (dt < D.LINEUP)  return { k: 'taxiOut', p: (dt - D.TAXI) / (D.LINEUP - D.TAXI) };
  if (dt < D.ROLL)    return { k: 'lineup',  p: (dt - D.LINEUP) / (D.ROLL - D.LINEUP) };
  if (dt < 0)         return { k: 'roll',    p: (dt - D.ROLL) / (0 - D.ROLL) };
  return { k: 'climb', p: dt / D.GONE };
}

/** 하늘에 떠 있는가 — 통계와 색에 쓴다. */
export const isFlying = ph => ph.k === 'approach' || ph.k === 'climb';

/**
 * 연출 점수 — 지금 카메라가 따라갈 만한가. 0 이면 후보가 아니다.
 * 구간과 진행률만 본다(순수 함수). 카메라 코드가 이것만 보고 대상을 고른다.
 */
export function heroScore(ph) {
  if (!ph) return 0;
  switch (ph.k) {
    case 'roll':     return 10;                        // 이륙 활주 — 가장 극적
    case 'rollout':  return 9;                         // 착륙 직후
    case 'approach': return ph.p > 0.25 ? 6 + ph.p * 3 : 0;   // 가까워졌을 때만
    case 'climb':    return ph.p < 0.6 ? 7 - ph.p * 3 : 0;
    case 'lineup':   return 4;
    case 'push':     return 2;
    default:         return 0;                         // 주기·유도는 따라가지 않는다
  }
}
