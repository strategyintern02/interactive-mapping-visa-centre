const fs = require('fs');
const path = './data.json';
const d = JSON.parse(fs.readFileSync(path, 'utf8'));

const REMOVE_UK = ['CEN-0031','CEN-0032','CEN-0033','CEN-0040','CEN-0041','CEN-0042','CEN-0043','CEN-0044','CEN-0045','CEN-0046','CEN-0047','CEN-0048','CEN-0053','CEN-0054','CEN-0055','CEN-0056','CEN-0057','CEN-0058','CEN-0059','CEN-0061','CEN-0062'];

const ADD_UK = ['CEN-0010','CEN-0024','CEN-0025','CEN-0416','CEN-0131'];

const before = d.centres.filter(c => c.sourceCountry === 'India' && c.programs.includes('UK') && c.programStatuses['UK'] === 'Active').length;

let removed = 0, added = 0, cityFixed = 0;

d.centres.forEach(c => {
  if (REMOVE_UK.includes(c.id)) {
    const idx = c.programs.indexOf('UK');
    if (idx !== -1) {
      c.programs.splice(idx, 1);
      removed++;
    }
    if (c.programStatuses && 'UK' in c.programStatuses) {
      delete c.programStatuses['UK'];
    }
    c.m5PanelCount = c.programs.length;
    c.totalEmpanelment = c.programs.length;
    if (c.programs.length === 0) {
      c.status = 'Not currently approved';
    }
  }
  if (ADD_UK.includes(c.id)) {
    if (!c.programs.includes('UK')) {
      c.programs.push('UK');
      added++;
    }
    c.programStatuses = c.programStatuses || {};
    c.programStatuses['UK'] = 'Active';
    c.m5PanelCount = c.programs.length;
    c.totalEmpanelment = c.programs.length;
  }
  if (c.id === 'CEN-0018' && c.city === 'Mumbai' && c.name.includes('GEMS')) {
    c.city = 'Navi Mumbai';
    cityFixed++;
  }
});

d.sourceFile = 'gov.uk India TB clinic list (8 May 2026) aligned over Visa_Medical_Centres_for_M5_Analysis_-_Updated_Workbook_26_05.xlsx';
d.generated = new Date().toISOString().slice(0, 10);

const after = d.centres.filter(c => c.sourceCountry === 'India' && c.programs.includes('UK') && c.programStatuses['UK'] === 'Active').length;

fs.writeFileSync(path, JSON.stringify(d, null, 2));

console.log('UK-Active India before:', before);
console.log('UK-Active India after: ', after);
console.log('Removed UK from:       ', removed, 'centres');
console.log('Added UK to:           ', added, 'centres');
console.log('City corrections:      ', cityFixed);
