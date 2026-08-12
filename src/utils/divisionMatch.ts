/**
 * DITC_NM(제공 주체 구분) 필터 매칭.
 * 실제 값은 "서울시(본청)" / "서울시(산하기관)" / "자치구 및 자치구산하" / "공공기관(외부)" 등이므로
 * 사용자가 "본청"/"산하기관"/"자치구"처럼 짧게 입력해도 포함 매칭으로 걸리게 한다.
 */
export function matchesDivision(division: string, filter?: string): boolean {
  if (!filter) return true;
  return division.includes(filter.trim());
}
