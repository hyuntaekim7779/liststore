/**
 * App 설정.
 * - corsProxy: Naver Map 모바일 place 페이지를 받아오는 데 사용하는 CORS 프록시.
 *   기본값은 corsproxy.io 공개 프록시. 자체 Cloudflare Worker / Azure Function 등으로
 *   교체하려면 이 값만 바꿔주세요. (URL 뒤에 ?url= 형태로 끝나야 함)
 *
 * - placeLookup: URL로 자동 등록 시 좌표/주소/이름을 자동 추출할지 여부.
 */
window.AppConfig = {
  corsProxy: 'https://corsproxy.io/?url=',
  placeLookup: true,
};
