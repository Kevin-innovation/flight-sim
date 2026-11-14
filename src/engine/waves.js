// Wave definitions. Each wave escalates enemy count, skill and weaponry.
export const WAVES = [
  { name: '정찰 편대', jets: 2, props: 1, skill: 0.25, missiles: false },
  { name: '요격 편대', jets: 3, props: 1, skill: 0.4, missiles: false },
  { name: '강습 편대', jets: 3, props: 2, skill: 0.55, missiles: true },
  { name: '에이스 편대', jets: 4, props: 2, skill: 0.7, missiles: true },
  { name: '아이언 호라이즌', jets: 6, props: 1, skill: 0.85, missiles: true },
];

export const ENEMY_TYPES = {
  jet: { model: 'jetEnemy', hp: 90, cruise: 160, boost: 255, pitchRate: 1.25, rollRate: 2.6, radius: 9, score: 150, callsign: 'RAPTOR' },
  prop: { model: 'propEnemy', hp: 60, cruise: 125, boost: 175, pitchRate: 1.55, rollRate: 3.1, radius: 7, score: 100, callsign: 'BANDIT' },
};

export function waveEnemyList(waveIndex) {
  const w = WAVES[Math.min(waveIndex, WAVES.length - 1)];
  const list = [];
  for (let i = 0; i < w.jets; i++) list.push('jet');
  for (let i = 0; i < w.props; i++) list.push('prop');
  return list;
}
