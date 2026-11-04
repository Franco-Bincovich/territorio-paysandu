import { readFileSync } from 'node:fs';
// Feed NUL-delimited paths: git ls-files -z --cached --others --exclude-standard | node scripts/check-secrets.mjs
const files = readFileSync(0, 'utf8').split('\0').filter(Boolean);
if (!files.length) throw new Error('No file paths provided; scan not performed');
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsb_secret_[A-Za-z0-9_-]{20,}\b/, /\bAKIA[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /[?&](?:X-Amz-Signature|X-Goog-Signature|sig)=[a-zA-Z0-9%_-]{16,}/i,
];
const findings=[];
let scannedText=0,binarySkipped=0;
for(const file of new Set(files)) {
  if(/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) {findings.push({file,rule:'environment-file'});continue;}
  let bytes;try {bytes=readFileSync(file);}catch{findings.push({file,rule:'unreadable'});continue;}
  if(bytes.includes(0)){binarySkipped++;continue;}
  scannedText++; // Binary assets require separate visual/provenance review.
  const text=bytes.toString('utf8');
  patterns.forEach((pattern,index)=>{if(pattern.test(text))findings.push({file,rule:index+1});});
}
console.log(JSON.stringify({inputFiles:new Set(files).size,scannedText,binarySkipped,findings},null,2)); // Never output matching values.
if(findings.length)process.exitCode=1;
