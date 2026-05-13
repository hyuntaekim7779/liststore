/**
 * Azure Table Storage adapter.
 *
 * 데이터 모델:
 *   stores 테이블: PartitionKey = 'lunch' | 'dinner', RowKey = store.id,
 *                  Payload (JSON 문자열, 가게 정보 전체)
 *   votes  테이블: PartitionKey = 'lunch' | 'dinner', RowKey = 'current',
 *                  Payload (JSON 문자열, 투표 정보 전체)
 *
 * window.AppConfig.storage === 'azure' 일 때 자동으로 window.Storage 를 덮어씁니다.
 * 그렇지 않으면 storage.js 의 localStorage 어댑터가 유지됩니다.
 *
 * ⚠️ SAS 토큰은 클라이언트 코드에 노출됩니다. 공개·편집 가능 모드 전제.
 */
(function () {
  if (!window.AppConfig || window.AppConfig.storage !== 'azure') {
    console.info('[storage-azure] storage != "azure", skipping (using localStorage).');
    return;
  }

  const cfg = window.AppConfig.azure || {};
  const ACCOUNT = cfg.account;
  const SAS = (cfg.sas || '').replace(/^\?/, '');
  const TABLE_STORES = cfg.tableStores || 'stores';
  const TABLE_VOTES  = cfg.tableVotes  || 'votes';

  if (!ACCOUNT || !SAS) {
    console.error('[storage-azure] account 또는 sas 가 설정되지 않았습니다. localStorage 로 폴백.');
    return;
  }

  const BASE = `https://${ACCOUNT}.table.core.windows.net`;
  const COMMON_HEADERS = {
    'Accept': 'application/json;odata=nometadata',
    'Content-Type': 'application/json',
    'x-ms-version': '2019-02-02',
  };

  function escapeOData(s) { return String(s).replace(/'/g, "''"); }
  function entityUrl(table, pk, rk) {
    return `${BASE}/${table}(PartitionKey='${escapeOData(pk)}',RowKey='${escapeOData(rk)}')?${SAS}`;
  }
  function listUrl(table, filter) {
    const f = filter ? `&$filter=${encodeURIComponent(filter)}` : '';
    return `${BASE}/${table}()?${SAS}${f}`;
  }

  async function listEntities(table, pk) {
    const res = await fetch(listUrl(table, `PartitionKey eq '${escapeOData(pk)}'`), {
      method: 'GET', headers: COMMON_HEADERS,
    });
    if (!res.ok) {
      console.error(`[azure] list ${table} ${pk} → ${res.status}`, await res.text());
      return [];
    }
    const data = await res.json();
    return data.value || [];
  }

  async function getEntity(table, pk, rk) {
    const res = await fetch(entityUrl(table, pk, rk), {
      method: 'GET', headers: COMMON_HEADERS,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[azure] get ${table} ${pk}/${rk} → ${res.status}`, await res.text());
      return null;
    }
    return await res.json();
  }

  async function putEntity(table, pk, rk, props) {
    const body = { PartitionKey: pk, RowKey: rk, ...props };
    const res = await fetch(entityUrl(table, pk, rk), {
      method: 'PUT',
      headers: { ...COMMON_HEADERS, 'If-Match': '*' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 204) {
      const t = await res.text();
      console.error(`[azure] put ${table} ${pk}/${rk} → ${res.status}`, t);
      throw new Error(`Azure PUT failed: ${res.status}`);
    }
  }

  async function deleteEntity(table, pk, rk) {
    const res = await fetch(entityUrl(table, pk, rk), {
      method: 'DELETE',
      headers: { ...COMMON_HEADERS, 'If-Match': '*' },
    });
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      const t = await res.text();
      console.error(`[azure] delete ${table} ${pk}/${rk} → ${res.status}`, t);
      throw new Error(`Azure DELETE failed: ${res.status}`);
    }
  }

  function parsePayload(entity) {
    if (!entity || !entity.Payload) return null;
    try { return JSON.parse(entity.Payload); } catch { return null; }
  }

  const AzureStorage = {
    async getStores(meal) {
      const entities = await listEntities(TABLE_STORES, meal);
      return entities.map(parsePayload).filter(Boolean);
    },

    async saveStores(meal, stores) {
      // 1) 기존 엔티티 키 목록 가져오기
      let existing = [];
      try { existing = await listEntities(TABLE_STORES, meal); } catch (e) { /* ignore */ }
      const newIds = new Set(stores.map((s) => s.id));

      // 2) 새 리스트에 없는 기존 엔티티는 삭제
      const toDelete = existing.filter((e) => !newIds.has(e.RowKey));
      await Promise.all(toDelete.map((e) =>
        deleteEntity(TABLE_STORES, meal, e.RowKey).catch((err) => console.error('del:', err))
      ));

      // 3) 현재 리스트 전부 upsert (PUT 은 idempotent)
      await Promise.all(stores.map((s) =>
        putEntity(TABLE_STORES, meal, s.id, { Payload: JSON.stringify(s) })
          .catch((err) => console.error('put:', err))
      ));
    },

    async getVote(meal) {
      const e = await getEntity(TABLE_VOTES, meal, 'current');
      return parsePayload(e);
    },

    async saveVote(meal, vote) {
      await putEntity(TABLE_VOTES, meal, 'current', { Payload: JSON.stringify(vote) });
    },

    async clearVote(meal) {
      await deleteEntity(TABLE_VOTES, meal, 'current');
    },
  };

  window.Storage = AzureStorage;
  console.info(`[storage-azure] using account "${ACCOUNT}" tables: ${TABLE_STORES}, ${TABLE_VOTES}`);
})();
