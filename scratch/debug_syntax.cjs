
const fs = require('fs');
const content = fs.readFileSync('c:/Users/Satwik/Desktop/NL2Query-Engine/app/page.js', 'utf8');

let braces = 0;
let parens = 0;
let line = 1;

for (let i = 0; i < content.length; i++) {
  const char = content[i];
  if (char === '\n') line++;
  if (char === '{') braces++;
  if (char === '}') braces--;
  if (char === '(') parens++;
  if (char === ')') parens--;
  
  if (braces < 0) {
    console.log(`Extra closing brace at line ${line}`);
    braces = 0;
  }
  if (parens < 0) {
    console.log(`Extra closing parenthesis at line ${line}`);
    parens = 0;
  }
}

console.log(`Final balance: Braces ${braces}, Parens ${parens}`);
