const fs = require('fs');

function readFileSafe(path) {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch (_) {
    return '';
  }
}

const changedFiles = readFileSafe('changed_files.txt')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const prBody = process.env.PR_BODY || '';

const touchesBoutique = changedFiles.some((file) =>
  file.startsWith('public/boutique/') ||
  file === 'public/Komerce_Boutique.html' ||
  (file.startsWith('docs/') && file.toUpperCase().includes('BOUTIQUE'))
);

if (!touchesBoutique) {
  console.log('No Boutique files touched. Boutique doc guard skipped.');
  process.exit(0);
}

const requiredTerms = [
  'docs/BOUTIQUE_ARCHITECTURE.md',
  'Owner Boutique concerné'
];

const missing = requiredTerms.filter((term) => !prBody.includes(term));

if (missing.length > 0) {
  console.error('This PR touches Boutique files but does not acknowledge the Boutique architecture contract.');
  console.error('Please update the PR body and explicitly reference:');
  for (const term of missing) console.error(`- ${term}`);
  process.exit(1);
}

console.log('Boutique architecture acknowledgement OK.');
