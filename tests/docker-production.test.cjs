require('./register-ts.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {productionMariaEnabled,requestedAuthProvider}=require('../Backend/server/mariadb/provider.ts');
const {institutionalConfiguration}=require('../Backend/server/institutional/pool.ts');
const {poolConfiguration}=require('../Backend/server/mariadb/pool.ts');
const {writesRequested}=require('../Backend/server/consultations/http.ts');
const env={NODE_ENV:'production',AUTH_PROVIDER:'mariadb',MARIADB_ENABLED:'true',APP_ORIGIN:'https://territorio.example.test',MARIADB_TLS:'true',INSTITUTIONAL_ENABLED:'true',INSTITUTIONAL_TLS:'true',CONSULTATIONS_WRITE_ENABLED:'true'};
test('delivery provider requires explicit enablement, HTTPS and certificate validation',()=>{
  assert.equal(requestedAuthProvider(env),'mariadb');
  for(const change of [{MARIADB_ENABLED:'false'},{NODE_ENV:'development'},{APP_ORIGIN:'http://example.test'},{APP_ORIGIN:'https://user:pass@example.test'},{APP_ORIGIN:'https://example.test/path'},{MARIADB_TLS:'false'},{INSTITUTIONAL_TLS:'false'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}])assert.equal(productionMariaEnabled({...env,...change}),false);
  assert.equal(requestedAuthProvider({MARIADB_ENABLED:'true'}),'supabase');
  assert.throws(()=>requestedAuthProvider({...env,AUTH_PROVIDER:'mariadb-test',MARIADB_AUTH_TEST_ENABLED:'true'}));
});
test('delivery writes require their own flag and enabled institutional reads',()=>{
  assert.equal(writesRequested(env),true);
  for(const change of [{CONSULTATIONS_WRITE_ENABLED:'false'},{INSTITUTIONAL_ENABLED:'false'},{MARIADB_ENABLED:'false'},{APP_ORIGIN:'http://example.test'}])assert.equal(writesRequested({...env,...change}),false);
});
test('both production pools preserve TLS and institutional credential separation',()=>{
  const own={...env,MARIADB_HOST:'127.0.0.1',MARIADB_USER:'owner',MARIADB_PASSWORD:'synthetic-owner',MARIADB_DATABASE:'auxiliares'};
  assert.equal(poolConfiguration(own).ssl.rejectUnauthorized,true);
  assert.throws(()=>poolConfiguration({...own,MARIADB_TLS:'false'}));
  const institutional={...own,INSTITUTIONAL_HOST:'qa.test',INSTITUTIONAL_USER:'reader',INSTITUTIONAL_PASSWORD:'synthetic-reader',INSTITUTIONAL_DATABASE:'institucional_qa'};
  assert.equal(institutionalConfiguration(institutional).ssl.rejectUnauthorized,true);
  assert.throws(()=>institutionalConfiguration({...institutional,INSTITUTIONAL_USER:'owner'}));
  assert.throws(()=>institutionalConfiguration({...institutional,AUTH_PROVIDER:'supabase'}));
});
