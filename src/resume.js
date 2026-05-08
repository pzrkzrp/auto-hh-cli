// Загрузка резюме из локального файла. Поддерживает .txt / .md / .pdf.
// Для PDF используется base64 + блок document в API Claude.
const fs = require('fs');
const path = require('path');

function loadResume() {
  const p = process.env.RESUME_PATH;
  if (!p) return null;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    throw new Error(`Resume file not found: ${abs}`);
  }
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.pdf') {
    return {
      type: 'pdf',
      data: fs.readFileSync(abs).toString('base64'),
      filename: path.basename(abs),
    };
  }
  return {
    type: 'text',
    text: fs.readFileSync(abs, 'utf-8'),
    filename: path.basename(abs),
  };
}

module.exports = { loadResume };
