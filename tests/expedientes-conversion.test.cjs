require('./register-ts.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateDocx}=require('../Backend/server/expedientes/docx.ts');
const {docx}=require('./docx-fixture.cjs');
test('DOCX representative valid package accepted',()=>assert.doesNotThrow(()=>validateDocx(docx())));
test('DOCX corruption, active content, unsafe XML and external links rejected',()=>{
 for(const bytes of [Buffer.from('PK corrupt'),docx({'word/vbaProject.bin':'macro'}),docx({'word/document.xml':'<!DOCTYPE x><x/>'}),docx({'word/document.xml':Buffer.from('<x/>','utf16le')}),docx({'word/_rels/document.xml.rels':'<Relationship TargetMode="External" Target="https://example.com"/>'}),docx({'word/_rels/document.xml.rels':'<Relationship TargetMode="&#69;xternal"/>'})])assert.throws(()=>validateDocx(bytes),{code:'EXPEDIENTES_INVALID_DOCX'});
 const corrupt=docx();corrupt[100]^=1;assert.throws(()=>validateDocx(corrupt),{code:'EXPEDIENTES_INVALID_DOCX'});
});
test('DOCX maximum and cancellation',async()=>{assert.throws(()=>validateDocx(Buffer.alloc(20*1024*1024+1)),{status:413});const {convertDocxToPdf}=require('../Backend/server/expedientes/conversion.ts');await assert.rejects(convertDocxToPdf(docx(),AbortSignal.abort()),{status:408});});
