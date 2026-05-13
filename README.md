# 🍽️ 점심 / 저녁 가게 리스트

점심 / 저녁 식사 가게를 등록하고, 네이버 지도로 위치를 확인하고, 룰렛으로 무작위 선택하거나, 시간 제한이 있는 투표를 진행할 수 있는 정적 웹앱입니다.

GitHub Pages 같은 정적 호스팅에서 바로 동작합니다.

## 기능

- 🥗 점심 / 🍻 저녁 탭으로 가게 리스트 분리 관리
- 가게 등록: 이름, 네이버 지도 URL, 주소, 좌표, 메모
  - URL에서 좌표 자동 추출 시도
  - 주소 입력 시 Naver Geocoder로 좌표 자동 채움
- 🗺️ 네이버 지도 마커 표시 + 클릭 시 정보창
- 🎯 룰렛: 등록 가게 중 **최대 5개**를 랜덤으로 뽑아 캔버스 룰렛으로 추첨
- 🗳️ 투표: 후보를 랜덤 선정, **시작/종료 시간**을 설정해 해당 시간대에만 투표 가능
  - 투표자 이름 필수 입력 (이름 기준 1인 1표)

## 빠른 시작 (로컬)

이 폴더에서 정적 파일을 그대로 브라우저에 띄우면 됩니다.

```powershell
# 옵션 1: Python 간이 서버
python -m http.server 8000
# → http://localhost:8000

# 옵션 2: VS Code Live Server, http-server 등 어떤 정적 서버도 OK
```

> ⚠️ `file://` 로 직접 열면 네이버 지도 API가 도메인 인증에 실패할 수 있어요. 가급적 `localhost` 로 띄우세요.

## GitHub Pages 배포

1. GitHub에서 새 repository 생성 (예: `lunch-dinner-list`)
2. 이 폴더에서 git 세팅:
   ```powershell
   git init
   git add .
   git commit -m "Initial commit: lunch/dinner list app"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/<REPO>.git
   git push -u origin main
   ```
3. GitHub repo → **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main` / `/ (root)` 선택 → Save
4. 1~2분 후 `https://<USERNAME>.github.io/<REPO>/` 로 접속

### Naver Cloud Platform 도메인 등록

Naver Maps API는 호출 도메인이 사전 등록되어 있어야 합니다.

- Naver Cloud Platform 콘솔 → Maps Application → Web Service URL에 아래 도메인 추가:
  - `http://localhost:8000`
  - `https://<USERNAME>.github.io`

> 등록 후 1~2분이 지나야 반영됩니다. 이 작업이 빠져 있으면 `Authentication Failed` 가 발생합니다.

## 🔐 보안 주의

- **Naver Maps Client ID** 는 브라우저 코드에 포함되어도 안전합니다 (도메인 인증으로 보호).
- **Secret Key** 는 절대 클라이언트 코드에 포함하지 마세요. 이 프로젝트는 Secret Key를 사용하지 않습니다.
  - 만약 이미 노출되었다면 NCP 콘솔에서 즉시 **재발급** 하세요.

현재 `index.html` 의 스크립트 태그:

```html
<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=rbk7lbrudl&submodules=geocoder"></script>
```

- 새 NCP 계정은 `ncpKeyId` 사용
- 구 계정은 `ncpClientId` 사용
- 인증 오류 시 두 파라미터를 서로 바꿔보세요.

## 데이터 저장

모든 데이터(가게 리스트 / 투표)는 **현재 브라우저의 localStorage** 에만 저장됩니다.

- 같은 PC, 같은 브라우저에서만 데이터가 보입니다.
- 사용자 간 데이터 공유가 필요하면 → 아래 **Azure Table Storage 연동 가이드** 참고.

## (선택) Azure Table Storage 연동

`js/storage.js` 가 어댑터 패턴으로 작성되어 있어, 아래 인터페이스만 동일하게 구현하면 `window.Storage` 를 교체해서 사용할 수 있습니다.

```js
window.Storage = {
  getStores(meal): Promise<Store[]>,
  saveStores(meal, stores): Promise<void>,
  getVote(meal): Promise<Vote|null>,
  saveVote(meal, vote): Promise<void>,
  clearVote(meal): Promise<void>,
};
```

### Azure 측 사전 작업

1. Azure Storage Account 생성
2. Table Service → 테이블 두 개 생성 (예: `Stores`, `Votes`)
3. **CORS 설정** (Storage account → Resource sharing (CORS) → Table service):
   - Allowed origins: `https://<USERNAME>.github.io`
   - Allowed methods: `GET, POST, PUT, DELETE, OPTIONS, MERGE`
   - Allowed headers: `*`, Exposed: `*`, Max age: `3600`
4. **SAS 토큰 발급** (Shared access signature)
   - Allowed services: Table
   - Allowed resource types: Service, Container, Object
   - Allowed permissions: Read, Write, Delete, List, Add, Update
   - Start/Expiry: 짧게 (예: 하루)
   - 결과 SAS token 문자열 보관

> ⚠️ 위 SAS 토큰을 그대로 클라이언트 JS에 박으면 누구나 쓰기 권한을 갖게 됩니다. **사내/지인 그룹용 비공개 페이지**가 아니라면 권장하지 않으며, 더 안전한 방법은 **Azure Function 등 경량 백엔드**를 두어 거기서 SAS를 발급/검증하는 것입니다.

### 어댑터 예시 (`js/storage-azure.js`)

```js
(function () {
  const ACCOUNT = 'YOUR_STORAGE_ACCOUNT';
  const SAS = 'sv=...&sig=...';   // SAS token (no leading '?')
  const BASE = `https://${ACCOUNT}.table.core.windows.net`;

  async function call(path, method='GET', body=null) {
    const url = `${BASE}/${path}${path.includes('?') ? '&' : '?'}${SAS}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json;odata=nometadata',
        'Content-Type': 'application/json',
        'x-ms-version': '2019-02-02',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) throw new Error(`Azure ${res.status}`);
    return res.status === 404 ? null : (res.status === 204 ? null : res.json());
  }

  const PK = (meal) => `meal_${meal}`;

  window.Storage = {
    async getStores(meal) {
      const data = await call(`Stores()?$filter=PartitionKey eq '${PK(meal)}'`);
      return (data?.value || []).map((r) => JSON.parse(r.Payload));
    },
    async saveStores(meal, stores) {
      // 간단 구현: 기존 row 삭제 후 재저장 (운영용은 upsert 권장)
      // 생략 — 자세한 흐름은 Azure SDK 문서 참고
    },
    async getVote(meal) {
      const data = await call(`Votes(PartitionKey='${PK(meal)}',RowKey='current')`);
      return data ? JSON.parse(data.Payload) : null;
    },
    async saveVote(meal, vote) {
      await call(`Votes(PartitionKey='${PK(meal)}',RowKey='current')`, 'PUT', {
        PartitionKey: PK(meal), RowKey: 'current', Payload: JSON.stringify(vote),
      });
    },
    async clearVote(meal) {
      await call(`Votes(PartitionKey='${PK(meal)}',RowKey='current')`, 'DELETE');
    },
  };
})();
```

그 다음 `index.html` 의 `<script src="js/storage.js"></script>` 를 `storage-azure.js` 로 바꿔주세요.

## 파일 구조

```
/
├── index.html
├── styles.css
├── README.md
└── js/
    ├── storage.js     # localStorage 어댑터 (Azure 등으로 교체 가능)
    ├── stores.js      # 가게 CRUD
    ├── maps.js        # 네이버 지도 + Geocoder
    ├── roulette.js    # 캔버스 룰렛
    ├── voting.js      # 투표 (시작/종료시간, 이름필수)
    └── app.js         # UI 이벤트 + 전체 흐름
```

## 라이선스

MIT (자유 사용/수정/배포).
