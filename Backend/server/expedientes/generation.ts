import { randomUUID } from 'node:crypto';
import type { Actor } from '../consultations/model';
import { requireCapability } from '../authorization';
import { documentId, fail, hasDocumentSignature, padCode, types, type Expediente, type ExpedientesPolicy } from './contracts';

/** Technical port, not an institutional document schema. Only a reviewed server
 * composition can supply the source and renderer; never accept either from HTTP. */
export interface DocumentContract {
  id: string;
  documentType: Expediente['documentType'];
  load(padCod: string, actor: Actor, signal: AbortSignal): Promise<unknown>;
  render(source: unknown, signal: AbortSignal): Promise<Uint8Array>;
}
export type GeneratedDocument = { id: string; padCod: string; contractId: string;
  documentType: Expediente['documentType']; mimeType: string; size: number; expiresAt: number };
type Artifact = { metadata: GeneratedDocument; owner: string; bytes: Uint8Array };

/** Ephemeral isolated mechanism. No catalog registration and no storage writes.
 * Deliberately bounded; a production deployment must approve lifecycle/auditing. */
export class DocumentGeneration {
  private artifacts = new Map<string, Artifact>();
  private busy = false;
  constructor(private contracts: readonly DocumentContract[], private policy: ExpedientesPolicy,
    private now: () => number = Date.now) {
    if (new Set(contracts.map(c => c.id)).size !== contracts.length || contracts.some(c =>
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(c.id) || !Object.hasOwn(types,c.documentType))) throw fail('EXPEDIENTES_DOCUMENT_CONTRACT');
  }
  private prune() { for (const [id,item] of this.artifacts) if (item.metadata.expiresAt <= this.now()) this.artifacts.delete(id); }
  async generate(actor: Actor, pad: string, contractId: string, signal: AbortSignal): Promise<GeneratedDocument> {
    requireCapability(actor,'expedientes.generate');
    const padCod=padCode(pad); documentId(contractId);
    if (!await this.policy.canReadParcel(actor,padCod)) throw fail('FORBIDDEN',403);
    const contract=this.contracts.find(c=>c.id===contractId);
    if (!contract) throw fail('EXPEDIENTES_DOCUMENT_CONTRACT_PENDING');
    this.prune();
    if (this.busy || this.artifacts.size >= 4) throw fail('EXPEDIENTES_BUSY',429);
    this.busy=true;
    try {
      if(signal.aborted)throw fail('EXPEDIENTES_CANCELLED',499);
      const source=await contract.load(padCod,actor,signal);
      const bytes=await contract.render(source,signal);
      if(signal.aborted)throw fail('EXPEDIENTES_CANCELLED',499);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 20*1024*1024) throw fail('EXPEDIENTES_SIZE',413);
      if (!hasDocumentSignature({documentType:contract.documentType} as Expediente,bytes)) throw fail('EXPEDIENTES_FILE_TYPE',415);
      const metadata:GeneratedDocument={id:randomUUID(),padCod,contractId:contract.id,documentType:contract.documentType,
        mimeType:types[contract.documentType][0],size:bytes.byteLength,expiresAt:this.now()+300000};
      this.artifacts.set(metadata.id,{metadata,owner:actor.userId,bytes:Uint8Array.from(bytes)});
      return {...metadata};
    } finally {this.busy=false;}
  }
  async export(actor: Actor, id: string) {
    requireCapability(actor,'expedientes.export'); documentId(id);this.prune();
    const item=this.artifacts.get(id);
    if (!item || item.owner!==actor.userId) throw fail('EXPEDIENTE_NOT_FOUND',404);
    if (!await this.policy.canReadParcel(actor,item.metadata.padCod)) throw fail('FORBIDDEN',403);
    return {metadata:{...item.metadata},bytes:Uint8Array.from(item.bytes)};
  }
}
