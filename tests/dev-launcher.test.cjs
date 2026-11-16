const {test}=require('node:test'),assert=require('node:assert/strict');
const {command}=require('../scripts/dev.cjs');
test('explicit local MariaDB file selects validated launcher without starting a server',()=>{
 assert.match(command(()=>true)[0],/dev-mariadb\.cjs$/);
});
test('absence of local MariaDB file preserves ordinary Next development',()=>{
 assert.deepEqual(command(()=>false).slice(1),['dev','Frontend','--hostname','127.0.0.1']);
});
