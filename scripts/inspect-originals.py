"""Inspect a Library ZIP as inert data. No shell commands, network or document execution."""
import hashlib, io, json, os, re, stat, sys, zipfile
from pathlib import Path, PurePosixPath
import xml.etree.ElementTree as ET

archive, output, evidence = map(Path, sys.argv[1:4])
expected_stems={'PAY-PRD-001_PRD_v0.3','PAY-TRD-002_TRD_v0.3','PAY-UX-003_UI_UX_v0.3','PAY-FLOW-004_App_Flow_v0.3','PAY-BE-005_Backend_API_v0.3','PAY-PLAN-006_Plan_v0.3','PAY-BC-007_Business_Case_v0.3'}
expected_names={stem+'.'+ext for stem in expected_stems for ext in ('md','docx')}|{'LEEME_CAMBIOS_v0.3.md'}
for parent in (output.absolute(), *output.absolute().parents):
    if parent.is_symlink(): raise ValueError('Refuse symlink output directory/ancestor')
raw=archive.read_bytes()
entries=[]
with zipfile.ZipFile(io.BytesIO(raw)) as z:
    infos=z.infolist()
    if len(infos)!=15 or sum(i.file_size for i in infos)>5_000_000: raise ValueError('Unexpected archive inventory/size')
    names=[i.filename for i in infos]
    if len(set(names))!=len(names): raise ValueError('Duplicate entry')
    if set(names)!=expected_names: raise ValueError('Unexpected document filenames/inventory')
    pending=[]
    for item in infos:
        p=PurePosixPath(item.filename)
        if len(p.parts)!=1 or p.is_absolute() or '..' in p.parts or '\\' in item.filename or not stat.S_ISREG(item.external_attr>>16): raise ValueError('Unsafe entry path/type')
        if item.flag_bits&1 or item.file_size>1_000_000 or item.file_size/max(item.compress_size,1)>100: raise ValueError('Unsafe entry size/encryption')
        if p.suffix not in ('.md','.docx'): raise ValueError('Unexpected file type')
        data=z.read(item) # CRC checked by zipfile; all entries read before writing.
        row={'name':item.filename,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        pending.append((item.filename,data))
        if p.suffix=='.md':
            text=data.decode('utf8');lines=text.splitlines()
            row['declaredVersionEvidence']=[{'line':n,'text':line} for n,line in enumerate(lines,1) if n<=20 and ('version:' in line or 'versión 0.' in line or '| Versión |' in line or 'ACTUALIZACIÓN VIGENTE' in line)]
        else:
            with zipfile.ZipFile(io.BytesIO(data)) as doc:
                di=doc.infolist()
                if sum(i.file_size for i in di)>10_000_000 or any(i.file_size/max(i.compress_size,1)>1000 for i in di): raise ValueError('Oversized DOCX')
                if any('vbaproject' in i.filename.lower() or i.filename.startswith('word/embeddings/') for i in di): raise ValueError('Active/embedded content')
                xml=doc.read('word/document.xml')
                if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml: raise ValueError('DTD/entity not accepted')
                tree=ET.fromstring(xml);ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                text='\n'.join(''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in tree.findall('.//w:p',ns))
                pending.append((item.filename+'.txt',text.encode()))
                row['textSha256']=hashlib.sha256(text.encode()).hexdigest()
                row['textCharacters']=len(text)
        entries.append(row)
    for name,_ in pending:
        if (output/name).is_symlink(): raise ValueError('Refuse symlink output')
    output.mkdir(parents=True,exist_ok=True)
    for name,data in pending:
        (output/name).write_bytes(data)
result={'libraryFileId':os.getxattr(archive,'user.library-file-id').decode(),'libraryVersion':os.getxattr(archive,'user.library-file-version').decode(),'zipSize':len(raw),'zipSha256':hashlib.sha256(raw).hexdigest(),'entries':entries,'safety':'15 bounded regular single-level files; CRC read; no encrypted entries, traversal, DOCX macros or embeddings; content never executed','limits':'Hashes identify retrieved bytes, not author authenticity or prior versions. DOCX body text inspected; no layout certification or claim of Markdown equivalence.'}
evidence.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'PASS','entries':len(entries),'zipSha256':result['zipSha256']}))
