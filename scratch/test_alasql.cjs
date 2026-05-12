const alasql = require('alasql');
async function run() {
  const data = await alasql.promise('SELECT * FROM CSV(?, {headers:true})', ['AGE,GENDER\n15,male\n16,female']);
  alasql.tables.MentalHealthData = { data };
  const res = alasql('SELECT "GENDER", COUNT(*) FROM MentalHealthData GROUP BY "GENDER"');
  console.log(res);
}
run();
