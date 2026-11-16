require('./register-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {passwordIssues,isCommonPassword,PASSWORD_MAX_LENGTH}=require('../shared/password-policy.ts');
test('portable policy accepts long lowercase phrases, spaces, unicode and symbols without class rules',()=>{
 for(const value of ['una frase extensa de prueba','abcdefghijklmnop','árboles y sueños 🦊',' ! frase extensa ! '])assert.deepEqual(passwordIssues(value,value,'different current'),[]);
});
test('portable policy enforces bounds, literal confirmation, reuse and curated common values',()=>{
 assert.ok(passwordIssues('short').includes('PASSWORD_TOO_SHORT'));
 assert.ok(passwordIssues('x'.repeat(PASSWORD_MAX_LENGTH+1)).includes('PASSWORD_TOO_LONG'));
 assert.ok(passwordIssues('valid long phrase','valid long phrase ','old').includes('PASSWORD_CONFIRMATION'));
 assert.ok(passwordIssues('valid long phrase','valid long phrase','valid long phrase').includes('PASSWORD_UNCHANGED'));
 for(const value of ['Password123456','123456789012','aaaaaaaaaaaa','            '])assert.equal(isCommonPassword(value),true);
 assert.equal(passwordIssues('🦊'.repeat(6)).includes('PASSWORD_TOO_SHORT'),true);
});
