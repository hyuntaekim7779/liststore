/**
 * Storage adapter (localStorage based).
 *
 * 추후 Azure Table Storage 등 원격 저장소로 바꾸려면 아래 인터페이스만 동일하게
 * 구현한 어댑터를 만들어서 window.Storage 로 노출하면 됩니다.
 *   - getStores(meal): Promise<Store[]>
 *   - saveStores(meal, stores): Promise<void>
 *   - getVote(meal): Promise<Vote|null>
 *   - saveVote(meal, vote): Promise<void>
 *   - clearVote(meal): Promise<void>
 *
 * Azure Table Storage 어댑터 예시는 README.md 참고.
 */
(function () {
  const KEY_STORES = (meal) => `ls.stores.${meal}`;
  const KEY_VOTE   = (meal) => `ls.vote.${meal}`;
  const KEY_PEOPLE = 'ls.people.v1';
  const KEY_CAUTION = 'ls.cautions.v1';
  const KEY_ASSIGN = 'ls.assignments.v1';
  const KEY_ASSIGN_RESET = 'ls.assignments.reset.date.v1';
  const KEY_PEOPLE_BUNDLE = 'ls.people.bundle.v1';

  function safeParse(raw, fallback) {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  const Storage = {
    async getStores(meal) {
      return safeParse(localStorage.getItem(KEY_STORES(meal)), []);
    },
    async saveStores(meal, stores) {
      localStorage.setItem(KEY_STORES(meal), JSON.stringify(stores));
    },
    async getVote(meal) {
      return safeParse(localStorage.getItem(KEY_VOTE(meal)), null);
    },
    async saveVote(meal, vote) {
      localStorage.setItem(KEY_VOTE(meal), JSON.stringify(vote));
    },
    async clearVote(meal) {
      localStorage.removeItem(KEY_VOTE(meal));
    },
    async getPeopleBundle() {
      const bundle = safeParse(localStorage.getItem(KEY_PEOPLE_BUNDLE), null);
      if (bundle && typeof bundle === 'object') return bundle;
      return {
        people: safeParse(localStorage.getItem(KEY_PEOPLE), []),
        cautions: safeParse(localStorage.getItem(KEY_CAUTION), []),
        assignments: safeParse(localStorage.getItem(KEY_ASSIGN), { outside: [], lunchbox: [] }),
        resetDate: localStorage.getItem(KEY_ASSIGN_RESET) || '',
      };
    },
    async savePeopleBundle(bundle) {
      const safe = (bundle && typeof bundle === 'object') ? bundle : {};
      localStorage.setItem(KEY_PEOPLE_BUNDLE, JSON.stringify(safe));
      localStorage.setItem(KEY_PEOPLE, JSON.stringify(safe.people || []));
      localStorage.setItem(KEY_CAUTION, JSON.stringify(safe.cautions || []));
      localStorage.setItem(KEY_ASSIGN, JSON.stringify(safe.assignments || { outside: [], lunchbox: [] }));
      localStorage.setItem(KEY_ASSIGN_RESET, safe.resetDate || '');
    },
  };

  window.Storage = Storage;
})();
