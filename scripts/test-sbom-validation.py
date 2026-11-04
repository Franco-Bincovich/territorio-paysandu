"""Negative regression checks; mutate isolated temporary copies, never project evidence."""
import copy, json, pathlib, shutil, subprocess, sys, tempfile
root=pathlib.Path.cwd()
with tempfile.TemporaryDirectory(prefix='paysandu-sbom-qa-') as folder:
    target=pathlib.Path(folder)
    shutil.copy(root/'package-lock.json',target/'package-lock.json')
    shutil.copytree(root/'docs/evidence/cyclonedx-schema',target/'docs/evidence/cyclonedx-schema')
    bom=json.loads((root/'docs/evidence/sbom.cyclonedx.json').read_text())
    def run(document):
        (target/'docs/evidence/sbom.cyclonedx.json').write_text(json.dumps(document))
        return subprocess.run([sys.executable,str(root/'scripts/validate-sbom.py')],cwd=target,capture_output=True,text=True)
    result=run(bom); assert result.returncode==0,result.stderr
    altered=copy.deepcopy(bom);altered['components'][0]['version']='0.0.0-QA-MUTATION'
    result=run(altered);assert result.returncode!=0 and 'component identity mismatch' in result.stderr
    altered=copy.deepcopy(bom);altered['components'][0]['hashes'][0]['content']='0'*len(altered['components'][0]['hashes'][0]['content'])
    result=run(altered);assert result.returncode!=0 and 'component integrity mismatch' in result.stderr
    altered=copy.deepcopy(bom);next(edge for edge in altered['dependencies'] if edge['dependsOn'])['dependsOn'].pop()
    result=run(altered);assert result.returncode!=0 and 'dependency edges mismatch' in result.stderr
print(json.dumps({'status':'PASS','cases':['valid official-schema SBOM','altered component version rejected','altered SRI hash rejected','omitted dependency edge rejected'],'mutations':'temporary copies only'}))
