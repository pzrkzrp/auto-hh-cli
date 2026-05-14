// migrate-mongo configuration
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  mongodb: {
    url: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    databaseName: process.env.MONGODB_URI
      ? new URL(process.env.MONGODB_URI).pathname.replace(/^\//, '') || 'autohh'
      : 'autohh',
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
};
