const { MongoClient } = require('mongodb');
require('dotenv').config();

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db();
  const resume = await db.collection('resumes').findOne({});
  const resumeId = resume?.resumeId || 'cede1cb3-5355-5d53-98a2-11b5f651523b';
  console.log('resumeId:', resumeId);

  const r1 = await db.collection('cacheJudgements').updateMany(
    { resumeId: { $exists: false } },
    { $set: { resumeId } }
  );
  console.log('cacheJudgements updated:', r1.modifiedCount);

  const r2 = await db.collection('cacheCoverLetters').updateMany(
    { resumeId: { $exists: false } },
    { $set: { resumeId } }
  );
  console.log('cacheCoverLetters updated:', r2.modifiedCount);

  await client.close();
})();
