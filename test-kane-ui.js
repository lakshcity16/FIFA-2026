const nlpNormalize = (str) => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
};
const pName = nlpNormalize('KANE Harry');
const searchable = pName;
console.log('Includes kane?', searchable.includes('kane'));
