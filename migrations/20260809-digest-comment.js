// Добавляет поле comment в каждую запись entries дайджеста (появилось в 2026-08).
// Старые записи хранились без comment и бэкфилл невозможен (cacheJudgements comment не хранил),
// поэтому ставим null. $mergeObjects не затирает уже существующий comment.
module.exports = {
  async up(db) {
    const result = await db.collection('digest').updateMany(
      {},
      [{ $set: { entries: {
        $map: {
          input: '$entries',
          as: 'e',
          in: { $mergeObjects: [{ comment: null }, '$$e'] },
        },
      } } }],
    );
    console.log(`Digest updated: ${result.modifiedCount} docs`);
  },

  async down(db) {
    const result = await db.collection('digest').updateMany(
      {},
      [{ $set: { entries: {
        $map: {
          input: '$entries',
          as: 'e',
          in: { $unsetField: { field: 'comment', input: '$$e' } },
        },
      } } }],
    );
    console.log(`Digest reverted: ${result.modifiedCount} docs`);
  },
};
