/**
 * Voting module.
 * Vote object shape:
 *   {
 *     id: string,
 *     meal: string,
 *     candidates: [{ id, name }],
 *     startAt: number (ms),
 *     endAt: number (ms),
 *     votes: { [candidateId]: [voterName] }  // 한 후보당 투표자 이름 목록
 *   }
 *
 * 같은 이름은 한 투표 내에서 1회만 투표 가능 (간단한 중복 방지).
 */
(function () {
  function uid() {
    return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function ensureMealCurrent(current, meal) {
    if (!(meal in current)) current[meal] = null;
  }

  const Voting = {
    current: {},

    async load(meal) {
      ensureMealCurrent(this.current, meal);
      this.current[meal] = await window.Storage.getVote(meal);
      return this.current[meal];
    },

    get(meal) {
      ensureMealCurrent(this.current, meal);
      return this.current[meal];
    },

    async create(meal, candidates, startAt, endAt) {
      ensureMealCurrent(this.current, meal);
      if (!candidates || candidates.length < 2) {
        throw new Error('후보는 최소 2개 이상이어야 합니다.');
      }
      if (!startAt || !endAt || endAt <= startAt) {
        throw new Error('투표 종료 시간은 시작 시간보다 이후여야 합니다.');
      }
      const vote = {
        id: uid(),
        meal,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
        startAt,
        endAt,
        votes: Object.fromEntries(candidates.map((c) => [c.id, []])),
      };
      this.current[meal] = vote;
      await window.Storage.saveVote(meal, vote);
      return vote;
    },

    async cast(meal, candidateId, voterName) {
      ensureMealCurrent(this.current, meal);
      const name = (voterName || '').trim();
      if (!name) throw new Error('투표자 이름을 입력해주세요.');

      // 동시 투표 충돌을 줄이기 위해 저장 직전 최신 상태를 다시 읽음
      const vote = await window.Storage.getVote(meal);
      if (!vote) {
        this.current[meal] = null;
        throw new Error('진행 중인 투표가 없습니다.');
      }
      this.current[meal] = vote;

      const now = Date.now();
      if (now < vote.startAt) throw new Error('아직 투표 시작 시간이 아닙니다.');
      if (now > vote.endAt)   throw new Error('투표가 이미 종료되었습니다.');

      const already = Object.values(vote.votes).some((list) => list.includes(name));
      if (already) throw new Error('이미 투표하셨습니다. (이름 기준 1회 제한)');

      if (!vote.votes[candidateId]) vote.votes[candidateId] = [];
      vote.votes[candidateId].push(name);
      await window.Storage.saveVote(meal, vote);
      return vote;
    },

    async clear(meal) {
      ensureMealCurrent(this.current, meal);
      this.current[meal] = null;
      await window.Storage.clearVote(meal);
    },

    status(vote) {
      if (!vote) return 'none';
      const now = Date.now();
      if (now < vote.startAt) return 'pending';
      if (now > vote.endAt)   return 'ended';
      return 'open';
    },
  };

  window.Voting = Voting;
})();
