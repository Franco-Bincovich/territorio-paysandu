"""Validate CycloneDX 1.6 against pinned upstream schemas and inventory semantics.
Uses the host's existing jsonschema/referencing; installs nothing.
--fetch-schemas is an explicit, read-only network operation to public GitHub.
"""
import argparse, base64, hashlib, json, pathlib, urllib.request
from jsonschema import Draft7Validator, FormatChecker
from referencing import Registry, Resource

parser=argparse.ArgumentParser(); parser.add_argument('--fetch-schemas',action='store_true'); args=parser.parse_args()
base=pathlib.Path('docs/evidence/cyclonedx-schema'); base.mkdir(parents=True,exist_ok=True)
upstream='https://raw.githubusercontent.com/CycloneDX/specification/1.6/schema/'
names=['bom-1.6.schema.json','spdx.schema.json','jsf-0.82.schema.json']
if args.fetch_schemas:
    sources=[]
    for name in names:
        url=upstream+name
        with urllib.request.urlopen(url,timeout=20) as response:
            data=response.read(2_000_001)
            if len(data)>2_000_000: raise ValueError('Schema too large')
        json.loads(data); (base/name).write_bytes(data)
        sources.append({'file':name,'url':url,'sha256':hashlib.sha256(data).hexdigest()})
    (base/'sources.json').write_text(json.dumps({'specification':'CycloneDX 1.6','sources':sources},indent=2)+'\n')
manifest=json.loads((base/'sources.json').read_text())
registry=Registry()
for source in manifest['sources']:
    raw=(base/source['file']).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=source['sha256']: raise ValueError('Schema hash mismatch')
    schema=json.loads(raw); resource=Resource.from_contents(schema)
    for uri in [schema.get('$id'), 'http://cyclonedx.org/schema/'+source['file'], upstream+source['file']]:
        if uri: registry=registry.with_resource(uri,resource)
schema=json.loads((base/'bom-1.6.schema.json').read_text())
Draft7Validator.check_schema(schema)
bom_path=pathlib.Path('docs/evidence/sbom.cyclonedx.json'); raw=bom_path.read_bytes(); bom=json.loads(raw)
validator=Draft7Validator(schema,registry=registry,format_checker=FormatChecker())
errors=sorted(validator.iter_errors(bom),key=lambda e:str(list(e.absolute_path)))
if errors: raise ValueError('\n'.join(str(list(e.absolute_path))+': '+e.message for e in errors))
lock_raw=pathlib.Path('package-lock.json').read_bytes(); lock=json.loads(lock_raw)
assert bom['metadata']['component']['bom-ref']=='npm-lock:root','root reference mismatch'
assert bom['metadata']['component']['name']==lock['packages']['']['name'] and bom['metadata']['component']['version']==lock['packages']['']['version'],'root identity mismatch'
refs={bom['metadata']['component']['bom-ref']}|{c['bom-ref'] for c in bom['components']}
assert len(refs)==len(bom['components'])+1,'duplicate refs'
assert len(bom['components'])==len(lock['packages'])-1,'lock coverage mismatch'
paths=set()
for component in bom['components']:
    path=next(p['value'] for p in component['properties'] if p['name']=='paysandu:lockPath')
    assert path not in paths,'duplicate lock path'; paths.add(path)
    entry=lock['packages'][path]
    assert component['bom-ref']=='npm-lock:'+path,'component reference mismatch'
    assert component['name']==path.split('node_modules/')[-1] and component['version']==entry['version'],'component identity mismatch'
    integrity=entry.get('integrity','')
    if integrity.startswith(('sha256-','sha384-','sha512-')):
        algorithm,encoded=integrity.split('-',1)
        expected={'alg':'SHA-'+algorithm[3:],'content':base64.b64decode(encoded,validate=True).hex()}
        assert component['hashes']==[expected],'component integrity mismatch'
assert paths==set(lock['packages'])-{''},'lock path coverage mismatch'

assert {d['ref'] for d in bom['dependencies']}==refs,'dependency node coverage mismatch'
def resolve_dependency(path,name):
    base=path
    while True:
        candidate=(base+'/' if base else '')+'node_modules/'+name
        if candidate in lock['packages']: return candidate
        if not base: return None
        index=base.rfind('node_modules/')
        base=base[:index-1] if index>0 else ''
expected_edges={}
for path,entry in lock['packages'].items():
    names=set().union(*(set(entry.get(group,{})) for group in ['dependencies','devDependencies','optionalDependencies','peerDependencies']))
    expected=set()
    for name in names:
        resolved=resolve_dependency(path,name)
        if resolved: expected.add('npm-lock:'+resolved)
        else:
            optional=name in entry.get('optionalDependencies',{}) or entry.get('peerDependenciesMeta',{}).get(name,{}).get('optional',False)
            assert optional,'unresolved required dependency'
    expected_edges['npm-lock:'+(path or 'root')]=expected
for edge in bom['dependencies']:
    assert all(ref in refs for ref in edge['dependsOn']),'dangling dependency ref'
    assert set(edge['dependsOn'])==expected_edges[edge['ref']],'dependency edges mismatch'

lock_hash=hashlib.sha256(lock_raw).hexdigest()
assert next(p['value'] for p in bom['metadata']['component']['properties'] if p['name']=='paysandu:lockSha256')==lock_hash,'stale lock'
result={'status':'PASS','standard':'CycloneDX 1.6 JSON Schema (draft-07)','validator':'python jsonschema Draft7Validator with FormatChecker','componentCount':len(bom['components']),'dependencyNodeCount':len(bom['dependencies']),'lockSha256':lock_hash,'sbomSha256':hashlib.sha256(raw).hexdigest(),'schemaSourceManifest':'docs/evidence/cyclonedx-schema/sources.json','limitations':'Schema and graph consistency validation, not certification, legal approval, vulnerability clearance or verification of optional package binaries.'}
pathlib.Path('docs/evidence/sbom-validation.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps(result))
